const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. 构建 Electron 桌面应用
console.log('Building Electron desktop apps...');
execSync('npm run dist', { stdio: 'inherit' });

// 2. 准备移动端资源
console.log('Preparing mobile resources...');
const wwwDir = path.join(__dirname, 'www');
if (!fs.existsSync(wwwDir)) {
  fs.mkdirSync(wwwDir);
}

// 复制网页资源
fs.cpSync(path.join(__dirname, 'src'), wwwDir, { recursive: true });
fs.cpSync(path.join(__dirname, 'mobile', 'index.html'), path.join(wwwDir, 'index.html'));

// 3. 添加 Capacitor 平台
console.log('Adding Capacitor platforms...');
execSync('npx cap add android', { stdio: 'inherit' });
execSync('npx cap add ios', { stdio: 'inherit' });

// 4. 同步移动端项目
console.log('Syncing mobile projects...');
execSync('npx cap sync', { stdio: 'inherit' });

console.log('Build completed!');
console.log('Windows/macOS apps in dist/');
console.log('Android project in android/');
console.log('iOS project in ios/');