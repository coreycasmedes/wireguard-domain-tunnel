import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

function createTray() {
  const iconPath = path.join(__dirname, "../public/images/wg-dns.png");
  console.log("Icon path:", iconPath);
  
  let trayIcon = nativeImage.createFromPath(iconPath);
  console.log("Icon loaded:", !trayIcon.isEmpty());
  
  if (trayIcon.isEmpty()) {
    console.log("Icon is empty, creating fallback");
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
    trayIcon.setTemplateImage(true); // Better for macOS dark/light mode
  }
  
  tray = new Tray(trayIcon);
  console.log("TRAY CREATED:", !!tray);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Add Domains",
      click: () => {
        if (mainWindow === null) {
          createWindow();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Show App",
      click: () => {
        if (mainWindow === null) {
          createWindow();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip("WireGuard Domain Tunnel");

  tray.on("double-click", () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  createWindow();
  createTray();
});

// For tray apps, don't quit when all windows are closed
app.on('window-all-closed', () => {
  //e.preventDefault(); // Keep app running for tray
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
