import React, { useState } from 'react';
import { DomainRule } from '../types';

interface DomainListProps {
  domains: DomainRule[];
  onAdd: (pattern: string, tunnel: boolean) => Promise<{ success: boolean; error?: string }>;
  onRemove: (pattern: string) => Promise<boolean>;
}

export function DomainList({ domains, onAdd, onRemove }: DomainListProps) {
  const [newPattern, setNewPattern] = useState('');
  const [isTunnel, setIsTunnel] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const tunnelDomains = domains.filter((d) => d.tunnel);
  const directDomains = domains.filter((d) => !d.tunnel);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPattern.trim()) return;

    setIsAdding(true);
    setError(null);

    try {
      const result = await onAdd(newPattern.trim(), isTunnel);
      if (result.success) {
        setNewPattern('');
      } else {
        setError(result.error || 'Failed to add domain');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = async (pattern: string) => {
    try {
      await onRemove(pattern);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-white">Domain Rules</h2>
        <p className="text-sm text-gray-400 mt-1">
          Add domains to route through the VPN tunnel
        </p>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-3 border-b border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="example.com or *.example.com"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <select
            value={isTunnel ? 'tunnel' : 'direct'}
            onChange={(e) => setIsTunnel(e.target.value === 'tunnel')}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
          >
            <option value="tunnel">Tunnel</option>
            <option value="direct">Direct</option>
          </select>
          <button
            type="submit"
            disabled={isAdding || !newPattern.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            {isAdding ? '...' : 'Add'}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-400">{error}</p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          Use <code className="bg-gray-800 px-1 rounded">*.domain.com</code> for wildcard subdomains
        </p>
      </form>

      <div className="flex-1 overflow-auto">
        {tunnelDomains.length > 0 && (
          <div className="px-4 py-3">
            <h3 className="text-sm font-medium text-green-400 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Tunneled ({tunnelDomains.length})
            </h3>
            <div className="space-y-1">
              {tunnelDomains.map((domain) => (
                <DomainItem
                  key={domain.pattern}
                  domain={domain}
                  onRemove={() => handleRemove(domain.pattern)}
                />
              ))}
            </div>
          </div>
        )}

        {directDomains.length > 0 && (
          <div className="px-4 py-3">
            <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Direct ({directDomains.length})
            </h3>
            <div className="space-y-1">
              {directDomains.map((domain) => (
                <DomainItem
                  key={domain.pattern}
                  domain={domain}
                  onRemove={() => handleRemove(domain.pattern)}
                />
              ))}
            </div>
          </div>
        )}

        {domains.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">
            No domain rules configured
          </div>
        )}
      </div>
    </div>
  );
}

interface DomainItemProps {
  domain: DomainRule;
  onRemove: () => void;
}

function DomainItem({ domain, onRemove }: DomainItemProps) {
  const isWildcard = domain.pattern.startsWith('*.');

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-gray-800/50 rounded-lg group hover:bg-gray-800">
      <div className="flex items-center gap-2">
        {isWildcard && (
          <span className="text-xs px-1.5 py-0.5 bg-purple-600/30 text-purple-400 rounded">
            *
          </span>
        )}
        <span className="text-sm text-gray-200 font-mono">{domain.pattern}</span>
      </div>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400 transition-opacity"
        title="Remove"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
