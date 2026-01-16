import React, { useState, useEffect, useCallback } from 'react';
import { StatusBar } from './renderer/components/StatusBar';
import { DomainList } from './renderer/components/DomainList';
import { WireGuardConfig } from './renderer/components/WireGuardConfig';
import { DnsConfig } from './renderer/components/DnsConfig';
import { ActivityLog } from './renderer/components/ActivityLog';
import { ConflictWarnings } from './renderer/components/ConflictWarnings';
import {
  DomainRule,
  WireGuardSettings,
  DnsSettings,
  LogEntry,
  IpConflict,
  AppStatus,
} from './renderer/types';

type Tab = 'domains' | 'settings' | 'log';

const App = () => {
  // State
  const [activeTab, setActiveTab] = useState<Tab>('domains');
  const [domains, setDomains] = useState<DomainRule[]>([]);
  const [wgSettings, setWgSettings] = useState<WireGuardSettings>({
    interfaceName: '',
    peerPublicKey: '',
    autoDetect: true,
  });
  const [dnsSettings, setDnsSettings] = useState<DnsSettings>({
    tunnelUpstream: { host: '8.8.8.8', port: 53 },
    directUpstream: { host: '1.1.1.1', port: 53 },
    proxyPort: 5353,
  });
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [conflicts, setConflicts] = useState<IpConflict[]>([]);
  const [status, setStatus] = useState<AppStatus>({
    dnsProxyRunning: false,
    sniProxyRunning: false,
    systemDnsConfigured: false,
    wireguardConnected: false,
    totalInjectedRoutes: 0,
    activeConflicts: 0,
  });
  const [isLoading, setIsLoading] = useState(false);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [domainsData, wgData, dnsData, statusData, conflictsData, logsData] =
          await Promise.all([
            window.api.domains.getAll(),
            window.api.wireguard.getSettings(),
            window.api.dns.getSettings(),
            window.api.proxy.getStatus(),
            window.api.conflicts.getAll(),
            window.api.log.getRecent(100),
          ]);

        setDomains(domainsData);
        setWgSettings(wgData);
        setDnsSettings(dnsData);
        setStatus(statusData);
        setConflicts(conflictsData);
        setLogEntries(logsData);
      } catch (err) {
        console.error('Failed to load initial data:', err);
      }
    };

    loadInitialData();
  }, []);

  // Subscribe to events
  useEffect(() => {
    const unsubStatus = window.api.status.onUpdate((newStatus) => {
      setStatus(newStatus);
    });

    const unsubLog = window.api.log.onEntry((entry) => {
      setLogEntries((prev) => [entry, ...prev].slice(0, 500));
    });

    const unsubConflictDetected = window.api.conflicts.onConflictDetected((conflict) => {
      setConflicts((prev) => {
        const existing = prev.findIndex((c) => c.ip === conflict.ip);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = conflict;
          return updated;
        }
        return [conflict, ...prev];
      });
    });

    const unsubConflictResolved = window.api.conflicts.onConflictResolved((ip) => {
      setConflicts((prev) => prev.filter((c) => c.ip !== ip));
    });

    return () => {
      unsubStatus();
      unsubLog();
      unsubConflictDetected();
      unsubConflictResolved();
    };
  }, []);

  // Handlers
  const handleAddDomain = useCallback(
    async (pattern: string, tunnel: boolean) => {
      const result = await window.api.domains.add(pattern, tunnel);
      if (result.success) {
        const updated = await window.api.domains.getAll();
        setDomains(updated);
      }
      return result;
    },
    []
  );

  const handleRemoveDomain = useCallback(async (pattern: string) => {
    const removed = await window.api.domains.remove(pattern);
    if (removed) {
      const updated = await window.api.domains.getAll();
      setDomains(updated);
    }
    return removed;
  }, []);

  const handleWgSettingsChange = useCallback(
    async (settings: Partial<WireGuardSettings>) => {
      await window.api.wireguard.setSettings(settings);
      setWgSettings((prev) => ({ ...prev, ...settings }));
    },
    []
  );

  const handleDnsSettingsChange = useCallback(
    async (settings: Partial<DnsSettings>) => {
      await window.api.dns.setSettings(settings);
      setDnsSettings((prev) => ({ ...prev, ...settings }));
    },
    []
  );

  const handleStart = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.api.proxy.start();
      if (!result.success) {
        console.error('Failed to start:', result.error);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleStop = useCallback(async () => {
    setIsLoading(true);
    try {
      await window.api.proxy.stop();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleClearLog = useCallback(async () => {
    await window.api.log.clear();
    setLogEntries([]);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Draggable title bar area */}
      <div className="h-8 bg-gray-900 flex items-center justify-center" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <span className="text-xs text-gray-500">WireGuard Domain Tunnel</span>
      </div>

      {/* Status bar */}
      <StatusBar
        status={status}
        onStart={handleStart}
        onStop={handleStop}
        isLoading={isLoading}
      />

      {/* Conflict warnings */}
      {conflicts.length > 0 && <ConflictWarnings conflicts={conflicts} />}

      {/* Tab navigation */}
      <div className="flex border-b border-gray-800">
        <TabButton
          active={activeTab === 'domains'}
          onClick={() => setActiveTab('domains')}
        >
          Domains
          {domains.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-700 rounded">
              {domains.length}
            </span>
          )}
        </TabButton>
        <TabButton
          active={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </TabButton>
        <TabButton
          active={activeTab === 'log'}
          onClick={() => setActiveTab('log')}
        >
          Activity
          {logEntries.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-700 rounded">
              {logEntries.length}
            </span>
          )}
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'domains' && (
          <DomainList
            domains={domains}
            onAdd={handleAddDomain}
            onRemove={handleRemoveDomain}
          />
        )}

        {activeTab === 'settings' && (
          <div className="h-full overflow-auto">
            <WireGuardConfig
              settings={wgSettings}
              onSettingsChange={handleWgSettingsChange}
            />
            <div className="border-t border-gray-800" />
            <DnsConfig
              settings={dnsSettings}
              onSettingsChange={handleDnsSettingsChange}
            />
          </div>
        )}

        {activeTab === 'log' && (
          <ActivityLog entries={logEntries} onClear={handleClearLog} />
        )}
      </div>
    </div>
  );
};

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? 'text-white border-b-2 border-blue-500 -mb-px'
          : 'text-gray-400 hover:text-gray-300'
      }`}
    >
      {children}
    </button>
  );
}

export default App;
