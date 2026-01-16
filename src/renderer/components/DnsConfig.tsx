import React, { useState } from 'react';
import { DnsSettings } from '../types';

interface DnsConfigProps {
  settings: DnsSettings;
  onSettingsChange: (settings: Partial<DnsSettings>) => void;
}

const COMMON_DNS_SERVERS = [
  { name: 'Google', host: '8.8.8.8' },
  { name: 'Google (Secondary)', host: '8.8.4.4' },
  { name: 'Cloudflare', host: '1.1.1.1' },
  { name: 'Cloudflare (Secondary)', host: '1.0.0.1' },
  { name: 'Quad9', host: '9.9.9.9' },
  { name: 'OpenDNS', host: '208.67.222.222' },
];

export function DnsConfig({ settings, onSettingsChange }: DnsConfigProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleTunnelUpstreamChange = (host: string) => {
    onSettingsChange({
      tunnelUpstream: { host, port: 53 },
    });
  };

  const handleDirectUpstreamChange = (host: string) => {
    onSettingsChange({
      directUpstream: { host, port: 53 },
    });
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-medium text-white">DNS Configuration</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Tunnel DNS Server
            <span className="text-gray-500 text-xs ml-2">
              (used for tunneled domains)
            </span>
          </label>
          <div className="flex gap-2">
            <select
              value={settings.tunnelUpstream.host}
              onChange={(e) => handleTunnelUpstreamChange(e.target.value)}
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              {COMMON_DNS_SERVERS.map((dns) => (
                <option key={dns.host} value={dns.host}>
                  {dns.name} ({dns.host})
                </option>
              ))}
              <option value="custom">Custom...</option>
            </select>
          </div>
          {!COMMON_DNS_SERVERS.find((d) => d.host === settings.tunnelUpstream.host) && (
            <input
              type="text"
              value={settings.tunnelUpstream.host}
              onChange={(e) => handleTunnelUpstreamChange(e.target.value)}
              placeholder="Custom DNS IP"
              className="mt-2 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Direct DNS Server
            <span className="text-gray-500 text-xs ml-2">
              (used for non-tunneled domains)
            </span>
          </label>
          <div className="flex gap-2">
            <select
              value={settings.directUpstream.host}
              onChange={(e) => handleDirectUpstreamChange(e.target.value)}
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              {COMMON_DNS_SERVERS.map((dns) => (
                <option key={dns.host} value={dns.host}>
                  {dns.name} ({dns.host})
                </option>
              ))}
              <option value="custom">Custom...</option>
            </select>
          </div>
          {!COMMON_DNS_SERVERS.find((d) => d.host === settings.directUpstream.host) && (
            <input
              type="text"
              value={settings.directUpstream.host}
              onChange={(e) => handleDirectUpstreamChange(e.target.value)}
              placeholder="Custom DNS IP"
              className="mt-2 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-gray-800">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-gray-400 hover:text-gray-300 flex items-center gap-1"
        >
          <svg
            className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Advanced Settings
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Local Proxy Port
                <span className="text-gray-500 text-xs ml-2">
                  (DNS proxy listens on this port)
                </span>
              </label>
              <input
                type="number"
                value={settings.proxyPort}
                onChange={(e) =>
                  onSettingsChange({ proxyPort: parseInt(e.target.value) || 5353 })
                }
                min={1024}
                max={65535}
                className="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Default: 5353 (redirected from port 53 via pf/iptables)
              </p>
            </div>

            <div className="p-3 bg-gray-800/50 rounded-lg">
              <h4 className="text-sm font-medium text-gray-300 mb-2">How it works</h4>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>1. DNS proxy listens on port {settings.proxyPort}</li>
                <li>2. System DNS is set to 127.0.0.1</li>
                <li>3. Port 53 is redirected to {settings.proxyPort} via pf (macOS) or iptables (Linux)</li>
                <li>4. Tunneled domains resolve via {settings.tunnelUpstream.host}</li>
                <li>5. Other domains resolve via {settings.directUpstream.host}</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
