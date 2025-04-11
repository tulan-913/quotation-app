const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { server } = require('./server/server');

// 配置全局变量
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let mainWindow;

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'build', getPlatformIcon())
  });

  // 加载应用
  const startUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:4000'
    : `file://${path.join(__dirname, '../src/index.html')}`;
  
  mainWindow.loadURL(startUrl);

  // 开发工具
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // 窗口关闭事件
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 获取平台对应图标
function getPlatformIcon() {
  switch (process.platform) {
    case 'win32': return 'icon.ico';
    case 'darwin': return 'icon.icns';
    default: return 'icon.png';
  }
}

// 初始化应用目录
function initAppDirs() {
  const fs = require('fs');
  const { dbPath, uploadDir } = require('./server/server');

  [path.dirname(dbPath), uploadDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });
}

// Electron准备就绪
app.whenReady().then(() => {
  initAppDirs();
  
  // 启动Express服务器
  server.listen(4000, () => {
    console.log('Express server started');
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 跨平台退出处理
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// PDF生成处理
ipcMain.handle('generate-pdf', async (event, htmlContent) => {
  const { BrowserWindow } = require('electron');
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: { webSecurity: false }
  });

  try {
    await pdfWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(htmlContent)}`);
    
    // 等待资源加载
    await new Promise(resolve => {
      pdfWindow.webContents.on('did-finish-load', resolve);
      setTimeout(resolve, 3000);
    });

    const pdfData = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    });

    return pdfData;
  } finally {
    pdfWindow.close();
  }
});

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});