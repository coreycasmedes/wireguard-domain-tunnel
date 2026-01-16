/**
 * Domain Matcher Module
 *
 * Handles wildcard pattern matching for domain rules:
 * - `example.com` → matches exactly `example.com` only
 * - `*.example.com` → matches all subdomains but NOT example.com itself
 */

export interface DomainRule {
  pattern: string;
  tunnel: boolean;
}

export class DomainMatcher {
  private rules: Map<string, DomainRule> = new Map();

  /**
   * Add a domain rule
   */
  addRule(pattern: string, tunnel: boolean): void {
    const normalized = this.normalizePattern(pattern);
    this.rules.set(normalized, { pattern: normalized, tunnel });
  }

  /**
   * Remove a domain rule
   */
  removeRule(pattern: string): boolean {
    const normalized = this.normalizePattern(pattern);
    return this.rules.delete(normalized);
  }

  /**
   * Get all rules
   */
  getRules(): DomainRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get rules that should be tunneled
   */
  getTunnelRules(): DomainRule[] {
    return this.getRules().filter((rule) => rule.tunnel);
  }

  /**
   * Get rules that should go direct
   */
  getDirectRules(): DomainRule[] {
    return this.getRules().filter((rule) => !rule.tunnel);
  }

  /**
   * Clear all rules
   */
  clearRules(): void {
    this.rules.clear();
  }

  /**
   * Load rules from array (for persistence)
   */
  loadRules(rules: DomainRule[]): void {
    this.rules.clear();
    for (const rule of rules) {
      this.addRule(rule.pattern, rule.tunnel);
    }
  }

  /**
   * Check if a domain matches any rule and should be tunneled
   * Returns: { matched: boolean, tunnel: boolean, matchedRule?: string }
   */
  match(domain: string): { matched: boolean; tunnel: boolean; matchedRule?: string } {
    const normalizedDomain = domain.toLowerCase();

    // Check exact match first
    const exactRule = this.rules.get(normalizedDomain);
    if (exactRule) {
      return { matched: true, tunnel: exactRule.tunnel, matchedRule: exactRule.pattern };
    }

    // Check wildcard matches
    // For a domain like "api.example.com", we need to check:
    // - *.example.com (matches)
    // - *.api.example.com (would match sub.api.example.com)
    const parts = normalizedDomain.split('.');

    for (let i = 1; i < parts.length; i++) {
      const wildcardPattern = '*.' + parts.slice(i).join('.');
      const wildcardRule = this.rules.get(wildcardPattern);
      if (wildcardRule) {
        return { matched: true, tunnel: wildcardRule.tunnel, matchedRule: wildcardRule.pattern };
      }
    }

    // No match - not tunneled by default
    return { matched: false, tunnel: false };
  }

  /**
   * Check if a domain should be tunneled (convenience method)
   */
  shouldTunnel(domain: string): boolean {
    return this.match(domain).tunnel;
  }

  /**
   * Normalize a pattern for consistent storage
   */
  private normalizePattern(pattern: string): string {
    return pattern.toLowerCase().trim();
  }

  /**
   * Validate a pattern
   */
  static isValidPattern(pattern: string): { valid: boolean; error?: string } {
    if (!pattern || pattern.trim().length === 0) {
      return { valid: false, error: 'Pattern cannot be empty' };
    }

    const normalized = pattern.toLowerCase().trim();

    // Check for valid wildcard format
    if (normalized.includes('*')) {
      // Only allow wildcard at the start in the form *.domain
      if (!normalized.startsWith('*.')) {
        return { valid: false, error: 'Wildcard must be at the start in the form *.domain.com' };
      }
      // Check there's only one wildcard
      if ((normalized.match(/\*/g) || []).length > 1) {
        return { valid: false, error: 'Only one wildcard is allowed' };
      }
      // Check there's something after the wildcard
      if (normalized.length <= 2) {
        return { valid: false, error: 'Wildcard must be followed by a domain' };
      }
    }

    // Basic domain validation
    const domainPart = normalized.startsWith('*.') ? normalized.slice(2) : normalized;
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

    if (!domainRegex.test(domainPart)) {
      return { valid: false, error: 'Invalid domain format' };
    }

    return { valid: true };
  }
}

// Export singleton instance
export const domainMatcher = new DomainMatcher();
