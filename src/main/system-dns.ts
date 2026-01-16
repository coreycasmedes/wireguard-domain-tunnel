/**
 * System DNS Configuration Module
 *
 * Manages system DNS settings to redirect DNS queries to our local proxy.
 * Supports macOS (via networksetup) and Linux (via resolved/resolv.conf).
 *
 * Uses pf (macOS) or iptables (Linux) to redirect port 53 → 5353.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface DnsBackup {
  platform: string;
  timestamp: number;
  services?: { name: string; dns: string[] }[];
  resolvConf?: string;
}

export interface SystemDnsConfig {
  proxyPort: number;
  pfAnchorName: string;
}

const DEFAULT_CONFIG: SystemDnsConfig = {
  proxyPort: 5353,
  pfAnchorName: 'com.wireguard-domain-tunnel',
};

export class SystemDns extends EventEmitter {
  private config: SystemDnsConfig;
  private backup: DnsBackup | null = null;
  private isConfigured = false;
  private platform: string;

  constructor(config?: Partial<SystemDnsConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.platform = os.platform();
  }

  /**
   * Configure system DNS to use our proxy
   */
  async configure(): Promise<void> {
    if (this.isConfigured) {
      return;
    }

    // Backup current settings
    this.backup = await this.backupCurrentSettings();
    this.emit('backup-created', this.backup);

    try {
      if (this.platform === 'darwin') {
        await this.configureMacOS();
      } else if (this.platform === 'linux') {
        await this.configureLinux();
      } else {
        throw new Error(`Unsupported platform: ${this.platform}`);
      }

      this.isConfigured = true;
      this.emit('configured');
    } catch (err) {
      // Attempt to restore on failure
      await this.restore().catch(() => { /* ignore restore errors during failure recovery */ });
      throw err;
    }
  }

  /**
   * Restore original DNS settings
   */
  async restore(): Promise<void> {
    if (!this.backup) {
      return;
    }

    try {
      if (this.platform === 'darwin') {
        await this.restoreMacOS();
      } else if (this.platform === 'linux') {
        await this.restoreLinux();
      }

      this.isConfigured = false;
      this.emit('restored');
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Backup current DNS settings
   */
  private async backupCurrentSettings(): Promise<DnsBackup> {
    const backup: DnsBackup = {
      platform: this.platform,
      timestamp: Date.now(),
    };

    if (this.platform === 'darwin') {
      backup.services = await this.getMacOSNetworkServices();
    } else if (this.platform === 'linux') {
      try {
        backup.resolvConf = await fs.readFile('/etc/resolv.conf', 'utf-8');
      } catch {
        // File might not exist
      }
    }

    return backup;
  }

  /**
   * Get macOS network services with their DNS settings
   */
  private async getMacOSNetworkServices(): Promise<{ name: string; dns: string[] }[]> {
    const services: { name: string; dns: string[] }[] = [];

    try {
      const { stdout } = await execAsync('networksetup -listallnetworkservices');
      const lines = stdout.trim().split('\n').slice(1); // Skip header line

      for (const serviceName of lines) {
        if (serviceName.startsWith('*')) continue; // Skip disabled services

        try {
          const { stdout: dnsOutput } = await execAsync(
            `networksetup -getdnsservers "${serviceName}"`
          );
          const dns = dnsOutput.trim();

          if (dns && !dns.includes("aren't any")) {
            services.push({
              name: serviceName,
              dns: dns.split('\n').filter((d) => d.length > 0),
            });
          } else {
            services.push({ name: serviceName, dns: [] });
          }
        } catch {
          services.push({ name: serviceName, dns: [] });
        }
      }
    } catch (err) {
      this.emit('error', err);
    }

    return services;
  }

  /**
   * Configure macOS DNS
   */
  private async configureMacOS(): Promise<void> {
    // Set DNS to localhost for all active network services
    const services = this.backup?.services || [];

    for (const service of services) {
      try {
        await execAsync(`networksetup -setdnsservers "${service.name}" 127.0.0.1`);
      } catch (err) {
        this.emit('warning', `Failed to set DNS for ${service.name}: ${err}`);
      }
    }

    // Set up pf (packet filter) to redirect port 53 to our proxy port
    await this.setupMacOSPortRedirect();

    // Flush DNS cache
    await this.flushDnsCache();
  }

  /**
   * Set up macOS pf port redirect (53 → 5353)
   */
  private async setupMacOSPortRedirect(): Promise<void> {
    const pfRules = `
rdr pass on lo0 inet proto udp from any to 127.0.0.1 port 53 -> 127.0.0.1 port ${this.config.proxyPort}
rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 53 -> 127.0.0.1 port ${this.config.proxyPort}
`;

    const anchorFile = `/tmp/${this.config.pfAnchorName}.rules`;

    try {
      await fs.writeFile(anchorFile, pfRules);

      // Load the anchor
      await execAsync(`sudo pfctl -a "${this.config.pfAnchorName}" -f ${anchorFile}`);

      // Enable pf if not already enabled
      try {
        await execAsync('sudo pfctl -e');
      } catch {
        // pf might already be enabled
      }
    } catch (err) {
      this.emit('warning', `Port redirect setup failed: ${err}. DNS queries to 127.0.0.1:53 may not work.`);
    }
  }

  /**
   * Remove macOS pf port redirect
   */
  private async removeMacOSPortRedirect(): Promise<void> {
    try {
      // Flush the anchor
      await execAsync(`sudo pfctl -a "${this.config.pfAnchorName}" -F all`);
    } catch {
      // Anchor might not exist
    }

    const anchorFile = `/tmp/${this.config.pfAnchorName}.rules`;
    try {
      await fs.unlink(anchorFile);
    } catch {
      // File might not exist
    }
  }

  /**
   * Restore macOS DNS settings
   */
  private async restoreMacOS(): Promise<void> {
    // Remove port redirect first
    await this.removeMacOSPortRedirect();

    const services = this.backup?.services || [];

    for (const service of services) {
      try {
        if (service.dns.length > 0) {
          await execAsync(
            `networksetup -setdnsservers "${service.name}" ${service.dns.join(' ')}`
          );
        } else {
          await execAsync(`networksetup -setdnsservers "${service.name}" empty`);
        }
      } catch (err) {
        this.emit('warning', `Failed to restore DNS for ${service.name}: ${err}`);
      }
    }

    // Flush DNS cache
    await this.flushDnsCache();
  }

  /**
   * Configure Linux DNS
   */
  private async configureLinux(): Promise<void> {
    // Check if systemd-resolved is available
    try {
      await execAsync('systemctl is-active systemd-resolved');
      await this.configureSystemdResolved();
    } catch {
      // Fall back to /etc/resolv.conf
      await this.configureResolvConf();
    }

    // Set up iptables redirect
    await this.setupLinuxPortRedirect();
  }

  /**
   * Configure systemd-resolved
   */
  private async configureSystemdResolved(): Promise<void> {
    // Create a drop-in config
    const configDir = '/etc/systemd/resolved.conf.d';
    const configFile = path.join(configDir, 'wireguard-domain-tunnel.conf');

    const config = `[Resolve]
DNS=127.0.0.1
DNSStubListener=no
`;

    try {
      await execAsync(`sudo mkdir -p ${configDir}`);
      await execAsync(`echo '${config}' | sudo tee ${configFile}`);
      await execAsync('sudo systemctl restart systemd-resolved');
    } catch (err) {
      this.emit('warning', `systemd-resolved configuration failed: ${err}`);
    }
  }

  /**
   * Configure /etc/resolv.conf directly
   */
  private async configureResolvConf(): Promise<void> {
    const resolvConf = 'nameserver 127.0.0.1\n';

    try {
      // Check if resolv.conf is a symlink
      const stats = await fs.lstat('/etc/resolv.conf');
      if (stats.isSymbolicLink()) {
        // Remove symlink and create file
        await execAsync('sudo rm /etc/resolv.conf');
      }

      await execAsync(`echo '${resolvConf}' | sudo tee /etc/resolv.conf`);
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Set up Linux iptables port redirect
   */
  private async setupLinuxPortRedirect(): Promise<void> {
    try {
      await execAsync(
        `sudo iptables -t nat -A OUTPUT -p udp --dport 53 -j REDIRECT --to-port ${this.config.proxyPort}`
      );
      await execAsync(
        `sudo iptables -t nat -A OUTPUT -p tcp --dport 53 -j REDIRECT --to-port ${this.config.proxyPort}`
      );
    } catch (err) {
      this.emit('warning', `iptables redirect setup failed: ${err}`);
    }
  }

  /**
   * Remove Linux iptables port redirect
   */
  private async removeLinuxPortRedirect(): Promise<void> {
    try {
      await execAsync(
        `sudo iptables -t nat -D OUTPUT -p udp --dport 53 -j REDIRECT --to-port ${this.config.proxyPort}`
      );
      await execAsync(
        `sudo iptables -t nat -D OUTPUT -p tcp --dport 53 -j REDIRECT --to-port ${this.config.proxyPort}`
      );
    } catch {
      // Rules might not exist
    }
  }

  /**
   * Restore Linux DNS settings
   */
  private async restoreLinux(): Promise<void> {
    // Remove iptables redirect
    await this.removeLinuxPortRedirect();

    // Remove systemd-resolved config if exists
    try {
      await execAsync('sudo rm -f /etc/systemd/resolved.conf.d/wireguard-domain-tunnel.conf');
      await execAsync('sudo systemctl restart systemd-resolved');
    } catch {
      // Config might not exist
    }

    // Restore resolv.conf
    if (this.backup?.resolvConf) {
      try {
        await execAsync(`echo '${this.backup.resolvConf}' | sudo tee /etc/resolv.conf`);
      } catch (err) {
        this.emit('error', err);
      }
    }
  }

  /**
   * Flush DNS cache
   */
  private async flushDnsCache(): Promise<void> {
    if (this.platform === 'darwin') {
      try {
        await execAsync('sudo dscacheutil -flushcache');
        await execAsync('sudo killall -HUP mDNSResponder');
      } catch {
        // Ignore errors
      }
    } else if (this.platform === 'linux') {
      try {
        await execAsync('sudo systemd-resolve --flush-caches');
      } catch {
        // systemd-resolved might not be running
      }
    }
  }

  /**
   * Check if DNS is already pointing to localhost (crash recovery)
   */
  async checkForStaleConfig(): Promise<boolean> {
    if (this.platform === 'darwin') {
      const services = await this.getMacOSNetworkServices();
      for (const service of services) {
        if (service.dns.includes('127.0.0.1')) {
          return true;
        }
      }
    } else if (this.platform === 'linux') {
      try {
        const content = await fs.readFile('/etc/resolv.conf', 'utf-8');
        if (content.includes('nameserver 127.0.0.1')) {
          return true;
        }
      } catch {
        // File might not exist
      }
    }

    return false;
  }

  /**
   * Get current status
   */
  isActive(): boolean {
    return this.isConfigured;
  }

  /**
   * Get backup data
   */
  getBackup(): DnsBackup | null {
    return this.backup;
  }

  /**
   * Load backup from persisted data
   */
  loadBackup(backup: DnsBackup): void {
    this.backup = backup;
  }
}

// Export singleton instance
export const systemDns = new SystemDns();
