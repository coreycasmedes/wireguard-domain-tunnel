/**
 * Config Store Module
 *
 * Persistent storage for application configuration using electron-store.
 * Stores:
 * - Domain rules
 * - WireGuard configuration
 * - DNS settings
 * - UI preferences
 * - DNS backup for crash recovery
 */

import Store from 'electron-store';
import { DomainRule } from './domain-matcher';
import { DnsBackup } from './system-dns';

export interface WireGuardSettings {
  interfaceName: string;
  peerPublicKey: string;
  autoDetect: boolean;
}

export interface DnsSettings {
  tunnelUpstream: { host: string; port: number };
  directUpstream: { host: string; port: number };
  proxyPort: number;
}

export interface AppSettings {
  startMinimized: boolean;
  autoStart: boolean;
  showNotifications: boolean;
}

export interface StoreSchema {
  domainRules: DomainRule[];
  wireguard: WireGuardSettings;
  dns: DnsSettings;
  app: AppSettings;
  dnsBackup: DnsBackup | null;
  lastActiveTimestamp: number;
}

const DEFAULT_STORE: StoreSchema = {
  domainRules: [],
  wireguard: {
    interfaceName: '',
    peerPublicKey: '',
    autoDetect: true,
  },
  dns: {
    tunnelUpstream: { host: '8.8.8.8', port: 53 },
    directUpstream: { host: '1.1.1.1', port: 53 },
    proxyPort: 5353,
  },
  app: {
    startMinimized: false,
    autoStart: false,
    showNotifications: true,
  },
  dnsBackup: null,
  lastActiveTimestamp: 0,
};

class ConfigStore {
  private store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'wireguard-domain-tunnel-config',
      defaults: DEFAULT_STORE,
      clearInvalidConfig: true,
    });
  }

  // Domain Rules
  getDomainRules(): DomainRule[] {
    return this.store.get('domainRules', []);
  }

  setDomainRules(rules: DomainRule[]): void {
    this.store.set('domainRules', rules);
  }

  addDomainRule(rule: DomainRule): void {
    const rules = this.getDomainRules();
    const existing = rules.findIndex((r) => r.pattern === rule.pattern);
    if (existing >= 0) {
      rules[existing] = rule;
    } else {
      rules.push(rule);
    }
    this.setDomainRules(rules);
  }

  removeDomainRule(pattern: string): boolean {
    const rules = this.getDomainRules();
    const newRules = rules.filter((r) => r.pattern !== pattern);
    if (newRules.length !== rules.length) {
      this.setDomainRules(newRules);
      return true;
    }
    return false;
  }

  // WireGuard Settings
  getWireGuardSettings(): WireGuardSettings {
    return this.store.get('wireguard', DEFAULT_STORE.wireguard);
  }

  setWireGuardSettings(settings: Partial<WireGuardSettings>): void {
    const current = this.getWireGuardSettings();
    this.store.set('wireguard', { ...current, ...settings });
  }

  // DNS Settings
  getDnsSettings(): DnsSettings {
    return this.store.get('dns', DEFAULT_STORE.dns);
  }

  setDnsSettings(settings: Partial<DnsSettings>): void {
    const current = this.getDnsSettings();
    this.store.set('dns', { ...current, ...settings });
  }

  setTunnelUpstream(host: string, port: number): void {
    const current = this.getDnsSettings();
    current.tunnelUpstream = { host, port };
    this.store.set('dns', current);
  }

  setDirectUpstream(host: string, port: number): void {
    const current = this.getDnsSettings();
    current.directUpstream = { host, port };
    this.store.set('dns', current);
  }

  // App Settings
  getAppSettings(): AppSettings {
    return this.store.get('app', DEFAULT_STORE.app);
  }

  setAppSettings(settings: Partial<AppSettings>): void {
    const current = this.getAppSettings();
    this.store.set('app', { ...current, ...settings });
  }

  // DNS Backup (for crash recovery)
  getDnsBackup(): DnsBackup | null {
    return this.store.get('dnsBackup', null);
  }

  setDnsBackup(backup: DnsBackup | null): void {
    this.store.set('dnsBackup', backup);
  }

  // Activity tracking
  getLastActiveTimestamp(): number {
    return this.store.get('lastActiveTimestamp', 0);
  }

  updateLastActiveTimestamp(): void {
    this.store.set('lastActiveTimestamp', Date.now());
  }

  clearLastActiveTimestamp(): void {
    this.store.set('lastActiveTimestamp', 0);
  }

  // Utility methods
  reset(): void {
    this.store.clear();
  }

  getAll(): StoreSchema {
    return {
      domainRules: this.getDomainRules(),
      wireguard: this.getWireGuardSettings(),
      dns: this.getDnsSettings(),
      app: this.getAppSettings(),
      dnsBackup: this.getDnsBackup(),
      lastActiveTimestamp: this.getLastActiveTimestamp(),
    };
  }

  getPath(): string {
    return this.store.path;
  }
}

// Export singleton instance
export const configStore = new ConfigStore();
