const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { server, port } = require('./server/server');

// 判断运行环境
const isMobile = process.env.CAPACITOR_PLATFORM === 'android' || 
                 process.env.CAPACITOR_PLATFORM === 'ios';

let mainWindow;

function initAppDirs() {
  const { uploadDir, dbPath } = require('./server/server');
  const fs = require('fs');
  
  // 移动端使用不同的路径
  const getBasePath = () => {
    if (isMobile) {
      return process.env.CAPACITOR_ANDROID_STUDIO_PATH || 
             process.env.CAPACITOR_IOS_XCODE_PATH;
    }
    return process.resourcesPath;
  };

  const basePath = isMobile ? getBasePath() : process.resourcesPath;
  
  const paths = {
    dbPath: path.join(basePath, 'database', 'quotation.db'),
    uploadDir: path.join(basePath, 'uploads')
  };

  [path.dirname(paths.dbPath), paths.uploadDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  return paths;
}

function createWindow() {
  const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: isMobile ? width : 1200,
    height: isMobile ? height : 800,
    webPreferences: {
      webSecurity: false,
      allowRunningInsecureContent: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    // 移动端全屏
    fullscreen: isMobile,
    // macOS 特有设置
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      vibrancy: 'sidebar'
    } : {})
  });

  // 加载应用界面
  if (isMobile) {
    mainWindow.loadFile(path.join(__dirname, 'www', 'index.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  }

  // 开发工具
  if (process.env.NODE_ENV === 'development' && !isMobile) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 主逻辑
if (!isMobile) {
  app.whenReady().then(() => {
    initAppDirs();
    server.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
    createWindow();
    
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
} else {
  // 移动端特定逻辑
  const { Capacitor } = require('@capacitor/core');
  const { StatusBar, SplashScreen } = require('@capacitor/status-bar');
  
  // 初始化移动端插件
  StatusBar.setBackgroundColor({ color: '#1a5276' });
  SplashScreen.hide();
  
  // 启动服务器
  initAppDirs();
  server.listen(port, () => {
    console.log(`Mobile server running on port ${port}`);
  });
}

// 添加PDF生成处理
ipcMain.handle('generate-pdf', async (event, htmlContent) => {
  return new Promise(async (resolve, reject) => {
    try {
      // 创建隐藏窗口
      const pdfWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false // 禁用web安全策略以允许加载本地图片
        }
      })
      
      // 加载HTML内容
      await pdfWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(htmlContent)}`)
      
      // 等待所有资源加载完成
      await new Promise((resolve) => {
        pdfWindow.webContents.on('did-finish-load', resolve);
        setTimeout(resolve, 3000); // 超时保障
      });
      
      // 特别等待图片加载
      await pdfWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const images = document.querySelectorAll('img');
          let loadedCount = 0;
          
          if (images.length === 0) {
              resolve();
              return;
          }
          
          images.forEach(img => {
              if (img.complete) {
                  loadedCount++;
              } else {
                  img.onload = () => {
                      loadedCount++;
                      if (loadedCount === images.length) resolve();
                  };
                  img.onerror = () => {
                      loadedCount++;
                      if (loadedCount === images.length) resolve();
                  };
              }
          });
          
          if (loadedCount === images.length) resolve();
        });
    `);


      // 生成PDF
      const pdfData = await pdfWindow.webContents.printToPDF({
        marginsType: 1, // 0-默认边距, 1-无边距, 2-最小边距
        printBackground: true,
        printSelectionOnly: false,
        landscape: false,
        pageSize: 'A4',
        scale: 1.0
      })
      
      // 关闭窗口
      pdfWindow.close()
      
      resolve(pdfData)
    } catch (error) {
      console.error('PDF生成错误:', error)
      reject(error)
    }
  })
})