import React, { useState, useEffect } from 'react';
import { WireGuardInterface, WireGuardSettings, TunnelDetectionResult } from '../types';

interface WireGuardConfigProps {
  settings: WireGuardSettings;
  onSettingsChange: (settings: Partial<WireGuardSettings>) => void;
}

export function WireGuardConfig({ settings, onSettingsChange }: WireGuardConfigProps) {
  const [detectionResult, setDetectionResult] = useState<TunnelDetectionResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(true);
  const [manualMode, setManualMode] = useState(!settings.autoDetect);

  useEffect(() => {
    detectTunnels();
  }, []);

  const detectTunnels = async () => {
    setIsLoading(true);
    try {
      const available = await window.api.wireguard.isAvailable();
      setIsAvailable(available);

      if (available) {
        const result = await window.api.wireguard.detectTunnels();
        setDetectionResult(result);

        // Auto-select first native interface if available and auto-detect is enabled
        if (settings.autoDetect && result.nativeInterfaces.length > 0 && !settings.interfaceName) {
          const firstIface = result.nativeInterfaces[0];
          if (firstIface.peers.length > 0) {
            onSettingsChange({
              interfaceName: firstIface.name,
              peerPublicKey: firstIface.peers[0].publicKey,
            });
          }
        }

        // If a third-party VPN is detected, switch to manual mode and auto-fill
        if (result.status === 'third_party_detected' && !settings.peerPublicKey) {
          const connectedVPN = result.thirdPartyVPNs.find((v) => v.connected && v.publicKey);
          if (connectedVPN) {
            setManualMode(true);
            onSettingsChange({
              interfaceName: connectedVPN.interfaceName || settings.interfaceName,
              peerPublicKey: connectedVPN.publicKey || settings.peerPublicKey,
              autoDetect: false,
            });
          }
        }
      }
    } catch (err) {
      console.error('Failed to detect tunnels:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const interfaces = detectionResult?.nativeInterfaces || [];
  const thirdPartyVPNs = detectionResult?.thirdPartyVPNs || [];
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

  // Render detection status
  const renderDetectionStatus = () => {
    if (!detectionResult) return null;

    const { status, summary, thirdPartyVPNs } = detectionResult;
    const connectedVPNs = thirdPartyVPNs.filter((v) => v.connected);

    if (status === 'native_available') {
      return (
        <div className="px-4 py-3 bg-green-900/30 border border-green-700 rounded-lg mb-4">
          <div className="flex items-center gap-2 text-green-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Native WireGuard Detected</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">{summary}</p>
        </div>
      );
    }

    if (status === 'third_party_detected') {
      return (
        <div className="px-4 py-3 bg-amber-900/30 border border-amber-700 rounded-lg mb-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">Third-Party VPN Detected</span>
          </div>
          {connectedVPNs.map((vpn) => (
            <div key={vpn.provider} className="text-xs space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-gray-700 rounded capitalize">{vpn.provider}</span>
                {vpn.server && <span className="text-gray-400">{vpn.server}</span>}
                {vpn.location && <span className="text-gray-400">({vpn.location})</span>}
              </div>
              <p className="text-gray-400">{vpn.message}</p>
              {vpn.publicKey && (
                <div className="font-mono bg-gray-800 p-1.5 rounded text-[10px] break-all text-gray-300">
                  Public Key: {vpn.publicKey}
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-gray-400 pt-2 border-t border-gray-700">
            <strong>Note:</strong> Third-party VPNs use embedded WireGuard. Use manual configuration below.
          </p>
        </div>
      );
    }

    if (status === 'no_tunnel') {
      return (
        <div className="px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg mb-4">
          <div className="flex items-center gap-2 text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">No Active Tunnel</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">{summary}</p>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">WireGuard Configuration</h3>
        <button
          onClick={detectTunnels}
          disabled={isLoading}
          className="text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 flex items-center gap-1"
        >
          {isLoading ? (
            'Detecting...'
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Detect
            </>
          )}
        </button>
      </div>

      {/* Detection Status */}
      {renderDetectionStatus()}

      <div className="space-y-3">
        {/* Only show dropdowns if native interfaces are available */}
        {interfaces.length > 0 && !manualMode && (
          <>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Interface</label>
              <select
                value={settings.interfaceName}
                onChange={(e) => handleInterfaceChange(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:text-gray-500"
              >
                <option value="">Select interface...</option>
                {interfaces.map((iface) => (
                  <option key={iface.name} value={iface.name}>
                    {iface.name} {iface.listenPort ? `(:${iface.listenPort})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Peer</label>
              <select
                value={settings.peerPublicKey}
                onChange={(e) => onSettingsChange({ peerPublicKey: e.target.value })}
                disabled={isLoading || !settings.interfaceName}
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
          </>
        )}

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
                placeholder="e.g., utun3, wg0, mullvad"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">Common names: wg0, utun3, mullvad</p>
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
              {thirdPartyVPNs.some((v) => v.connected && v.publicKey) && (
                <button
                  onClick={() => {
                    const vpn = thirdPartyVPNs.find((v) => v.connected && v.publicKey);
                    if (vpn?.publicKey) {
                      onSettingsChange({ peerPublicKey: vpn.publicKey });
                    }
                  }}
                  className="mt-1 text-xs text-blue-400 hover:text-blue-300"
                >
                  Use detected key from {thirdPartyVPNs.find((v) => v.connected)?.provider}
                </button>
              )}
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
