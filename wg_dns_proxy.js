import dgram from "dgram";
import dnsPacket from "dns-packet";
import { exec } from "child_process";

/**
 * DNS Proxy with WireGuard Integration
 * Intercepts specific domains and adds their IPs to WireGuard allowed-ips
 */

/** Configuration */
const UPSTREAM_DNS = "8.8.8.8";
const UPSTREAM_PORT = 53;
const TUNNEL_DOMAINS = ["app.xyz"]; // Add more domains as needed
const WG_INTERFACE = "utun3";
const WG_PEER_KEY = "<PEER_KEY>";

const addedIPs = new Set();

/**
 * Add IP address to WireGuard allowed-ips
 */
function addToWireGuard(ipAddress) {
  if (addedIPs.has(ipAddress)) {
    console.log(`📝 IP ${ipAddress} already added to WireGuard, skipping`);
    return;
  }

  const command = `sudo wg set ${WG_INTERFACE} peer ${WG_PEER_KEY} allowed-ips +${ipAddress}/32`;

  console.log(`🔧 Adding ${ipAddress} to WireGuard...`);
  console.log(`📋 Command: ${command}`);

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ WireGuard command failed: ${error.message}`);
      return;
    }
    if (stderr) {
      console.warn(`⚠️ WireGuard stderr: ${stderr}`);
    }

    addedIPs.add(ipAddress);
    console.log(`✅ Successfully added ${ipAddress} to WireGuard allowed-ips`);
  });
}

/**
 * Check if a domain should be monitored for WireGuard allowed-ips
 */
function shouldMonitorDomain(domain) {
  return TUNNEL_DOMAINS.some(
    (tunnelDomain) =>
      domain === tunnelDomain || domain.endsWith("." + tunnelDomain)
  );
}

function startDnsProxy() {
  const server = dgram.createSocket("udp4");

  server.on("message", (queryBuffer, clientInfo) => {
    console.log(
      `📨 Got DNS query from ${clientInfo.address}:${clientInfo.port}`
    );

    let parsedQuery;
    try {
      parsedQuery = dnsPacket.decode(queryBuffer);
    } catch (err) {
      console.error(`❌ Failed to parse DNS query: ${err}`);
      return;
    }

    const question = parsedQuery.questions?.[0];
    if (!question) {
      console.log(`⚠️ No questions in DNS query, ignoring`);
      return;
    }

    const domain = question.name;
    const queryType = question.type;
    console.log(`🔍 Query: ${domain} (${queryType})`);

    const shouldMonitor = shouldMonitorDomain(domain) && queryType === "A";
    if (shouldMonitor) {
      console.log(`🎯 Monitoring domain: ${domain}`);
    }

    const upstreamSocket = dgram.createSocket("udp4");

    upstreamSocket.on("message", (responseBuffer) => {
      console.log(`📤 Got response from upstream`);
      if (shouldMonitor) {
        try {
          const parsedResponse = dnsPacket.decode(responseBuffer);

          if (parsedResponse.answers) {
            parsedResponse.answers.forEach((answer) => {
              if (answer.type === "A" && answer.data) {
                const ipAddress = answer.data;
                console.log(`🎯 Found A record for ${domain}: ${ipAddress}`);
                addToWireGuard(ipAddress);
              }
            });
          }
        } catch (err) {
          console.error(`❌ Failed to parse DNS response: ${err}`);
        }
      }

      // Forward response back to client
      server.send(
        responseBuffer,
        clientInfo.port,
        clientInfo.address,
        (err) => {
          if (err) {
            console.error(`❌ Error sending response to client: ${err}`);
          } else {
            console.log(`✅ Response forwarded to client`);
          }
          upstreamSocket.close();
        }
      );
    });

    upstreamSocket.on("error", (err) => {
      console.error(`❌ Upstream socket error: ${err}`);
      upstreamSocket.close();
    });

    /**
     * Forward query to upstream DNS nameserver. The ip address of your
     * VPN's DNS server can be found in the wireguard .conf file or
     * 192.68.8.1 for macOS internal DNS.
     */
    console.log(`📡 Forwarding to ${UPSTREAM_DNS}`);
    upstreamSocket.send(queryBuffer, UPSTREAM_PORT, UPSTREAM_DNS, (err) => {
      if (err) {
        console.error(`❌ Error forwarding to upstream: ${err}`);
        upstreamSocket.close();
      }
    });
  });

  server.on("error", (err) => {
    console.error(`❌ Server error: ${err}`);
  });

  server.bind(53, "127.0.0.1", () => {
    console.log(
      "🚀 DNS proxy with WireGuard integration running on 127.0.0.1:5354"
    );
    console.log(
      `📡 Forwarding to upstream DNS: ${UPSTREAM_DNS}:${UPSTREAM_PORT}`
    );
    console.log(`🎯 Monitoring domains: ${TUNNEL_DOMAINS.join(", ")}`);
    console.log(`🔧 WireGuard interface: ${WG_INTERFACE}`);
    console.log("\nTest with: dig @127.0.0.1 -p 5354 app.hyperliquid.xyz");
  });
}

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down DNS proxy...");
  process.exit(0);
});

const dnsServer = startDnsProxy();
