/**
 * WireGuard Integration Module
 *
 * Wraps the WireGuard CLI (`wg` and `wg-quick`) to:
 * - Detect active interfaces and peers
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
}

// Export singleton instance
export const wireguard = new WireGuard();
