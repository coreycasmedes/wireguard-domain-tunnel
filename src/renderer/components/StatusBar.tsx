import React from 'react';
import { AppStatus } from '../types';

interface StatusBarProps {
  status: AppStatus;
  onStart: () => void;
  onStop: () => void;
  isLoading: boolean;
}

export function StatusBar({ status, onStart, onStop, isLoading }: StatusBarProps) {
  const isRunning = status.dnsProxyRunning;

  return (
    <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-800">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
            }`}
          />
          <span className="text-sm font-medium text-gray-300">
            {isRunning ? 'Active' : 'Inactive'}
          </span>
        </div>

        {isRunning && (
          <>
            <div className="text-sm text-gray-400">
              <span className="text-gray-500">Routes:</span>{' '}
              <span className="text-white font-mono">{status.totalInjectedRoutes}</span>
            </div>

            {status.activeConflicts > 0 && (
              <div className="text-sm text-amber-400">
                <span className="text-amber-500">Conflicts:</span>{' '}
                <span className="font-mono">{status.activeConflicts}</span>
              </div>
            )}
          </>
        )}

        {!status.wireguardConnected && (
          <div className="text-sm text-amber-400">
            WireGuard not configured
          </div>
        )}
      </div>

      <button
        onClick={isRunning ? onStop : onStart}
        disabled={isLoading || (!isRunning && !status.wireguardConnected)}
        className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
          isRunning
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-green-600 hover:bg-green-700 text-white disabled:bg-gray-700 disabled:text-gray-500'
        } disabled:cursor-not-allowed`}
      >
        {isLoading ? 'Loading...' : isRunning ? 'Stop' : 'Start'}
      </button>
    </div>
  );
}
