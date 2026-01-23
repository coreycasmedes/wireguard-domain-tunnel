/**
 * Main Process
 *
 * Electron main process that:
 * - Creates and manages the application window
 * - Manages system tray
 * - Integrates DNS proxy, SNI proxy, WireGuard, and system DNS modules
 * - Handles IPC communication with renderer
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Import modules
import { DomainMatcher, domainMatcher } from './main/domain-matcher';
import { conflictDetector } from './main/conflict-detector';
import { DnsProxy, createDnsProxy, DnsQueryEvent, DnsResponseEvent, RouteInjectionEvent } from './main/dns-proxy';
import { SniProxy, createSniProxy } from './main/sni-proxy';
import { wireguard } from './main/wireguard';
import { RouteManager, createRouteManager } from './main/route-manager';
import { systemDns } from './main/system-dns';
import { configStore } from './main/config-store';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Global references
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Module instances
let dnsProxy: DnsProxy | null = null;
let sniProxy: SniProxy | null = null;
let routeManager: RouteManager | null = null;

// Activity log (in-memory, limited size)
interface LogEntry {
  id: string;
  timestamp: number;
  type: 'query' | 'response' | 'route' | 'error' | 'info';
  message: string;
  details?: Record<string, unknown>;
}

const activityLog: LogEntry[] = [];
const MAX_LOG_ENTRIES = 500;
let logIdCounter = 0;

function addLogEntry(type: LogEntry['type'], message: string, details?: Record<string, unknown>): void {
  const entry: LogEntry = {
    id: `log-${++logIdCounter}`,
    timestamp: Date.now(),
    type,
    message,
    details,
  };

  activityLog.unshift(entry);
  if (activityLog.length > MAX_LOG_ENTRIES) {
    activityLog.pop();
  }

  // Send to renderer if window exists
  mainWindow?.webContents.send('log:entry', entry);
}

// Status helper
function getStatus() {
  return {
    dnsProxyRunning: dnsProxy?.getIsRunning() ?? false,
    sniProxyRunning: sniProxy?.getIsRunning() ?? false,
    systemDnsConfigured: systemDns.isActive(),
    wireguardConnected: wireguard.getConfig() !== null,
    totalInjectedRoutes: routeManager?.getStats().totalInjected ?? 0,
    activeConflicts: conflictDetector.getConflicts().length,
  };
}

function sendStatusUpdate(): void {
  mainWindow?.webContents.send('status:update', getStatus());
}

// Window creation
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development' || MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of closing
    if (tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
};

// Tray creation
function createTray() {
  const iconPath = path.join(__dirname, '../public/images/wg-dns.png');
  let trayIcon = nativeImage.createFromPath(iconPath);

  if (trayIcon.isEmpty()) {
    // Create a simple fallback icon
    trayIcon = nativeImage.createEmpty();
    trayIcon.addRepresentation({
      scaleFactor: 1.0,
      width: 16,
      height: 16,
      buffer: Buffer.alloc(16 * 16 * 4, 128),
    });
  } else {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
    trayIcon.setTemplateImage(true);
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow === null) {
          createWindow();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Start Proxy',
      click: async () => {
        try {
          await startProxy();
        } catch (err) {
          addLogEntry('error', `Failed to start proxy: ${err}`);
        }
      },
    },
    {
      label: 'Stop Proxy',
      click: async () => {
        try {
          await stopProxy();
        } catch (err) {
          addLogEntry('error', `Failed to stop proxy: ${err}`);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: async () => {
        await cleanup();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('WireGuard Domain Tunnel');

  tray.on('double-click', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Initialize modules
async function initializeModules(): Promise<void> {
  // Load saved domain rules
  const savedRules = configStore.getDomainRules();
  domainMatcher.loadRules(savedRules);

  // Load WireGuard settings
  const wgSettings = configStore.getWireGuardSettings();
  if (wgSettings.interfaceName && wgSettings.peerPublicKey) {
    wireguard.setConfig({
      interfaceName: wgSettings.interfaceName,
      peerPublicKey: wgSettings.peerPublicKey,
    });
  }

  // Create DNS proxy
  const dnsSettings = configStore.getDnsSettings();
  dnsProxy = createDnsProxy(domainMatcher, conflictDetector, {
    listenPort: dnsSettings.proxyPort,
    tunnelUpstream: dnsSettings.tunnelUpstream,
    directUpstream: dnsSettings.directUpstream,
  });

  // Set up DNS proxy events
  dnsProxy.on('query', (event: DnsQueryEvent) => {
    addLogEntry('query', `DNS query: ${event.domain} (${event.type})`, {
      tunnel: event.tunnel,
      matchedRule: event.matchedRule,
    });
  });

  dnsProxy.on('response', (event: DnsResponseEvent) => {
    addLogEntry('response', `DNS response: ${event.domain} -> ${event.ips.join(', ')}`, {
      tunnel: event.tunnel,
      ttl: event.ttl,
      responseTime: event.responseTime,
    });
  });

  dnsProxy.on('route-injection', async (event: RouteInjectionEvent) => {
    if (event.tunnel && event.ips.length > 0 && routeManager) {
      try {
        // Default TTL of 5 minutes for injected routes
        await routeManager.injectRoutes(event.domain, event.ips, 300);
        addLogEntry('route', `Injected routes for ${event.domain}: ${event.ips.join(', ')}`, {
          conflict: event.conflict,
        });
        sendStatusUpdate();
      } catch (err) {
        addLogEntry('error', `Failed to inject routes: ${err}`);
      }
    }
  });

  dnsProxy.on('error', (err: Error) => {
    addLogEntry('error', `DNS proxy error: ${err.message}`);
  });

  // Create SNI proxy
  sniProxy = createSniProxy(domainMatcher, {
    listenPort: 1080,
  });

  sniProxy.on('connection', (event) => {
    addLogEntry('info', `SNI proxy connection: ${event.targetHost}:${event.targetPort}`, {
      tunnel: event.tunnel,
    });
  });

  sniProxy.on('error', (err: Error) => {
    addLogEntry('error', `SNI proxy error: ${err.message}`);
  });

  // Create route manager
  routeManager = createRouteManager(wireguard, conflictDetector);

  routeManager.on('routes-injected', (event) => {
    addLogEntry('route', `Routes injected for ${event.domain}: ${event.ips.length} IPs`);
    sendStatusUpdate();
  });

  routeManager.on('routes-expired', (event) => {
    addLogEntry('info', `Expired ${event.count} routes`);
    sendStatusUpdate();
  });

  routeManager.on('error', (err: Error) => {
    addLogEntry('error', `Route manager error: ${err.message}`);
  });

  // Set up conflict detector events
  conflictDetector.on('conflict-detected', (conflict) => {
    addLogEntry('info', `IP conflict detected: ${conflict.ip}`, {
      tunnelDomains: conflict.tunnelDomains,
      directDomains: conflict.directDomains,
    });
    mainWindow?.webContents.send('conflicts:detected', conflict);
    sendStatusUpdate();
  });

  conflictDetector.on('conflict-resolved', (ip) => {
    addLogEntry('info', `IP conflict resolved: ${ip}`);
    mainWindow?.webContents.send('conflicts:resolved', ip);
    sendStatusUpdate();
  });

  // Check for crash recovery
  const dnsBackup = configStore.getDnsBackup();
  if (dnsBackup) {
    const isStale = await systemDns.checkForStaleConfig();
    if (isStale) {
      addLogEntry('info', 'Detected stale DNS configuration from previous crash, restoring...');
      systemDns.loadBackup(dnsBackup);
      await systemDns.restore();
      configStore.setDnsBackup(null);
    }
  }

  addLogEntry('info', 'Application initialized');
}

// Start proxy
async function startProxy(): Promise<{ success: boolean; error?: string }> {
  try {
    // Check WireGuard config
    const wgConfig = wireguard.getConfig();
    if (!wgConfig) {
      return { success: false, error: 'WireGuard interface not configured' };
    }

    const isActive = await wireguard.isActive();
    if (!isActive) {
      return { success: false, error: 'WireGuard interface not active' };
    }

    // Start route manager
    await routeManager?.start();

    // Start DNS proxy
    await dnsProxy?.start();
    addLogEntry('info', 'DNS proxy started');

    // Start SNI proxy
    await sniProxy?.start();
    addLogEntry('info', 'SNI proxy started');

    // Configure system DNS
    await systemDns.configure();
    configStore.setDnsBackup(systemDns.getBackup());
    addLogEntry('info', 'System DNS configured');

    // Update activity timestamp
    configStore.updateLastActiveTimestamp();

    sendStatusUpdate();
    return { success: true };
  } catch (err) {
    addLogEntry('error', `Failed to start proxy: ${err}`);
    return { success: false, error: String(err) };
  }
}

// Stop proxy
async function stopProxy(): Promise<void> {
  try {
    // Restore system DNS first
    await systemDns.restore();
    configStore.setDnsBackup(null);
    addLogEntry('info', 'System DNS restored');

    // Stop DNS proxy
    await dnsProxy?.stop();
    addLogEntry('info', 'DNS proxy stopped');

    // Stop SNI proxy
    await sniProxy?.stop();
    addLogEntry('info', 'SNI proxy stopped');

    // Stop route manager and clean up routes
    await routeManager?.stop();
    addLogEntry('info', 'Routes cleared');

    // Clear activity timestamp
    configStore.clearLastActiveTimestamp();

    sendStatusUpdate();
  } catch (err) {
    addLogEntry('error', `Error stopping proxy: ${err}`);
  }
}

// Cleanup on quit
async function cleanup(): Promise<void> {
  try {
    await stopProxy();
  } catch {
    // Ignore errors during cleanup
  }

  // Destroy tray icon
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// Register IPC handlers
function registerIpcHandlers(): void {
  // Domain management
  ipcMain.handle('domains:get-all', () => {
    return domainMatcher.getRules();
  });

  ipcMain.handle('domains:add', (_event, pattern: string, tunnel: boolean) => {
    const validation = DomainMatcher.isValidPattern(pattern);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    domainMatcher.addRule(pattern, tunnel);
    configStore.setDomainRules(domainMatcher.getRules());
    sendStatusUpdate();
    return { success: true };
  });

  ipcMain.handle('domains:remove', (_event, pattern: string) => {
    const removed = domainMatcher.removeRule(pattern);
    if (removed) {
      configStore.setDomainRules(domainMatcher.getRules());
      conflictDetector.removeDomain(pattern);
      sendStatusUpdate();
    }
    return removed;
  });

  ipcMain.handle('domains:validate', (_event, pattern: string) => {
    return DomainMatcher.isValidPattern(pattern);
  });

  // WireGuard management
  ipcMain.handle('wireguard:get-interfaces', async () => {
    return wireguard.getInterfaces();
  });

  ipcMain.handle('wireguard:get-settings', () => {
    return configStore.getWireGuardSettings();
  });

  ipcMain.handle('wireguard:set-settings', (_event, settings) => {
    configStore.setWireGuardSettings(settings);
    if (settings.interfaceName && settings.peerPublicKey) {
      wireguard.setConfig({
        interfaceName: settings.interfaceName,
        peerPublicKey: settings.peerPublicKey,
      });
    }
    sendStatusUpdate();
  });

  ipcMain.handle('wireguard:is-available', async () => {
    return wireguard.isAvailable();
  });

  ipcMain.handle('wireguard:is-active', async () => {
    return wireguard.isActive();
  });

  ipcMain.handle('wireguard:get-allowed-ips', async () => {
    return wireguard.getAllowedIps();
  });

  ipcMain.handle('wireguard:detect-tunnels', async () => {
    return wireguard.detectTunnels();
  });

  // DNS settings
  ipcMain.handle('dns:get-settings', () => {
    return configStore.getDnsSettings();
  });

  ipcMain.handle('dns:set-settings', (_event, settings) => {
    configStore.setDnsSettings(settings);
    if (dnsProxy) {
      dnsProxy.updateConfig(settings);
    }
  });

  ipcMain.handle('dns:set-tunnel-upstream', (_event, host: string, port: number) => {
    configStore.setTunnelUpstream(host, port);
    if (dnsProxy) {
      dnsProxy.updateConfig({ tunnelUpstream: { host, port } });
    }
  });

  ipcMain.handle('dns:set-direct-upstream', (_event, host: string, port: number) => {
    configStore.setDirectUpstream(host, port);
    if (dnsProxy) {
      dnsProxy.updateConfig({ directUpstream: { host, port } });
    }
  });

  // Proxy control
  ipcMain.handle('proxy:start', async () => {
    return startProxy();
  });

  ipcMain.handle('proxy:stop', async () => {
    await stopProxy();
  });

  ipcMain.handle('proxy:get-status', () => {
    return getStatus();
  });

  // Conflicts
  ipcMain.handle('conflicts:get-all', () => {
    return conflictDetector.getConflicts();
  });

  // Activity log
  ipcMain.handle('log:get-recent', (_event, limit?: number) => {
    return activityLog.slice(0, limit || 100);
  });

  ipcMain.handle('log:clear', () => {
    activityLog.length = 0;
  });

  // Window control
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:close', () => {
    mainWindow?.hide();
  });
}

// App lifecycle
app.on('ready', async () => {
  registerIpcHandlers();
  await initializeModules();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
  if (process.platform !== 'darwin') {
    // On other platforms, also keep running if tray exists
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  await cleanup();
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  addLogEntry('error', `Uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  addLogEntry('error', `Unhandled rejection: ${reason}`);
});
