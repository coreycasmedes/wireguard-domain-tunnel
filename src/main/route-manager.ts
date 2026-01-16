/**
 * Route Manager Module
 *
 * Tracks IP injections into WireGuard allowed-ips and manages:
 * - Domain → IP mappings
 * - IP injection timing
 * - Cleanup of stale routes
 * - Integration with WireGuard module
 */

import { EventEmitter } from 'events';
import { WireGuard } from './wireguard';
import { ConflictDetector } from './conflict-detector';

export interface InjectedRoute {
  ip: string;
  domain: string;
  injectedAt: number;
  ttl: number;
  expiresAt: number;
}

export interface RouteStats {
  totalInjected: number;
  uniqueIps: number;
  uniqueDomains: number;
  conflictingIps: number;
}

export class RouteManager extends EventEmitter {
  // Map of IP → injected route info
  private injectedRoutes: Map<string, InjectedRoute> = new Map();
  // Map of domain → set of IPs
  private domainToIps: Map<string, Set<string>> = new Map();
  // Original allowed-ips (before any injections)
  private originalAllowedIps: string[] = [];
  // WireGuard instance
  private wireguard: WireGuard;
  // Conflict detector instance
  private conflictDetector: ConflictDetector;
  // Cleanup timer
  private cleanupTimer: NodeJS.Timeout | null = null;
  // Cleanup interval in ms (default 1 minute)
  private cleanupInterval: number = 60 * 1000;

  constructor(wireguard: WireGuard, conflictDetector: ConflictDetector) {
    super();
    this.wireguard = wireguard;
    this.conflictDetector = conflictDetector;
  }

  /**
   * Start the route manager
   * Captures original allowed-ips and starts cleanup timer
   */
  async start(): Promise<void> {
    // Capture original allowed-ips
    this.originalAllowedIps = await this.wireguard.getAllowedIps();
    this.emit('started', { originalIps: this.originalAllowedIps });

    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Stop the route manager and restore original routes
   */
  async stop(): Promise<void> {
    this.stopCleanupTimer();

    // Remove all injected IPs
    await this.clearAllRoutes();

    this.emit('stopped');
  }

  /**
   * Inject IPs for a domain
   */
  async injectRoutes(domain: string, ips: string[], ttl: number): Promise<void> {
    const now = Date.now();
    const normalizedDomain = domain.toLowerCase();
    const ipsToInject: string[] = [];

    for (const ip of ips) {
      // Skip if IP has conflict (should go through SNI proxy instead)
      if (this.conflictDetector.hasConflict(ip)) {
        this.emit('route-skipped', {
          ip,
          domain: normalizedDomain,
          reason: 'conflict',
        });
        continue;
      }

      const ipWithMask = ip.includes('/') ? ip : `${ip}/32`;

      // Check if already injected
      const existing = this.injectedRoutes.get(ipWithMask);
      if (existing) {
        // Update TTL if from same domain
        if (existing.domain === normalizedDomain) {
          existing.ttl = ttl;
          existing.expiresAt = now + ttl * 1000;
          this.injectedRoutes.set(ipWithMask, existing);
        }
        continue;
      }

      // Check if in original allowed-ips (don't track these)
      if (this.originalAllowedIps.includes(ipWithMask)) {
        continue;
      }

      ipsToInject.push(ipWithMask);

      // Track the route
      this.injectedRoutes.set(ipWithMask, {
        ip: ipWithMask,
        domain: normalizedDomain,
        injectedAt: now,
        ttl,
        expiresAt: now + ttl * 1000,
      });

      // Track domain → IPs mapping
      const domainIps = this.domainToIps.get(normalizedDomain) || new Set();
      domainIps.add(ipWithMask);
      this.domainToIps.set(normalizedDomain, domainIps);
    }

    if (ipsToInject.length > 0) {
      try {
        await this.wireguard.addAllowedIps(ipsToInject);
        this.emit('routes-injected', {
          domain: normalizedDomain,
          ips: ipsToInject,
          ttl,
        });
      } catch (err) {
        // Rollback tracking on failure
        for (const ip of ipsToInject) {
          this.injectedRoutes.delete(ip);
          const domainIps = this.domainToIps.get(normalizedDomain);
          if (domainIps) {
            domainIps.delete(ip);
          }
        }
        throw err;
      }
    }
  }

  /**
   * Remove routes for a domain
   */
  async removeRoutesForDomain(domain: string): Promise<void> {
    const normalizedDomain = domain.toLowerCase();
    const domainIps = this.domainToIps.get(normalizedDomain);

    if (!domainIps || domainIps.size === 0) {
      return;
    }

    const ipsToRemove = Array.from(domainIps);

    try {
      await this.wireguard.removeAllowedIps(ipsToRemove);

      // Clean up tracking
      for (const ip of ipsToRemove) {
        this.injectedRoutes.delete(ip);
      }
      this.domainToIps.delete(normalizedDomain);

      this.emit('routes-removed', {
        domain: normalizedDomain,
        ips: ipsToRemove,
      });
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Remove a specific IP route
   */
  async removeRoute(ip: string): Promise<void> {
    const ipWithMask = ip.includes('/') ? ip : `${ip}/32`;
    const route = this.injectedRoutes.get(ipWithMask);

    if (!route) {
      return;
    }

    try {
      await this.wireguard.removeAllowedIps([ipWithMask]);

      // Clean up tracking
      this.injectedRoutes.delete(ipWithMask);
      const domainIps = this.domainToIps.get(route.domain);
      if (domainIps) {
        domainIps.delete(ipWithMask);
        if (domainIps.size === 0) {
          this.domainToIps.delete(route.domain);
        }
      }

      this.emit('route-removed', { ip: ipWithMask, domain: route.domain });
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Clear all injected routes
   */
  async clearAllRoutes(): Promise<void> {
    const allInjectedIps = Array.from(this.injectedRoutes.keys());

    if (allInjectedIps.length === 0) {
      return;
    }

    try {
      await this.wireguard.removeAllowedIps(allInjectedIps);

      this.injectedRoutes.clear();
      this.domainToIps.clear();

      this.emit('routes-cleared', { count: allInjectedIps.length });
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Clean up expired routes
   */
  async cleanupExpiredRoutes(): Promise<void> {
    const now = Date.now();
    const expiredIps: string[] = [];

    for (const [ip, route] of this.injectedRoutes) {
      if (route.expiresAt < now) {
        expiredIps.push(ip);
      }
    }

    if (expiredIps.length > 0) {
      try {
        await this.wireguard.removeAllowedIps(expiredIps);

        for (const ip of expiredIps) {
          const route = this.injectedRoutes.get(ip);
          if (route) {
            const domainIps = this.domainToIps.get(route.domain);
            if (domainIps) {
              domainIps.delete(ip);
              if (domainIps.size === 0) {
                this.domainToIps.delete(route.domain);
              }
            }
          }
          this.injectedRoutes.delete(ip);
        }

        this.emit('routes-expired', { ips: expiredIps, count: expiredIps.length });
      } catch (err) {
        this.emit('error', err);
      }
    }
  }

  /**
   * Get all injected routes
   */
  getInjectedRoutes(): InjectedRoute[] {
    return Array.from(this.injectedRoutes.values());
  }

  /**
   * Get routes for a domain
   */
  getRoutesForDomain(domain: string): string[] {
    const domainIps = this.domainToIps.get(domain.toLowerCase());
    return domainIps ? Array.from(domainIps) : [];
  }

  /**
   * Get statistics
   */
  getStats(): RouteStats {
    const conflictingIps = this.conflictDetector.getConflictingIps();

    return {
      totalInjected: this.injectedRoutes.size,
      uniqueIps: this.injectedRoutes.size,
      uniqueDomains: this.domainToIps.size,
      conflictingIps: conflictingIps.length,
    };
  }

  /**
   * Check if a domain has any injected routes
   */
  hasRoutesForDomain(domain: string): boolean {
    const domainIps = this.domainToIps.get(domain.toLowerCase());
    return domainIps !== undefined && domainIps.size > 0;
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredRoutes().catch((err) => {
        this.emit('error', err);
      });
    }, this.cleanupInterval);
  }

  /**
   * Stop cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Set cleanup interval
   */
  setCleanupInterval(intervalMs: number): void {
    this.cleanupInterval = intervalMs;
    if (this.cleanupTimer) {
      this.stopCleanupTimer();
      this.startCleanupTimer();
    }
  }
}

// Factory function
export function createRouteManager(
  wireguard: WireGuard,
  conflictDetector: ConflictDetector
): RouteManager {
  return new RouteManager(wireguard, conflictDetector);
}
