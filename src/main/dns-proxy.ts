/**
 * DNS Proxy Module
 *
 * A local DNS proxy server that:
 * 1. Intercepts DNS queries on port 5353
 * 2. Checks domains against routing rules
 * 3. Forwards to appropriate upstream DNS (tunnel vs direct)
 * 4. Records IP mappings for conflict detection
 * 5. Emits events for route injection and logging
 */

import * as dgram from 'dgram';
import * as dnsPacket from 'dns-packet';
import { EventEmitter } from 'events';
import { DomainMatcher } from './domain-matcher';
import { ConflictDetector, IpConflict } from './conflict-detector';

export interface DnsProxyConfig {
  listenPort: number;
  tunnelUpstream: { host: string; port: number };
  directUpstream: { host: string; port: number };
}

export interface DnsQueryEvent {
  domain: string;
  type: string;
  tunnel: boolean;
  matchedRule?: string;
  timestamp: number;
}

export interface DnsResponseEvent {
  domain: string;
  type: string;
  tunnel: boolean;
  ips: string[];
  ttl: number;
  upstream: string;
  responseTime: number;
  timestamp: number;
}

export interface RouteInjectionEvent {
  domain: string;
  ips: string[];
  tunnel: boolean;
  conflict?: IpConflict;
}

const DEFAULT_CONFIG: DnsProxyConfig = {
  listenPort: 5353,
  tunnelUpstream: { host: '8.8.8.8', port: 53 },
  directUpstream: { host: '1.1.1.1', port: 53 },
};

export class DnsProxy extends EventEmitter {
  private server: dgram.Socket | null = null;
  private config: DnsProxyConfig;
  private domainMatcher: DomainMatcher;
  private conflictDetector: ConflictDetector;
  private isRunning = false;
  private pendingQueries: Map<
    number,
    {
      clientAddress: string;
      clientPort: number;
      domain: string;
      tunnel: boolean;
      startTime: number;
    }
  > = new Map();

  constructor(
    domainMatcher: DomainMatcher,
    conflictDetector: ConflictDetector,
    config?: Partial<DnsProxyConfig>
  ) {
    super();
    this.domainMatcher = domainMatcher;
    this.conflictDetector = conflictDetector;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the DNS proxy server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('DNS proxy is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = dgram.createSocket('udp4');

      this.server.on('error', (err) => {
        this.emit('error', err);
        if (!this.isRunning) {
          reject(err);
        }
      });

      this.server.on('message', (msg, rinfo) => {
        this.handleQuery(msg, rinfo).catch((err) => {
          this.emit('error', err);
        });
      });

      this.server.on('listening', () => {
        this.isRunning = true;
        const address = this.server!.address();
        this.emit('started', { port: address.port });
        resolve();
      });

      this.server.bind(this.config.listenPort);
    });
  }

  /**
   * Stop the DNS proxy server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false;
        this.server = null;
        this.pendingQueries.clear();
        this.emit('stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming DNS query
   */
  private async handleQuery(msg: Buffer, rinfo: dgram.RemoteInfo): Promise<void> {
    let packet: dnsPacket.Packet;

    try {
      packet = dnsPacket.decode(msg);
    } catch {
      this.emit('error', new Error('Failed to decode DNS packet'));
      return;
    }

    if (!packet.questions || packet.questions.length === 0) {
      return;
    }

    const question = packet.questions[0];
    const domain = question.name;
    const queryType = question.type;

    // Check if domain should be tunneled
    const matchResult = this.domainMatcher.match(domain);
    const shouldTunnel = matchResult.tunnel;

    // Emit query event
    const queryEvent: DnsQueryEvent = {
      domain,
      type: queryType,
      tunnel: shouldTunnel,
      matchedRule: matchResult.matchedRule,
      timestamp: Date.now(),
    };
    this.emit('query', queryEvent);

    // Select upstream based on tunnel status
    const upstream = shouldTunnel ? this.config.tunnelUpstream : this.config.directUpstream;

    // Forward query to upstream
    const startTime = Date.now();

    try {
      const response = await this.forwardQuery(msg, upstream);
      const responseTime = Date.now() - startTime;

      // Parse response to extract IPs
      const responsePacket = dnsPacket.decode(response);
      const ips = this.extractIps(responsePacket);
      const ttl = this.extractMinTtl(responsePacket);

      // Emit response event
      const responseEvent: DnsResponseEvent = {
        domain,
        type: queryType,
        tunnel: shouldTunnel,
        ips,
        ttl,
        upstream: `${upstream.host}:${upstream.port}`,
        responseTime,
        timestamp: Date.now(),
      };
      this.emit('response', responseEvent);

      // Record IP mappings and check for conflicts
      if (ips.length > 0) {
        const conflicts = this.conflictDetector.recordMappings(domain, ips, shouldTunnel);

        // Emit route injection event
        const routeEvent: RouteInjectionEvent = {
          domain,
          ips,
          tunnel: shouldTunnel,
          conflict: conflicts.length > 0 ? conflicts[0] : undefined,
        };
        this.emit('route-injection', routeEvent);
      }

      // Send response to client
      this.server!.send(response, rinfo.port, rinfo.address, (err) => {
        if (err) {
          this.emit('error', err);
        }
      });
    } catch (err) {
      this.emit('error', err);
      // Try to send error response
      this.sendErrorResponse(packet, rinfo);
    }
  }

  /**
   * Forward DNS query to upstream server
   */
  private forwardQuery(
    query: Buffer,
    upstream: { host: string; port: number }
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      const timeout = setTimeout(() => {
        client.close();
        reject(new Error(`DNS query timeout to ${upstream.host}:${upstream.port}`));
      }, 5000);

      client.on('message', (msg) => {
        clearTimeout(timeout);
        client.close();
        resolve(msg);
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        client.close();
        reject(err);
      });

      client.send(query, upstream.port, upstream.host, (err) => {
        if (err) {
          clearTimeout(timeout);
          client.close();
          reject(err);
        }
      });
    });
  }

  /**
   * Extract IPv4 addresses from DNS response
   */
  private extractIps(packet: dnsPacket.Packet): string[] {
    const ips: string[] = [];

    if (packet.answers) {
      for (const answer of packet.answers) {
        if (answer.type === 'A' && typeof answer.data === 'string') {
          ips.push(answer.data);
        }
      }
    }

    return ips;
  }

  /**
   * Extract minimum TTL from DNS response
   */
  private extractMinTtl(packet: dnsPacket.Packet): number {
    let minTtl = 3600; // Default 1 hour

    if (packet.answers) {
      for (const answer of packet.answers) {
        if (answer.ttl && answer.ttl < minTtl) {
          minTtl = answer.ttl;
        }
      }
    }

    return minTtl;
  }

  /**
   * Send DNS error response (SERVFAIL)
   */
  private sendErrorResponse(originalPacket: dnsPacket.Packet, rinfo: dgram.RemoteInfo): void {
    const response = dnsPacket.encode({
      id: originalPacket.id,
      type: 'response',
      flags: dnsPacket.SERVFAIL,
      questions: originalPacket.questions,
      answers: [],
    });

    this.server?.send(response, rinfo.port, rinfo.address);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DnsProxyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): DnsProxyConfig {
    return { ...this.config };
  }

  /**
   * Check if proxy is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}

// Factory function for creating DNS proxy
export function createDnsProxy(
  domainMatcher: DomainMatcher,
  conflictDetector: ConflictDetector,
  config?: Partial<DnsProxyConfig>
): DnsProxy {
  return new DnsProxy(domainMatcher, conflictDetector, config);
}
