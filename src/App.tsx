import React, { useState, useEffect, useCallback } from 'react';
import { DomainPanel } from './renderer/components/panels/DomainPanel';
import { ActivityPanel } from './renderer/components/panels/ActivityPanel';
import { SettingsPanel } from './renderer/components/panels/SettingsPanel';
import { ConflictWarnings } from './renderer/components/ConflictWarnings';
import {
  DomainRule,
  WireGuardSettings,
  DnsSettings,
  LogEntry,
  IpConflict,
  AppStatus,
} from './renderer/types';

const App = () => {
  // State
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
    <div className="h-screen flex flex-col bg-background">
      {/* Draggable title bar area */}
      <div
        className="h-8 bg-muted flex items-center justify-center border-b"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-xs text-muted-foreground">WireGuard Domain Tunnel</span>
      </div>

      {/* Conflict warnings - spans full width */}
      {conflicts.length > 0 && <ConflictWarnings conflicts={conflicts} />}

      {/* 3-Panel Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Domain Management */}
        <div className="w-80 border-r flex-shrink-0">
          <DomainPanel
            domains={domains}
            onAdd={handleAddDomain}
            onRemove={handleRemoveDomain}
          />
        </div>

        {/* Center Panel - Activity Log */}
        <div className="flex-1 min-w-0">
          <ActivityPanel
            entries={logEntries}
            onClear={handleClearLog}
          />
        </div>

        {/* Right Panel - Settings & Status */}
        <div className="w-96 border-l flex-shrink-0">
          <SettingsPanel
            status={status}
            wgSettings={wgSettings}
            dnsSettings={dnsSettings}
            onStart={handleStart}
            onStop={handleStop}
            onWgSettingsChange={handleWgSettingsChange}
            onDnsSettingsChange={handleDnsSettingsChange}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default App;
