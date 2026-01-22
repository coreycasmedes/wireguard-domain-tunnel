import React from 'react';
import { IpConflict } from '../types';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { AlertTriangle } from 'lucide-react';

interface ConflictWarningsProps {
  conflicts: IpConflict[];
}

export function ConflictWarnings({ conflicts }: ConflictWarningsProps) {
  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className="p-4 border-b bg-amber-500/5">
      <Alert variant="default" className="border-amber-500/50">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <AlertTitle className="text-amber-500">
          IP Conflicts Detected ({conflicts.length})
        </AlertTitle>
        <AlertDescription className="mt-2 space-y-2">
          {conflicts.map((conflict) => (
            <ConflictItem key={conflict.ip} conflict={conflict} />
          ))}
          <p className="text-xs text-muted-foreground mt-3">
            These domains share the same IP address. Traffic will be routed through the SNI proxy
            on port 1080 for proper domain-based routing.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

interface ConflictItemProps {
  conflict: IpConflict;
}

function ConflictItem({ conflict }: ConflictItemProps) {
  return (
    <div className="p-3 bg-muted/50 border rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="outline" className="font-mono">
          {conflict.ip}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-green-500 font-medium">Tunneled:</span>
          <div className="mt-1 space-y-0.5">
            {conflict.tunnelDomains.map((domain) => (
              <div key={domain} className="font-mono text-muted-foreground">
                {domain}
              </div>
            ))}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground font-medium">Direct:</span>
          <div className="mt-1 space-y-0.5">
            {conflict.directDomains.map((domain) => (
              <div key={domain} className="font-mono text-muted-foreground">
                {domain}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
