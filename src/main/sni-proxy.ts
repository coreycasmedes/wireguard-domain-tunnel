/**
 * SNI Proxy Module
 *
 * A SOCKS5 proxy server that inspects TLS SNI (Server Name Indication)
 * to determine routing for domains that share the same IP address.
 *
 * When the DNS-based routing can't distinguish between tunnel/direct domains
 * (because they resolve to the same IP), traffic is routed through this proxy
 * which reads the SNI from the TLS ClientHello to make routing decisions.
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import { SocksClient, SocksClientOptions } from 'socks';
import { DomainMatcher } from './domain-matcher';

export interface SniProxyConfig {
  listenPort: number;
  vpnSocksProxy?: { host: string; port: number }; // Optional SOCKS proxy for VPN routing
}

export interface ConnectionEvent {
  clientAddress: string;
  clientPort: number;
  targetHost: string;
  targetPort: number;
  sni?: string;
  tunnel: boolean;
  timestamp: number;
}

const DEFAULT_CONFIG: SniProxyConfig = {
  listenPort: 1080,
};

// SOCKS5 constants
const SOCKS_VERSION = 0x05;
const SOCKS_AUTH_NONE = 0x00;
const SOCKS_CMD_CONNECT = 0x01;
const SOCKS_ATYP_IPV4 = 0x01;
const SOCKS_ATYP_DOMAIN = 0x03;
const SOCKS_ATYP_IPV6 = 0x04;
const SOCKS_REPLY_SUCCESS = 0x00;
const SOCKS_REPLY_FAILURE = 0x01;

export class SniProxy extends EventEmitter {
  private server: net.Server | null = null;
  private config: SniProxyConfig;
  private domainMatcher: DomainMatcher;
  private isRunning = false;
  private activeConnections: Set<net.Socket> = new Set();

  constructor(domainMatcher: DomainMatcher, config?: Partial<SniProxyConfig>) {
    super();
    this.domainMatcher = domainMatcher;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the SOCKS5 proxy server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('SNI proxy is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        this.emit('error', err);
        if (!this.isRunning) {
          reject(err);
        }
      });

      this.server.on('listening', () => {
        this.isRunning = true;
        this.emit('started', { port: this.config.listenPort });
        resolve();
      });

      this.server.listen(this.config.listenPort, '127.0.0.1');
    });
  }

  /**
   * Stop the SOCKS5 proxy server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    // Close all active connections
    for (const socket of this.activeConnections) {
      socket.destroy();
    }
    this.activeConnections.clear();

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false;
        this.server = null;
        this.emit('stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming SOCKS5 connection
   */
  private async handleConnection(clientSocket: net.Socket): Promise<void> {
    this.activeConnections.add(clientSocket);

    clientSocket.on('close', () => {
      this.activeConnections.delete(clientSocket);
    });

    clientSocket.on('error', (err) => {
      this.emit('error', err);
      this.activeConnections.delete(clientSocket);
    });

    try {
      // Step 1: SOCKS5 greeting
      const greeting = await this.readBytes(clientSocket, 2);
      if (greeting[0] !== SOCKS_VERSION) {
        clientSocket.destroy();
        return;
      }

      const numMethods = greeting[1];
      await this.readBytes(clientSocket, numMethods); // Read auth methods

      // Respond with no auth required
      clientSocket.write(Buffer.from([SOCKS_VERSION, SOCKS_AUTH_NONE]));

      // Step 2: SOCKS5 request
      const request = await this.readBytes(clientSocket, 4);
      if (request[0] !== SOCKS_VERSION || request[1] !== SOCKS_CMD_CONNECT) {
        this.sendSocksReply(clientSocket, SOCKS_REPLY_FAILURE);
        clientSocket.destroy();
        return;
      }

      const addressType = request[3];
      let targetHost: string;
      let targetPort: number;

      if (addressType === SOCKS_ATYP_IPV4) {
        const ipBytes = await this.readBytes(clientSocket, 4);
        targetHost = ipBytes.join('.');
        const portBytes = await this.readBytes(clientSocket, 2);
        targetPort = (portBytes[0] << 8) | portBytes[1];
      } else if (addressType === SOCKS_ATYP_DOMAIN) {
        const domainLengthBytes = await this.readBytes(clientSocket, 1);
        const domainLength = domainLengthBytes[0];
        const domainBytes = await this.readBytes(clientSocket, domainLength);
        targetHost = domainBytes.toString('utf8');
        const portBytes = await this.readBytes(clientSocket, 2);
        targetPort = (portBytes[0] << 8) | portBytes[1];
      } else if (addressType === SOCKS_ATYP_IPV6) {
        const ipBytes = await this.readBytes(clientSocket, 16);
        targetHost = this.formatIpv6(ipBytes);
        const portBytes = await this.readBytes(clientSocket, 2);
        targetPort = (portBytes[0] << 8) | portBytes[1];
      } else {
        this.sendSocksReply(clientSocket, SOCKS_REPLY_FAILURE);
        clientSocket.destroy();
        return;
      }

      // Determine routing based on domain
      const matchResult = this.domainMatcher.match(targetHost);
      const shouldTunnel = matchResult.tunnel;

      // Emit connection event
      const connectionEvent: ConnectionEvent = {
        clientAddress: clientSocket.remoteAddress || 'unknown',
        clientPort: clientSocket.remotePort || 0,
        targetHost,
        targetPort,
        tunnel: shouldTunnel,
        timestamp: Date.now(),
      };
      this.emit('connection', connectionEvent);

      // Connect to target
      let targetSocket: net.Socket;

      if (shouldTunnel && this.config.vpnSocksProxy) {
        // Route through VPN SOCKS proxy
        targetSocket = await this.connectViaSocks(
          targetHost,
          targetPort,
          this.config.vpnSocksProxy
        );
      } else {
        // Direct connection
        targetSocket = await this.connectDirect(targetHost, targetPort);
      }

      // Send success reply
      this.sendSocksReply(clientSocket, SOCKS_REPLY_SUCCESS);

      // Pipe data between client and target
      clientSocket.pipe(targetSocket);
      targetSocket.pipe(clientSocket);

      targetSocket.on('close', () => {
        clientSocket.destroy();
      });

      targetSocket.on('error', () => {
        clientSocket.destroy();
      });
    } catch (err) {
      this.emit('error', err);
      clientSocket.destroy();
    }
  }

  /**
   * Read exact number of bytes from socket
   */
  private readBytes(socket: net.Socket, length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeAllListeners('data');
        socket.removeAllListeners('error');
        reject(new Error('Read timeout'));
      }, 10000);

      let buffer = Buffer.alloc(0);

      const onData = (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        if (buffer.length >= length) {
          clearTimeout(timeout);
          socket.removeListener('data', onData);
          socket.removeListener('error', onError);
          resolve(buffer.slice(0, length));
          // Put back extra bytes
          if (buffer.length > length) {
            socket.unshift(buffer.slice(length));
          }
        }
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        socket.removeListener('data', onData);
        reject(err);
      };

      socket.on('data', onData);
      socket.once('error', onError);
    });
  }

  /**
   * Send SOCKS5 reply
   */
  private sendSocksReply(socket: net.Socket, status: number): void {
    // Reply format: VER | REP | RSV | ATYP | BND.ADDR | BND.PORT
    const reply = Buffer.from([
      SOCKS_VERSION,
      status,
      0x00, // Reserved
      SOCKS_ATYP_IPV4,
      0,
      0,
      0,
      0, // Bind address (0.0.0.0)
      0,
      0, // Bind port (0)
    ]);
    socket.write(reply);
  }

  /**
   * Connect directly to target
   */
  private connectDirect(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        resolve(socket);
      });

      socket.on('error', reject);

      socket.setTimeout(10000, () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }

  /**
   * Connect through a SOCKS proxy
   */
  private async connectViaSocks(
    host: string,
    port: number,
    proxy: { host: string; port: number }
  ): Promise<net.Socket> {
    const options: SocksClientOptions = {
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
      },
      command: 'connect',
      destination: {
        host,
        port,
      },
    };

    const info = await SocksClient.createConnection(options);
    return info.socket;
  }

  /**
   * Format IPv6 bytes to string
   */
  private formatIpv6(bytes: Buffer): string {
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    }
    return parts.join(':');
  }

  /**
   * Parse SNI from TLS ClientHello
   * This can be used for advanced SNI-based routing
   */
  static parseSni(data: Buffer): string | null {
    try {
      // TLS record header: ContentType(1) + Version(2) + Length(2)
      if (data.length < 5) return null;
      if (data[0] !== 0x16) return null; // Not a handshake record

      const recordLength = (data[3] << 8) | data[4];
      if (data.length < 5 + recordLength) return null;

      // Handshake header: Type(1) + Length(3)
      const handshakeType = data[5];
      if (handshakeType !== 0x01) return null; // Not ClientHello

      // Skip to extensions
      let offset = 5 + 1 + 3 + 2 + 32; // header + version + random
      if (offset >= data.length) return null;

      // Session ID
      const sessionIdLength = data[offset];
      offset += 1 + sessionIdLength;
      if (offset >= data.length) return null;

      // Cipher suites
      const cipherSuitesLength = (data[offset] << 8) | data[offset + 1];
      offset += 2 + cipherSuitesLength;
      if (offset >= data.length) return null;

      // Compression methods
      const compressionLength = data[offset];
      offset += 1 + compressionLength;
      if (offset >= data.length) return null;

      // Extensions length
      const extensionsLength = (data[offset] << 8) | data[offset + 1];
      offset += 2;
      const extensionsEnd = offset + extensionsLength;

      // Parse extensions
      while (offset < extensionsEnd && offset < data.length - 4) {
        const extType = (data[offset] << 8) | data[offset + 1];
        const extLength = (data[offset + 2] << 8) | data[offset + 3];
        offset += 4;

        if (extType === 0x00) {
          // SNI extension
          // Server name list length
          offset += 2;
          // Name type (should be 0 for hostname)
          if (data[offset] === 0x00) {
            offset += 1;
            const nameLength = (data[offset] << 8) | data[offset + 1];
            offset += 2;
            return data.slice(offset, offset + nameLength).toString('utf8');
          }
        }
        offset += extLength;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SniProxyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SniProxyConfig {
    return { ...this.config };
  }

  /**
   * Check if proxy is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get number of active connections
   */
  getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }
}

// Factory function
export function createSniProxy(
  domainMatcher: DomainMatcher,
  config?: Partial<SniProxyConfig>
): SniProxy {
  return new SniProxy(domainMatcher, config);
}
