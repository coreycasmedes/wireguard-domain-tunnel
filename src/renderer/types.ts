/**
 * Shared types for renderer process
 * These mirror the types exposed by preload.ts
 */

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
