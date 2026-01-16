import React, { useRef, useEffect } from 'react';
import { LogEntry } from '../types';

interface ActivityLogProps {
  entries: LogEntry[];
  onClear: () => void;
}

export function ActivityLog({ entries, onClear }: ActivityLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to top when new entries arrive
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  const getTypeColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'query':
        return 'text-blue-400';
      case 'response':
        return 'text-green-400';
      case 'route':
        return 'text-purple-400';
      case 'error':
        return 'text-red-400';
      case 'info':
      default:
        return 'text-gray-400';
    }
  };

  const getTypeIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'query':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'response':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'route':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'info':
      default:
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
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
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-white">Activity Log</h2>
        <button
          onClick={onClear}
          disabled={entries.length === 0}
          className="text-sm text-gray-400 hover:text-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed"
        >
          Clear
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500">
            No activity yet
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="px-4 py-2 hover:bg-gray-800/30 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 ${getTypeColor(entry.type)}`}>
                    {getTypeIcon(entry.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-200">{entry.message}</span>
                    </div>
                    {entry.details && (
                      <div className="mt-1 text-xs text-gray-500 font-mono">
                        {Object.entries(entry.details).map(([key, value]) => (
                          <span key={key} className="mr-3">
                            <span className="text-gray-600">{key}:</span>{' '}
                            <span className="text-gray-400">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-gray-600 whitespace-nowrap">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
