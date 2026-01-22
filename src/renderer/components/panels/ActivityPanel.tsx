import React, { useState, useRef, useEffect, useMemo } from 'react';
import { LogEntry } from '../../types';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import {
  Search,
  Trash2,
  MessageSquare,
  CheckCircle2,
  Route,
  AlertCircle,
  Info
} from 'lucide-react';

interface ActivityPanelProps {
  entries: LogEntry[];
  onClear: () => void;
}

export function ActivityPanel({ entries, onClear }: ActivityPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<LogEntry['type'] | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top when new entries arrive (if enabled)
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length, autoScroll]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesType = typeFilter === 'all' || entry.type === typeFilter;
      const matchesSearch =
        searchQuery === '' ||
        entry.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        JSON.stringify(entry.details || {}).toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [entries, typeFilter, searchQuery]);

  const getTypeIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'query':
        return <MessageSquare className="w-4 h-4" />;
      case 'response':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'route':
        return <Route className="w-4 h-4" />;
      case 'error':
        return <AlertCircle className="w-4 h-4" />;
      case 'info':
      default:
        return <Info className="w-4 h-4" />;
    }
  };

  const getTypeBadgeVariant = (type: LogEntry['type']): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (type) {
      case 'query':
        return 'default';
      case 'response':
        return 'outline';
      case 'route':
        return 'secondary';
      case 'error':
        return 'destructive';
      case 'info':
      default:
        return 'outline';
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Activity Log</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAutoScroll(!autoScroll)}
              className={autoScroll ? 'text-primary' : 'text-muted-foreground'}
            >
              Auto-scroll {autoScroll ? '✓' : ''}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={entries.length === 0}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Clear
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as LogEntry['type'] | 'all')}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="query">Query</SelectItem>
              <SelectItem value="response">Response</SelectItem>
              <SelectItem value="route">Route</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {filteredEntries.length} of {entries.length} entries
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1" ref={scrollRef}>
        {filteredEntries.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {entries.length === 0 ? 'No activity yet' : 'No matching entries'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className="px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Badge variant={getTypeBadgeVariant(entry.type)} className="mt-0.5 gap-1">
                    {getTypeIcon(entry.type)}
                    <span className="uppercase text-xs">{entry.type}</span>
                  </Badge>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-relaxed break-words">{entry.message}</p>
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <div className="mt-2 p-2 bg-muted/50 rounded text-xs font-mono">
                        {Object.entries(entry.details).map(([key, value]) => (
                          <div key={key} className="flex gap-2">
                            <span className="text-muted-foreground">{key}:</span>
                            <span className="text-foreground break-all">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 mt-0.5">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
