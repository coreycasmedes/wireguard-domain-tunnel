import React from 'react';
import { IpConflict } from '../types';

interface ConflictWarningsProps {
  conflicts: IpConflict[];
}

export function ConflictWarnings({ conflicts }: ConflictWarningsProps) {
  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className="p-4 border-b border-gray-800">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="text-sm font-medium text-amber-400">
          IP Conflicts Detected ({conflicts.length})
        </h3>
      </div>

      <div className="space-y-2">
        {conflicts.map((conflict) => (
          <ConflictItem key={conflict.ip} conflict={conflict} />
        ))}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        These domains share the same IP address. Traffic will be routed through the SNI proxy
        on port 1080 for proper domain-based routing.
      </p>
    </div>
  );
}

interface ConflictItemProps {
  conflict: IpConflict;
}

function ConflictItem({ conflict }: ConflictItemProps) {
  return (
    <div className="p-3 bg-amber-900/20 border border-amber-800/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-mono text-amber-300">{conflict.ip}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-green-400 font-medium">Tunneled:</span>
          <div className="mt-1 space-y-0.5">
            {conflict.tunnelDomains.map((domain) => (
              <div key={domain} className="text-gray-300 font-mono">
                {domain}
              </div>
            ))}
          </div>
        </div>
        <div>
          <span className="text-gray-400 font-medium">Direct:</span>
          <div className="mt-1 space-y-0.5">
            {conflict.directDomains.map((domain) => (
              <div key={domain} className="text-gray-300 font-mono">
                {domain}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
