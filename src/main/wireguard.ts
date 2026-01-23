/**
 * WireGuard Integration Module
 *
 * Wraps the WireGuard CLI (`wg` and `wg-quick`) to:
 * - Detect active interfaces and peers
 * - Detect third-party VPN clients (Mullvad, PIA, etc.)
 * - Inject IPs into allowed-ips
 * - Remove IPs from allowed-ips
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

export interface WireGuardInterface {
  name: string;
  publicKey: string;
  listenPort?: number;
  peers: WireGuardPeer[];
}

export interface WireGuardPeer {
  publicKey: string;
  endpoint?: string;
  allowedIps: string[];
  latestHandshake?: number;
  transferRx?: number;
  transferTx?: number;
}

export interface WireGuardConfig {
  interfaceName: string;
  peerPublicKey: string;
}

/**
 * Detected third-party VPN information
 */
export interface DetectedVPN {
  provider: 'mullvad' | 'pia' | 'protonvpn' | 'unknown';
  connected: boolean;
  protocol: 'wireguard' | 'openvpn' | 'unknown';
  server?: string;
  location?: string;
  publicKey?: string;
  interfaceName?: string;
  /**
   * Whether this VPN's WireGuard implementation can be controlled via `wg` CLI.
   * Third-party VPNs typically use embedded implementations that can't be modified.
   */
  controllable: boolean;
  /**
   * Human-readable message about the VPN status
   */
  message: string;
}

/**
 * Comprehensive tunnel detection result
 */
export interface TunnelDetectionResult {
  /** Native WireGuard interfaces detected via `wg show` */
  nativeInterfaces: WireGuardInterface[];
  /** Third-party VPNs detected */
  thirdPartyVPNs: DetectedVPN[];
  /** utun interfaces that might be VPN tunnels */
  utunInterfaces: string[];
  /** Overall status message */
  status: 'native_available' | 'third_party_detected' | 'no_tunnel' | 'unknown';
  /** Human-readable summary */
  summary: string;
}

export class WireGuard extends EventEmitter {
  private config: WireGuardConfig | null = null;
  private sudoPassword: string | null = null;

  /**
   * Set the WireGuard interface and peer to use
   */
  setConfig(config: WireGuardConfig): void {
    this.config = config;
  }

  /**
   * Set sudo password for commands that require root
   */
  setSudoPassword(password: string): void {
    this.sudoPassword = password;
  }

  /**
   * Get all WireGuard interfaces
   */
  async getInterfaces(): Promise<WireGuardInterface[]> {
    try {
      const { stdout } = await execAsync('wg show all dump');
      return this.parseWgDump(stdout);
    } catch (err: unknown) {
      // wg might not be installed or no interfaces active
      if (err instanceof Error && err.message.includes('Unable to access interface')) {
        return [];
      }
      // Try without dump (might need sudo)
      try {
        const { stdout } = await this.execWithSudo('wg show all dump');
        return this.parseWgDump(stdout);
      } catch {
        return [];
      }
    }
  }

  /**
   * Get a specific interface
   */
  async getInterface(name: string): Promise<WireGuardInterface | null> {
    const interfaces = await this.getInterfaces();
    return interfaces.find((iface) => iface.name === name) || null;
  }

  /**
   * Parse wg show dump output
   */
  private parseWgDump(output: string): WireGuardInterface[] {
    const interfaces: Map<string, WireGuardInterface> = new Map();

    const lines = output.trim().split('\n').filter((l) => l.length > 0);

    for (const line of lines) {
      const parts = line.split('\t');

      if (parts.length < 4) continue;

      const ifaceName = parts[0];

      // First line for an interface has: interface, private-key, public-key, listen-port, fwmark
      // Peer lines have: interface, public-key, preshared-key, endpoint, allowed-ips, latest-handshake, transfer-rx, transfer-tx, persistent-keepalive

      if (!interfaces.has(ifaceName)) {
        // This could be interface line or peer line
        // Interface line has private key which is 44 chars base64
        // We detect by checking if parts[1] looks like a key
        if (parts.length >= 4 && parts[1].length === 44) {
          // This is an interface line
          interfaces.set(ifaceName, {
            name: ifaceName,
            publicKey: parts[2],
            listenPort: parts[3] !== '(none)' ? parseInt(parts[3]) : undefined,
            peers: [],
          });
          continue;
        } else {
          // First line is actually a peer, create interface placeholder
          interfaces.set(ifaceName, {
            name: ifaceName,
            publicKey: '',
            peers: [],
          });
        }
      }

      // Check if this is a peer line
      if (parts.length >= 5) {
        const iface = interfaces.get(ifaceName)!;

        // Skip if this looks like interface line
        if (parts[1].length === 44 && parts[2].length === 44) {
          // This is interface line, update public key
          iface.publicKey = parts[2];
          if (parts[3] !== '(none)') {
            iface.listenPort = parseInt(parts[3]);
          }
          continue;
        }

        // This is a peer line
        const peer: WireGuardPeer = {
          publicKey: parts[1],
          endpoint: parts[3] !== '(none)' ? parts[3] : undefined,
          allowedIps: parts[4] !== '(none)' ? parts[4].split(',').map((ip) => ip.trim()) : [],
        };

        if (parts[5] && parts[5] !== '0') {
          peer.latestHandshake = parseInt(parts[5]);
        }
        if (parts[6]) {
          peer.transferRx = parseInt(parts[6]);
        }
        if (parts[7]) {
          peer.transferTx = parseInt(parts[7]);
        }

        iface.peers.push(peer);
      }
    }

    return Array.from(interfaces.values());
  }

  /**
   * Add IPs to a peer's allowed-ips
   */
  async addAllowedIps(ips: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('WireGuard config not set. Call setConfig() first.');
    }

    const iface = await this.getInterface(this.config.interfaceName);
    if (!iface) {
      throw new Error(`Interface ${this.config.interfaceName} not found`);
    }

    const peer = iface.peers.find((p) => p.publicKey === this.config!.peerPublicKey);
    if (!peer) {
      throw new Error(`Peer ${this.config.peerPublicKey} not found on interface ${this.config.interfaceName}`);
    }

    // Add new IPs to existing allowed-ips
    const existingIps = new Set(peer.allowedIps);
    const newIps: string[] = [];

    for (const ip of ips) {
      const ipWithMask = ip.includes('/') ? ip : `${ip}/32`;
      if (!existingIps.has(ipWithMask)) {
        newIps.push(ipWithMask);
      }
    }

    if (newIps.length === 0) {
      return; // Nothing to add
    }

    // Combine existing and new IPs
    const allIps = [...peer.allowedIps, ...newIps];

    await this.setAllowedIps(allIps);

    this.emit('ips-added', { ips: newIps, total: allIps.length });
  }

  /**
   * Remove IPs from a peer's allowed-ips
   */
  async removeAllowedIps(ips: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('WireGuard config not set. Call setConfig() first.');
    }

    const iface = await this.getInterface(this.config.interfaceName);
    if (!iface) {
      throw new Error(`Interface ${this.config.interfaceName} not found`);
    }

    const peer = iface.peers.find((p) => p.publicKey === this.config!.peerPublicKey);
    if (!peer) {
      throw new Error(`Peer ${this.config.peerPublicKey} not found on interface ${this.config.interfaceName}`);
    }

    // Remove specified IPs
    const ipsToRemove = new Set(ips.map((ip) => (ip.includes('/') ? ip : `${ip}/32`)));
    const remainingIps = peer.allowedIps.filter((ip) => !ipsToRemove.has(ip));

    if (remainingIps.length === peer.allowedIps.length) {
      return; // Nothing to remove
    }

    await this.setAllowedIps(remainingIps);

    this.emit('ips-removed', { ips: Array.from(ipsToRemove), total: remainingIps.length });
  }

  /**
   * Set allowed-ips for the configured peer
   */
  private async setAllowedIps(ips: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('WireGuard config not set');
    }

    const allowedIpsStr = ips.length > 0 ? ips.join(',') : '0.0.0.0/32'; // wg requires at least one IP

    const cmd = `wg set ${this.config.interfaceName} peer ${this.config.peerPublicKey} allowed-ips ${allowedIpsStr}`;

    try {
      await execAsync(cmd);
    } catch {
      // Try with sudo
      await this.execWithSudo(cmd);
    }
  }

  /**
   * Get current allowed-ips for configured peer
   */
  async getAllowedIps(): Promise<string[]> {
    if (!this.config) {
      throw new Error('WireGuard config not set');
    }

    const iface = await this.getInterface(this.config.interfaceName);
    if (!iface) {
      return [];
    }

    const peer = iface.peers.find((p) => p.publicKey === this.config!.peerPublicKey);
    return peer?.allowedIps || [];
  }

  /**
   * Execute command with sudo
   */
  private execWithSudo(command: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      if (this.sudoPassword) {
        // Use echo to pipe password to sudo
        const proc = spawn('sh', ['-c', `echo '${this.sudoPassword}' | sudo -S ${command}`], {
          shell: false,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`Command failed with code ${code}: ${stderr}`));
          }
        });
      } else {
        // Try sudo without password (might work if NOPASSWD configured)
        exec(`sudo ${command}`, (err, stdout, stderr) => {
          if (err) {
            reject(err);
          } else {
            resolve({ stdout, stderr });
          }
        });
      }
    });
  }

  /**
   * Check if WireGuard is available on the system
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which wg');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the configured interface is active
   */
  async isActive(): Promise<boolean> {
    if (!this.config) {
      return false;
    }

    const iface = await this.getInterface(this.config.interfaceName);
    return iface !== null;
  }

  /**
   * Get current config
   */
  getConfig(): WireGuardConfig | null {
    return this.config ? { ...this.config } : null;
  }

  /**
   * Detect Mullvad VPN via its CLI
   */
  async detectMullvad(): Promise<DetectedVPN | null> {
    try {
      // Check if mullvad CLI is available
      await execAsync('which mullvad');
    } catch {
      return null;
    }

    try {
      const { stdout: statusOutput } = await execAsync('mullvad status');
      const isConnected = statusOutput.toLowerCase().includes('connected');

      if (!isConnected) {
        return {
          provider: 'mullvad',
          connected: false,
          protocol: 'unknown',
          controllable: false,
          message: 'Mullvad VPN is installed but not connected',
        };
      }

      // Parse the status output for server and location
      // Format: "Connected to us-chi-wg-306 in Chicago, IL, USA"
      const serverMatch = statusOutput.match(/Connected to (\S+)/);
      const locationMatch = statusOutput.match(/in (.+?)(?:\n|$)/);

      // Get tunnel details including public key
      let publicKey: string | undefined;
      let protocol: 'wireguard' | 'openvpn' | 'unknown' = 'unknown';

      try {
        const { stdout: tunnelOutput } = await execAsync('mullvad tunnel get');
        const keyMatch = tunnelOutput.match(/Public key:\s+(\S+)/);
        if (keyMatch) {
          publicKey = keyMatch[1];
        }
        if (tunnelOutput.toLowerCase().includes('wireguard')) {
          protocol = 'wireguard';
        } else if (tunnelOutput.toLowerCase().includes('openvpn')) {
          protocol = 'openvpn';
        }
      } catch {
        // Tunnel details not available
      }

      // Try to determine which utun interface Mullvad is using
      let interfaceName: string | undefined;
      try {
        const { stdout: routeOutput } = await execAsync('netstat -rn | grep "^default.*utun"');
        const utunMatch = routeOutput.match(/utun\d+/);
        if (utunMatch) {
          interfaceName = utunMatch[0];
        }
      } catch {
        // Route detection failed
      }

      return {
        provider: 'mullvad',
        connected: true,
        protocol,
        server: serverMatch ? serverMatch[1] : undefined,
        location: locationMatch ? locationMatch[1].trim() : undefined,
        publicKey,
        interfaceName,
        controllable: false,
        message: `Mullvad VPN connected to ${serverMatch ? serverMatch[1] : 'unknown server'}. Uses embedded WireGuard - cannot modify allowed-ips directly.`,
      };
    } catch {
      return null;
    }
  }

  /**
   * Detect PIA (Private Internet Access) VPN
   */
  async detectPIA(): Promise<DetectedVPN | null> {
    try {
      // Check if piactl is available
      await execAsync('which piactl');
    } catch {
      return null;
    }

    try {
      const { stdout } = await execAsync('piactl get connectionstate');
      const isConnected = stdout.trim().toLowerCase() === 'connected';

      if (!isConnected) {
        return {
          provider: 'pia',
          connected: false,
          protocol: 'unknown',
          controllable: false,
          message: 'PIA VPN is installed but not connected',
        };
      }

      // Get protocol
      let protocol: 'wireguard' | 'openvpn' | 'unknown' = 'unknown';
      try {
        const { stdout: protoOut } = await execAsync('piactl get protocol');
        if (protoOut.toLowerCase().includes('wireguard')) {
          protocol = 'wireguard';
        } else if (protoOut.toLowerCase().includes('openvpn')) {
          protocol = 'openvpn';
        }
      } catch {
        // Protocol detection failed
      }

      return {
        provider: 'pia',
        connected: true,
        protocol,
        controllable: false,
        message: 'PIA VPN connected. Uses embedded WireGuard - cannot modify allowed-ips directly.',
      };
    } catch {
      return null;
    }
  }

  /**
   * List all utun interfaces on macOS
   */
  async listUtunInterfaces(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('ifconfig | grep "^utun" | cut -d: -f1');
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Comprehensive tunnel detection
   * Checks for native WireGuard interfaces, third-party VPNs, and utun interfaces
   */
  async detectTunnels(): Promise<TunnelDetectionResult> {
    const [nativeInterfaces, mullvad, pia, utunInterfaces] = await Promise.all([
      this.getInterfaces(),
      this.detectMullvad(),
      this.detectPIA(),
      this.listUtunInterfaces(),
    ]);

    const thirdPartyVPNs: DetectedVPN[] = [];
    if (mullvad) thirdPartyVPNs.push(mullvad);
    if (pia) thirdPartyVPNs.push(pia);

    // Determine overall status
    let status: TunnelDetectionResult['status'];
    let summary: string;

    if (nativeInterfaces.length > 0) {
      status = 'native_available';
      summary = `Found ${nativeInterfaces.length} native WireGuard interface(s): ${nativeInterfaces.map((i) => i.name).join(', ')}`;
    } else if (thirdPartyVPNs.some((vpn) => vpn.connected)) {
      status = 'third_party_detected';
      const connectedVPNs = thirdPartyVPNs.filter((vpn) => vpn.connected);
      summary = `Third-party VPN detected: ${connectedVPNs.map((v) => v.provider).join(', ')}. These use embedded WireGuard implementations that cannot be controlled via the wg CLI. Consider using manual WireGuard configuration.`;
    } else if (thirdPartyVPNs.length > 0) {
      status = 'no_tunnel';
      summary = `VPN client(s) installed (${thirdPartyVPNs.map((v) => v.provider).join(', ')}) but not connected. Connect your VPN or configure a WireGuard tunnel manually.`;
    } else if (utunInterfaces.length > 0) {
      status = 'unknown';
      summary = `Found ${utunInterfaces.length} utun interface(s) but could not identify the VPN. You may need to configure manually.`;
    } else {
      status = 'no_tunnel';
      summary = 'No WireGuard tunnels detected. Start a VPN connection or configure manually.';
    }

    return {
      nativeInterfaces,
      thirdPartyVPNs,
      utunInterfaces,
      status,
      summary,
    };
  }
}

// Export singleton instance
export const wireguard = new WireGuard();
