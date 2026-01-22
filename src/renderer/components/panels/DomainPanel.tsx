import React, { useState } from 'react';
import { DomainRule } from '../../types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Shield, Link, X, Asterisk } from 'lucide-react';

interface DomainPanelProps {
  domains: DomainRule[];
  onAdd: (pattern: string, tunnel: boolean) => Promise<{ success: boolean; error?: string }>;
  onRemove: (pattern: string) => Promise<boolean>;
}

export function DomainPanel({ domains, onAdd, onRemove }: DomainPanelProps) {
  const [newPattern, setNewPattern] = useState('');
  const [routeType, setRouteType] = useState<'tunnel' | 'direct'>('tunnel');
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
      const result = await onAdd(newPattern.trim(), routeType === 'tunnel');
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
    <div className="h-full flex flex-col bg-background">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold">Domain Rules</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage VPN routing rules
        </p>
      </div>

      <div className="p-4 border-b space-y-3">
        <form onSubmit={handleSubmit} className="space-y-2">
          <Input
            type="text"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="example.com or *.example.com"
            className="font-mono"
          />

          <div className="flex gap-2">
            <Select value={routeType} onValueChange={(v) => setRouteType(v as 'tunnel' | 'direct')}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tunnel">Tunnel via VPN</SelectItem>
                <SelectItem value="direct">Direct Connection</SelectItem>
              </SelectContent>
            </Select>

            <Button
              type="submit"
              disabled={isAdding || !newPattern.trim()}
              className="px-6"
            >
              {isAdding ? 'Adding...' : 'Add'}
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <p className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 rounded">*.domain.com</code> for wildcards
          </p>
        </form>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {tunnelDomains.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-green-500" />
                <h3 className="text-sm font-medium text-green-500">
                  Tunneled ({tunnelDomains.length})
                </h3>
              </div>
              <div className="space-y-2">
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
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Link className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-muted-foreground">
                  Direct ({directDomains.length})
                </h3>
              </div>
              <div className="space-y-2">
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
            <div className="py-8 text-center text-muted-foreground">
              <p className="text-sm">No domain rules configured</p>
              <p className="text-xs mt-1">Add your first domain above</p>
            </div>
          )}
        </div>
      </ScrollArea>
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
    <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg group hover:bg-muted transition-colors">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isWildcard && (
          <Badge variant="outline" className="h-5 px-1.5 text-xs shrink-0">
            <Asterisk className="w-3 h-3" />
          </Badge>
        )}
        <span className="text-sm font-mono truncate">{domain.pattern}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 h-8 w-8 shrink-0 hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
