/**
 * Preload Script
 *
 * Exposes IPC APIs to the renderer process via contextBridge.
 * This is the secure bridge between main and renderer processes.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Type definitions for the API
export interface DomainRule {
  pattern: string;
  tunnel: boolean;
}

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
}

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

export interface IpConflict {
  ip: string;
  tunnelDomains: string[];
  directDomains: string[];
  detectedAt: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'query' | 'response' | 'route' | 'error' | 'info';
  message: string;
  details?: Record<string, unknown>;
}

export interface AppStatus {
  dnsProxyRunning: boolean;
  sniProxyRunning: boolean;
  systemDnsConfigured: boolean;
  wireguardConnected: boolean;
  totalInjectedRoutes: number;
  activeConflicts: number;
}

// Define the API
const api = {
  // Domain Management
  domains: {
    getAll: (): Promise<DomainRule[]> => ipcRenderer.invoke('domains:get-all'),
    add: (pattern: string, tunnel: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('domains:add', pattern, tunnel),
    remove: (pattern: string): Promise<boolean> => ipcRenderer.invoke('domains:remove', pattern),
    validate: (pattern: string): Promise<{ valid: boolean; error?: string }> =>
      ipcRenderer.invoke('domains:validate', pattern),
  },

  // WireGuard Management
  wireguard: {
    getInterfaces: (): Promise<WireGuardInterface[]> => ipcRenderer.invoke('wireguard:get-interfaces'),
    getSettings: (): Promise<WireGuardSettings> => ipcRenderer.invoke('wireguard:get-settings'),
    setSettings: (settings: Partial<WireGuardSettings>): Promise<void> =>
      ipcRenderer.invoke('wireguard:set-settings', settings),
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('wireguard:is-available'),
    isActive: (): Promise<boolean> => ipcRenderer.invoke('wireguard:is-active'),
    getAllowedIps: (): Promise<string[]> => ipcRenderer.invoke('wireguard:get-allowed-ips'),
  },

  // DNS Settings
  dns: {
    getSettings: (): Promise<DnsSettings> => ipcRenderer.invoke('dns:get-settings'),
    setSettings: (settings: Partial<DnsSettings>): Promise<void> =>
      ipcRenderer.invoke('dns:set-settings', settings),
    setTunnelUpstream: (host: string, port: number): Promise<void> =>
      ipcRenderer.invoke('dns:set-tunnel-upstream', host, port),
    setDirectUpstream: (host: string, port: number): Promise<void> =>
      ipcRenderer.invoke('dns:set-direct-upstream', host, port),
  },

  // Proxy Control
  proxy: {
    start: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('proxy:start'),
    stop: (): Promise<void> => ipcRenderer.invoke('proxy:stop'),
    getStatus: (): Promise<AppStatus> => ipcRenderer.invoke('proxy:get-status'),
  },

  // Conflicts
  conflicts: {
    getAll: (): Promise<IpConflict[]> => ipcRenderer.invoke('conflicts:get-all'),
    onConflictDetected: (callback: (conflict: IpConflict) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, conflict: IpConflict) => callback(conflict);
      ipcRenderer.on('conflicts:detected', handler);
      return () => ipcRenderer.removeListener('conflicts:detected', handler);
    },
    onConflictResolved: (callback: (ip: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, ip: string) => callback(ip);
      ipcRenderer.on('conflicts:resolved', handler);
      return () => ipcRenderer.removeListener('conflicts:resolved', handler);
    },
  },

  // Activity Log
  log: {
    getRecent: (limit?: number): Promise<LogEntry[]> => ipcRenderer.invoke('log:get-recent', limit),
    clear: (): Promise<void> => ipcRenderer.invoke('log:clear'),
    onEntry: (callback: (entry: LogEntry) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, entry: LogEntry) => callback(entry);
      ipcRenderer.on('log:entry', handler);
      return () => ipcRenderer.removeListener('log:entry', handler);
    },
  },

  // Status Updates
  status: {
    onUpdate: (callback: (status: AppStatus) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, status: AppStatus) => callback(status);
      ipcRenderer.on('status:update', handler);
      return () => ipcRenderer.removeListener('status:update', handler);
    },
  },

  // Window Control
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    close: (): void => ipcRenderer.send('window:close'),
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('api', api);

// Type declaration for TypeScript
declare global {
  interface Window {
    api: typeof api;
  }
}
