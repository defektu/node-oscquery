import { app, BrowserWindow } from 'electron';
import { createServer, Socket } from 'net';
import {Bonjour, Service} from 'bonjour-service';
const SERVICE_TYPE = 'myservice';
const SERVICE_PORT = 41235;

let mainWindow: BrowserWindow;
let isServer = false;
let serverInstance: Service;
let bonjourInstance: Bonjour;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

function startDiscovery() {
  bonjourInstance = new Bonjour();

  const browser = bonjourInstance.find({ type: SERVICE_TYPE });

  browser.on('up', (service) => {
    console.log('Found an existing server:', service.name);
    runAsClient(service.addresses[0], service.port);
    browser.stop();
  });

  browser.on('error', (err) => {
    console.error('Error during Bonjour discovery:', err);
  });
  setTimeout(() => {
    if (!isServer) {
      console.log('No server found. Running as server.');
      runAsServer();
    }
    browser.stop();
  }, 5000);
}

function runAsServer() {
  isServer = true;
  
  const server = createServer((socket) => {
    console.log('Client connected');
    socket.on('data', (data) => {
      console.log('Received data:', data.toString());
    });
  });

  server.listen(SERVICE_PORT, () => {
    console.log('Server listening on port', SERVICE_PORT);
    
    serverInstance = bonjourInstance.publish({
      name: 'MyAppServer',
      type: SERVICE_TYPE,
      port: SERVICE_PORT,
      protocol: 'tcp'
    });
  });
}

function runAsClient(serverAddress, serverPort) {
  const client = new Socket();
  client.connect(serverPort, serverAddress, () => {
    console.log('Connected to server');
    client.write('Hello from client');
  });

  client.on('data', (data) => {
    console.log('Received from server:', data.toString());
  });
}

app.whenReady().then(() => {
  createWindow();
  startDiscovery();
}).catch(error => {
  console.error('Error during app initialization:', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverInstance) {
      serverInstance.stop();
    }
    if (bonjourInstance) {
      bonjourInstance.destroy();
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
