import React, { useState, useEffect } from 'react';
import { WireGuardInterface, WireGuardSettings } from '../types';

interface WireGuardConfigProps {
  settings: WireGuardSettings;
  onSettingsChange: (settings: Partial<WireGuardSettings>) => void;
}

export function WireGuardConfig({ settings, onSettingsChange }: WireGuardConfigProps) {
  const [interfaces, setInterfaces] = useState<WireGuardInterface[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(true);
  const [manualMode, setManualMode] = useState(!settings.autoDetect);

  useEffect(() => {
    loadInterfaces();
  }, []);

  const loadInterfaces = async () => {
    setIsLoading(true);
    try {
      const available = await window.api.wireguard.isAvailable();
      setIsAvailable(available);

      if (available) {
        const ifaces = await window.api.wireguard.getInterfaces();
        setInterfaces(ifaces);

        // Auto-select first interface and peer if auto-detect is enabled
        if (settings.autoDetect && ifaces.length > 0 && !settings.interfaceName) {
          const firstIface = ifaces[0];
          if (firstIface.peers.length > 0) {
            onSettingsChange({
              interfaceName: firstIface.name,
              peerPublicKey: firstIface.peers[0].publicKey,
            });
          }
        }
      }
    } catch (err) {
      console.error('Failed to load WireGuard interfaces:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedInterface = interfaces.find((i) => i.name === settings.interfaceName);
  const peers = selectedInterface?.peers || [];

  const handleInterfaceChange = (name: string) => {
    const iface = interfaces.find((i) => i.name === name);
    onSettingsChange({
      interfaceName: name,
      peerPublicKey: iface?.peers[0]?.publicKey || '',
    });
  };

  if (!isAvailable) {
    return (
      <div className="p-4">
        <div className="px-4 py-3 bg-amber-900/30 border border-amber-700 rounded-lg">
          <div className="flex items-center gap-2 text-amber-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium">WireGuard not found</span>
          </div>
          <p className="mt-2 text-sm text-amber-300/80">
            Please install WireGuard tools to use this application.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            macOS: <code className="bg-gray-800 px-1 rounded">brew install wireguard-tools</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">WireGuard Configuration</h3>
        <button
          onClick={loadInterfaces}
          disabled={isLoading}
          className="text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500"
        >
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Interface</label>
          <select
            value={settings.interfaceName}
            onChange={(e) => handleInterfaceChange(e.target.value)}
            disabled={isLoading || manualMode}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:text-gray-500"
          >
            <option value="">Select interface...</option>
            {interfaces.map((iface) => (
              <option key={iface.name} value={iface.name}>
                {iface.name} {iface.listenPort ? `(:${iface.listenPort})` : ''}
              </option>
            ))}
          </select>
          {interfaces.length === 0 && !isLoading && (
            <p className="mt-1 text-xs text-amber-400">
              No active WireGuard interfaces found
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Peer</label>
          <select
            value={settings.peerPublicKey}
            onChange={(e) => onSettingsChange({ peerPublicKey: e.target.value })}
            disabled={isLoading || !settings.interfaceName || manualMode}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:text-gray-500"
          >
            <option value="">Select peer...</option>
            {peers.map((peer) => (
              <option key={peer.publicKey} value={peer.publicKey}>
                {peer.publicKey.substring(0, 20)}... {peer.endpoint ? `(${peer.endpoint})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="pt-2 border-t border-gray-800">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={manualMode}
              onChange={(e) => {
                setManualMode(e.target.checked);
                onSettingsChange({ autoDetect: !e.target.checked });
              }}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
            />
            <span className="text-sm text-gray-400">Manual configuration</span>
          </label>
        </div>

        {manualMode && (
          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Interface Name</label>
              <input
                type="text"
                value={settings.interfaceName}
                onChange={(e) => onSettingsChange({ interfaceName: e.target.value })}
                placeholder="utun3"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Peer Public Key</label>
              <input
                type="text"
                value={settings.peerPublicKey}
                onChange={(e) => onSettingsChange({ peerPublicKey: e.target.value })}
                placeholder="Base64 public key..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {selectedInterface && (
        <div className="pt-3 border-t border-gray-800">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Current Allowed IPs</h4>
          <div className="text-xs text-gray-500 font-mono bg-gray-800/50 p-2 rounded max-h-24 overflow-auto">
            {peers
              .find((p) => p.publicKey === settings.peerPublicKey)
              ?.allowedIps.join(', ') || 'None'}
          </div>
        </div>
      )}
    </div>
  );
}
