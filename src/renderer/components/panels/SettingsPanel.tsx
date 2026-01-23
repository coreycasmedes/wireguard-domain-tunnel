import React, { useState, useEffect } from 'react';
import { AppStatus, WireGuardSettings, DnsSettings, WireGuardInterface, TunnelDetectionResult, DetectedVPN } from '../../types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { Separator } from '../../../components/ui/separator';
import {
  Play,
  Square,
  Loader2,
  Activity,
  Shield,
  AlertTriangle,
  Wifi,
  Server,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Info,
  CheckCircle2,
  XCircle
} from 'lucide-react';

interface SettingsPanelProps {
  status: AppStatus;
  wgSettings: WireGuardSettings;
  dnsSettings: DnsSettings;
  onStart: () => void;
  onStop: () => void;
  onWgSettingsChange: (settings: Partial<WireGuardSettings>) => void;
  onDnsSettingsChange: (settings: Partial<DnsSettings>) => void;
  isLoading: boolean;
}

const COMMON_DNS_SERVERS = [
  { name: 'Google', host: '8.8.8.8' },
  { name: 'Google (Secondary)', host: '8.8.4.4' },
  { name: 'Cloudflare', host: '1.1.1.1' },
  { name: 'Cloudflare (Secondary)', host: '1.0.0.1' },
  { name: 'Quad9', host: '9.9.9.9' },
  { name: 'OpenDNS', host: '208.67.222.222' },
];

export function SettingsPanel({
  status,
  wgSettings,
  dnsSettings,
  onStart,
  onStop,
  onWgSettingsChange,
  onDnsSettingsChange,
  isLoading,
}: SettingsPanelProps) {
  const isRunning = status.dnsProxyRunning;
  const [showWgAdvanced, setShowWgAdvanced] = useState(false);
  const [showDnsAdvanced, setShowDnsAdvanced] = useState(false);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Status Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isRunning ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'
              }`}
            />
            <h2 className="text-lg font-semibold">
              {isRunning ? 'Active' : 'Inactive'}
            </h2>
          </div>
          {!status.wireguardConnected && (
            <Badge variant="outline" className="text-amber-500 border-amber-500/50">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Not Configured
            </Badge>
          )}
        </div>

        {isRunning && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Routes:</span>
              <span className="font-mono font-medium">{status.totalInjectedRoutes}</span>
            </div>

            {status.activeConflicts > 0 && (
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-amber-500">Conflicts:</span>
                <span className="font-mono font-medium">{status.activeConflicts}</span>
              </div>
            )}
          </div>
        )}

        <Button
          onClick={isRunning ? onStop : onStart}
          disabled={isLoading || (!isRunning && !status.wireguardConnected)}
          className="w-full"
          variant={isRunning ? 'destructive' : 'default'}
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Loading...
            </>
          ) : isRunning ? (
            <>
              <Square className="w-4 h-4 mr-2" />
              Stop Proxy
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Start Proxy
            </>
          )}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* WireGuard Configuration */}
          <WireGuardSection
            settings={wgSettings}
            onSettingsChange={onWgSettingsChange}
            showAdvanced={showWgAdvanced}
            onToggleAdvanced={() => setShowWgAdvanced(!showWgAdvanced)}
          />

          <Separator />

          {/* DNS Configuration */}
          <DnsSection
            settings={dnsSettings}
            onSettingsChange={onDnsSettingsChange}
            showAdvanced={showDnsAdvanced}
            onToggleAdvanced={() => setShowDnsAdvanced(!showDnsAdvanced)}
          />
        </div>
      </ScrollArea>
    </div>
  );
}

interface WireGuardSectionProps {
  settings: WireGuardSettings;
  onSettingsChange: (settings: Partial<WireGuardSettings>) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

function WireGuardSection({
  settings,
  onSettingsChange,
  showAdvanced,
  onToggleAdvanced,
}: WireGuardSectionProps) {
  const [detectionResult, setDetectionResult] = useState<TunnelDetectionResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(true);

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

        // If a third-party VPN is detected with a public key, auto-fill for manual mode
        if (result.status === 'third_party_detected' && !settings.peerPublicKey) {
          const connectedVPN = result.thirdPartyVPNs.find((v) => v.connected && v.publicKey);
          if (connectedVPN) {
            onSettingsChange({
              interfaceName: connectedVPN.interfaceName || settings.interfaceName,
              peerPublicKey: connectedVPN.publicKey || settings.peerPublicKey,
              autoDetect: false, // Switch to manual mode for third-party VPNs
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
      <Card className="border-amber-500/50 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            WireGuard Not Found
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Please install WireGuard tools to use this application.
          </p>
          <code className="block text-xs bg-muted p-2 rounded">
            brew install wireguard-tools
          </code>
        </CardContent>
      </Card>
    );
  }

  // Render detection status card
  const renderDetectionStatus = () => {
    if (!detectionResult) return null;

    const { status, summary, thirdPartyVPNs } = detectionResult;
    const connectedVPNs = thirdPartyVPNs.filter((v) => v.connected);

    if (status === 'native_available') {
      return (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg mb-3">
          <div className="flex items-center gap-2 text-green-500 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" />
            Native WireGuard Detected
          </div>
          <p className="text-xs text-muted-foreground mt-1">{summary}</p>
        </div>
      );
    }

    if (status === 'third_party_detected') {
      return (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg mb-3 space-y-2">
          <div className="flex items-center gap-2 text-amber-500 text-sm font-medium">
            <Info className="w-4 h-4" />
            Third-Party VPN Detected
          </div>
          {connectedVPNs.map((vpn) => (
            <div key={vpn.provider} className="text-xs space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {vpn.provider}
                </Badge>
                {vpn.server && (
                  <span className="text-muted-foreground">{vpn.server}</span>
                )}
                {vpn.location && (
                  <span className="text-muted-foreground">({vpn.location})</span>
                )}
              </div>
              <p className="text-muted-foreground">{vpn.message}</p>
              {vpn.publicKey && (
                <div className="font-mono bg-muted/50 p-1.5 rounded text-[10px] break-all">
                  Public Key: {vpn.publicKey}
                </div>
              )}
            </div>
          ))}
          <div className="pt-2 border-t border-amber-500/20">
            <p className="text-xs text-muted-foreground">
              <strong>Note:</strong> Third-party VPNs use embedded WireGuard that cannot be controlled by this app.
              Use manual configuration below, or set up a separate WireGuard tunnel via <code className="bg-muted px-1 rounded">wg-quick</code>.
            </p>
          </div>
        </div>
      );
    }

    if (status === 'no_tunnel') {
      return (
        <div className="p-3 bg-muted/50 border border-muted rounded-lg mb-3">
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
            <XCircle className="w-4 h-4" />
            No Active Tunnel
          </div>
          <p className="text-xs text-muted-foreground mt-1">{summary}</p>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">WireGuard</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={detectTunnels} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <>
              <RefreshCw className="w-3 h-3 mr-1" />
              Detect
            </>
          )}
        </Button>
      </div>

      {/* Detection Status */}
      {renderDetectionStatus()}

      <div className="space-y-3">
        {/* Only show interface dropdown if native interfaces are available */}
        {interfaces.length > 0 && settings.autoDetect && (
          <>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Interface</label>
              <Select
                value={settings.interfaceName}
                onValueChange={handleInterfaceChange}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select interface..." />
                </SelectTrigger>
                <SelectContent>
                  {interfaces.map((iface) => (
                    <SelectItem key={iface.name} value={iface.name}>
                      {iface.name} {iface.listenPort ? `(:${iface.listenPort})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Peer</label>
              <Select
                value={settings.peerPublicKey}
                onValueChange={(v) => onSettingsChange({ peerPublicKey: v })}
                disabled={isLoading || !settings.interfaceName}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select peer..." />
                </SelectTrigger>
                <SelectContent>
                  {peers.map((peer) => (
                    <SelectItem key={peer.publicKey} value={peer.publicKey}>
                      <span className="font-mono text-xs">
                        {peer.publicKey.substring(0, 16)}...
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="flex items-center justify-between py-2">
          <label htmlFor="auto-detect" className="text-sm cursor-pointer">
            Manual configuration
          </label>
          <Switch
            id="auto-detect"
            checked={!settings.autoDetect}
            onCheckedChange={(checked) => onSettingsChange({ autoDetect: !checked })}
          />
        </div>

        {!settings.autoDetect && (
          <div className="space-y-3 pt-2 border-t">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Interface Name</label>
              <Input
                value={settings.interfaceName}
                onChange={(e) => onSettingsChange({ interfaceName: e.target.value })}
                placeholder="e.g., utun3, wg0, mullvad"
              />
              <p className="text-[10px] text-muted-foreground">
                Common names: wg0, utun3, mullvad
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Peer Public Key</label>
              <Input
                value={settings.peerPublicKey}
                onChange={(e) => onSettingsChange({ peerPublicKey: e.target.value })}
                placeholder="Base64 public key..."
                className="font-mono text-xs"
              />
              {thirdPartyVPNs.some((v) => v.connected && v.publicKey) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 px-2"
                  onClick={() => {
                    const vpn = thirdPartyVPNs.find((v) => v.connected && v.publicKey);
                    if (vpn?.publicKey) {
                      onSettingsChange({ peerPublicKey: vpn.publicKey });
                    }
                  }}
                >
                  Use detected key from {thirdPartyVPNs.find((v) => v.connected)?.provider}
                </Button>
              )}
            </div>
          </div>
        )}

        {selectedInterface && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleAdvanced}
            className="w-full justify-start text-xs"
          >
            {showAdvanced ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
            {showAdvanced ? 'Hide' : 'Show'} Allowed IPs
          </Button>
        )}

        {showAdvanced && selectedInterface && (
          <div className="p-2 bg-muted/50 rounded text-xs font-mono max-h-24 overflow-auto">
            {peers
              .find((p) => p.publicKey === settings.peerPublicKey)
              ?.allowedIps.join(', ') || 'None'}
          </div>
        )}
      </div>
    </div>
  );
}

interface DnsSectionProps {
  settings: DnsSettings;
  onSettingsChange: (settings: Partial<DnsSettings>) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}

function DnsSection({ settings, onSettingsChange, showAdvanced, onToggleAdvanced }: DnsSectionProps) {
  const [customTunnel, setCustomTunnel] = useState('');
  const [customDirect, setCustomDirect] = useState('');

  const isTunnelCustom = !COMMON_DNS_SERVERS.find((d) => d.host === settings.tunnelUpstream.host);
  const isDirectCustom = !COMMON_DNS_SERVERS.find((d) => d.host === settings.directUpstream.host);

  const handleTunnelChange = (value: string) => {
    if (value === 'custom') {
      return;
    }
    onSettingsChange({
      tunnelUpstream: { host: value, port: 53 },
    });
  };

  const handleDirectChange = (value: string) => {
    if (value === 'custom') {
      return;
    }
    onSettingsChange({
      directUpstream: { host: value, port: 53 },
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Server className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">DNS Servers</h3>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            Tunnel DNS
            <span className="text-muted-foreground/60 ml-1">(for tunneled domains)</span>
          </label>
          <Select
            value={isTunnelCustom ? 'custom' : settings.tunnelUpstream.host}
            onValueChange={handleTunnelChange}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_DNS_SERVERS.map((dns) => (
                <SelectItem key={dns.host} value={dns.host}>
                  {dns.name} ({dns.host})
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom...</SelectItem>
            </SelectContent>
          </Select>
          {isTunnelCustom && (
            <Input
              value={settings.tunnelUpstream.host}
              onChange={(e) =>
                onSettingsChange({ tunnelUpstream: { host: e.target.value, port: 53 } })
              }
              placeholder="Custom DNS IP"
              className="font-mono text-sm"
            />
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            Direct DNS
            <span className="text-muted-foreground/60 ml-1">(for direct domains)</span>
          </label>
          <Select
            value={isDirectCustom ? 'custom' : settings.directUpstream.host}
            onValueChange={handleDirectChange}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMON_DNS_SERVERS.map((dns) => (
                <SelectItem key={dns.host} value={dns.host}>
                  {dns.name} ({dns.host})
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom...</SelectItem>
            </SelectContent>
          </Select>
          {isDirectCustom && (
            <Input
              value={settings.directUpstream.host}
              onChange={(e) =>
                onSettingsChange({ directUpstream: { host: e.target.value, port: 53 } })
              }
              placeholder="Custom DNS IP"
              className="font-mono text-sm"
            />
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleAdvanced}
          className="w-full justify-start text-xs"
        >
          {showAdvanced ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
          Advanced Settings
        </Button>

        {showAdvanced && (
          <div className="space-y-3 pt-2 border-t">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Local Proxy Port</label>
              <Input
                type="number"
                value={settings.proxyPort}
                onChange={(e) =>
                  onSettingsChange({ proxyPort: parseInt(e.target.value) || 5353 })
                }
                min={1024}
                max={65535}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Default: 5353 (redirected from port 53)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
