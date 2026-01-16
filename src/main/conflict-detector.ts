/**
 * Conflict Detector Module
 *
 * Tracks IP → domain mappings and detects when tunnel and direct domains
 * share the same IP addresses (common with CDNs).
 */

import { EventEmitter } from 'events';

export interface DomainIpMapping {
  domain: string;
  ip: string;
  tunnel: boolean;
  timestamp: number;
}

export interface IpConflict {
  ip: string;
  tunnelDomains: string[];
  directDomains: string[];
  detectedAt: number;
}

export class ConflictDetector extends EventEmitter {
  // Map of IP → array of domain mappings
  private ipToDomains: Map<string, DomainIpMapping[]> = new Map();
  // Map of domain → IPs for quick lookup
  private domainToIps: Map<string, Set<string>> = new Map();
  // Current conflicts
  private conflicts: Map<string, IpConflict> = new Map();
  // TTL for mappings in milliseconds (default 5 minutes)
  private mappingTtl: number = 5 * 60 * 1000;

  constructor(ttlMs?: number) {
    super();
    if (ttlMs) {
      this.mappingTtl = ttlMs;
    }
  }

  /**
   * Record a domain → IP mapping with its tunnel status
   */
  recordMapping(domain: string, ip: string, tunnel: boolean): IpConflict | null {
    const normalizedDomain = domain.toLowerCase();
    const mapping: DomainIpMapping = {
      domain: normalizedDomain,
      ip,
      tunnel,
      timestamp: Date.now(),
    };

    // Add to IP → domains map
    const domainList = this.ipToDomains.get(ip) || [];
    // Remove any existing mapping for this domain
    const filteredList = domainList.filter((m) => m.domain !== normalizedDomain);
    filteredList.push(mapping);
    this.ipToDomains.set(ip, filteredList);

    // Add to domain → IPs map
    const ipSet = this.domainToIps.get(normalizedDomain) || new Set();
    ipSet.add(ip);
    this.domainToIps.set(normalizedDomain, ipSet);

    // Check for conflicts
    return this.checkForConflict(ip);
  }

  /**
   * Record multiple IPs for a domain (from DNS response with multiple A records)
   */
  recordMappings(domain: string, ips: string[], tunnel: boolean): IpConflict[] {
    const conflicts: IpConflict[] = [];
    for (const ip of ips) {
      const conflict = this.recordMapping(domain, ip, tunnel);
      if (conflict) {
        conflicts.push(conflict);
      }
    }
    return conflicts;
  }

  /**
   * Check if an IP has conflicting domain mappings
   */
  private checkForConflict(ip: string): IpConflict | null {
    const mappings = this.ipToDomains.get(ip);
    if (!mappings || mappings.length < 2) {
      // No conflict possible with less than 2 mappings
      if (this.conflicts.has(ip)) {
        this.conflicts.delete(ip);
        this.emit('conflict-resolved', ip);
      }
      return null;
    }

    // Clean up stale mappings
    const now = Date.now();
    const validMappings = mappings.filter((m) => now - m.timestamp < this.mappingTtl);
    this.ipToDomains.set(ip, validMappings);

    if (validMappings.length < 2) {
      if (this.conflicts.has(ip)) {
        this.conflicts.delete(ip);
        this.emit('conflict-resolved', ip);
      }
      return null;
    }

    // Check for actual conflict (tunnel and direct on same IP)
    const tunnelDomains = validMappings.filter((m) => m.tunnel).map((m) => m.domain);
    const directDomains = validMappings.filter((m) => !m.tunnel).map((m) => m.domain);

    if (tunnelDomains.length > 0 && directDomains.length > 0) {
      const conflict: IpConflict = {
        ip,
        tunnelDomains: [...new Set(tunnelDomains)],
        directDomains: [...new Set(directDomains)],
        detectedAt: Date.now(),
      };
      const isNew = !this.conflicts.has(ip);
      this.conflicts.set(ip, conflict);

      if (isNew) {
        this.emit('conflict-detected', conflict);
      }

      return conflict;
    }

    // No conflict
    if (this.conflicts.has(ip)) {
      this.conflicts.delete(ip);
      this.emit('conflict-resolved', ip);
    }
    return null;
  }

  /**
   * Get all current conflicts
   */
  getConflicts(): IpConflict[] {
    // Clean up stale conflicts first
    this.cleanupStale();
    return Array.from(this.conflicts.values());
  }

  /**
   * Get IPs that have conflicts
   */
  getConflictingIps(): string[] {
    return Array.from(this.conflicts.keys());
  }

  /**
   * Check if a specific IP has conflicts
   */
  hasConflict(ip: string): boolean {
    return this.conflicts.has(ip);
  }

  /**
   * Get all IPs for a domain
   */
  getIpsForDomain(domain: string): string[] {
    const ipSet = this.domainToIps.get(domain.toLowerCase());
    return ipSet ? Array.from(ipSet) : [];
  }

  /**
   * Get all domains for an IP
   */
  getDomainsForIp(ip: string): DomainIpMapping[] {
    return this.ipToDomains.get(ip) || [];
  }

  /**
   * Clean up stale mappings
   */
  cleanupStale(): void {
    const now = Date.now();

    for (const [ip, mappings] of this.ipToDomains) {
      const validMappings = mappings.filter((m) => now - m.timestamp < this.mappingTtl);
      if (validMappings.length === 0) {
        this.ipToDomains.delete(ip);
        if (this.conflicts.has(ip)) {
          this.conflicts.delete(ip);
          this.emit('conflict-resolved', ip);
        }
      } else if (validMappings.length !== mappings.length) {
        this.ipToDomains.set(ip, validMappings);
        // Re-check conflict status
        this.checkForConflict(ip);
      }
    }

    // Clean up domain → IPs map
    for (const [domain, ips] of this.domainToIps) {
      const validIps = new Set<string>();
      for (const ip of ips) {
        const mappings = this.ipToDomains.get(ip) || [];
        if (mappings.some((m) => m.domain === domain)) {
          validIps.add(ip);
        }
      }
      if (validIps.size === 0) {
        this.domainToIps.delete(domain);
      } else {
        this.domainToIps.set(domain, validIps);
      }
    }
  }

  /**
   * Remove all mappings for a domain
   */
  removeDomain(domain: string): void {
    const normalizedDomain = domain.toLowerCase();
    const ips = this.domainToIps.get(normalizedDomain);

    if (ips) {
      for (const ip of ips) {
        const mappings = this.ipToDomains.get(ip) || [];
        const filtered = mappings.filter((m) => m.domain !== normalizedDomain);
        if (filtered.length === 0) {
          this.ipToDomains.delete(ip);
          if (this.conflicts.has(ip)) {
            this.conflicts.delete(ip);
            this.emit('conflict-resolved', ip);
          }
        } else {
          this.ipToDomains.set(ip, filtered);
          this.checkForConflict(ip);
        }
      }
      this.domainToIps.delete(normalizedDomain);
    }
  }

  /**
   * Clear all mappings and conflicts
   */
  clear(): void {
    const conflictingIps = Array.from(this.conflicts.keys());
    this.ipToDomains.clear();
    this.domainToIps.clear();
    this.conflicts.clear();

    for (const ip of conflictingIps) {
      this.emit('conflict-resolved', ip);
    }
  }

  /**
   * Get statistics
   */
  getStats(): { totalMappings: number; uniqueIps: number; uniqueDomains: number; conflicts: number } {
    return {
      totalMappings: Array.from(this.ipToDomains.values()).reduce((sum, arr) => sum + arr.length, 0),
      uniqueIps: this.ipToDomains.size,
      uniqueDomains: this.domainToIps.size,
      conflicts: this.conflicts.size,
    };
  }
}

// Export singleton instance
export const conflictDetector = new ConflictDetector();
