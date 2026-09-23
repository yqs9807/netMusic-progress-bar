// 1. 必须放在文件第一行：屏蔽所有控制台输出，防止 GUI 模式下抛出 EBADF 导致崩溃闪烁
const noop = () => {};
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// 1. 真实配置文件保存在 exe 运行所在目录的物理磁盘上
const configDir = path.resolve(process.cwd(), 'config');
const configPath = path.resolve(configDir, 'config.json');

// 2. 示例配置文件打包在可执行文件内部，使用 __dirname 从虚拟快照读取
const examplePath = path.resolve(__dirname, 'config', 'config.example.json');

// 3. 确保物理磁盘上存在 config 文件夹，防止 copyFileSync 找不到目标目录而崩溃
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

if (!fs.existsSync(configPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, configPath);
  } else {
    process.exit(1);
  }
}

// 预先读取配置中的端口
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
  process.exit(1);
}

const PORT = config.network?.webPort || 25688;

const { startApp, reloadConfig, stopApp, getRuntimeStatus } = require('./src/app');
const { startConfigServer } = require('./src/server');
const { setupTray } = require('./src/tray');

function openBrowser(url) {
  const platform = process.platform;
  let cmd = '';

  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  // 2. 必须显式添加 windowsHide: true，因为顶层的 exec 尚未被 tray.js 劫持
  exec(cmd, { windowsHide: true }, (err) => {
    // 忽略错误
  });
}

// 1. 启动本地配置服务端 (传入动态读取的 PORT)
startConfigServer(configPath, (newConfig) => {
  reloadConfig(newConfig);
}, getRuntimeStatus, PORT);

// 2. 启动核心监听同步
startApp();

// 3. 挂载系统托盘（修改传参格式为按顺序传入两个函数参数）
setupTray(
  () => {
    openBrowser(`http://127.0.0.1:${PORT}`);
  },
  async () => {
    try {
      await stopApp();
    } catch (err) {
      // 忽略清理时的错误
    } finally {
      process.exit(0);
    }
  }
);

// 捕获 Ctrl + C 优雅退出
process.on('SIGINT', async () => {
  await stopApp();
  process.exit(0);
});

// 捕获 Windows 关机或关闭终端窗口信号
process.on('SIGTERM', async () => {
  await stopApp();
  process.exit(0);
});