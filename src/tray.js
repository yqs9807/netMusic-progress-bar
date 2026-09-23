const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const noop = () => {};
console.log = noop;
console.warn = noop;
console.error = noop;
console.info = noop;

// 安全地向参数列表注入 windowsHide: true，绝不破坏 Node.js 原本的参数顺序和类型
function forceWindowsHide(argsArray) {
  const args = Array.from(argsArray);
  
  // 反向查找已存在的 options 对象
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i];
    if (typeof arg === 'function') continue;
    if (Array.isArray(arg)) continue;
    if (arg !== null && typeof arg === 'object') {
      arg.windowsHide = true;
      return args;
    }
  }
  
  // 如果没有找到 options 对象，则安全地插入一个
  const lastIsCb = args.length > 0 && typeof args[args.length - 1] === 'function';
  if (lastIsCb) {
    const cb = args.pop();
    args.push({ windowsHide: true }, cb);
  } else {
    args.push({ windowsHide: true });
  }
  
  return args;
}

const originalSpawn = cp.spawn;
cp.spawn = function(...args) {
  if (typeof args[0] === 'string' && args[0].includes('tray_windows_release.exe')) {
    args[0] = getSystrayBinPath();
  }
  return originalSpawn.apply(this, forceWindowsHide(args));
};

const originalExec = cp.exec;
cp.exec = function(...args) {
  return originalExec.apply(this, forceWindowsHide(args));
};

const originalExecFile = cp.execFile;
cp.execFile = function(...args) {
  return originalExecFile.apply(this, forceWindowsHide(args));
};

// 劫持完成后，再引入 systray2
const SysTray = require('systray2').default || require('systray2');

function getSystrayBinPath() {
  const binName = 'tray_windows_release.exe';
  const targetDir = path.join(process.env.TEMP || process.cwd(), 'PixMusicControl_bin');
  const targetBin = path.join(targetDir, binName);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const bundledBin = path.resolve(__dirname, '..', 'node_modules', 'systray2', 'traybin', binName);

  if (fs.existsSync(bundledBin)) {
    try {
      const srcStat = fs.statSync(bundledBin);
      const needCopy = !fs.existsSync(targetBin) || fs.statSync(targetBin).size !== srcStat.size;
      if (needCopy) {
        fs.copyFileSync(bundledBin, targetBin);
      }
    } catch (e) {
      // 忽略异常
    }
  }

  return targetBin;
}

function initTray(onOpenWeb, onExit) {
  getSystrayBinPath();

  let iconBase64 = '';
  try {
    const iconPath = path.resolve(__dirname, '..', 'assets', 'tray.ico');
    if (fs.existsSync(iconPath)) {
      iconBase64 = fs.readFileSync(iconPath).toString('base64');
    }
  } catch (e) {
    // 忽略异常
  }

  const systray = new SysTray({
    menu: {
      icon: iconBase64,
      title: 'PixMusicControl',
      tooltip: 'PixMusicControl - 网易云音乐点阵屏联动',
      items: [
        {
          title: '打开控制面板',
          tooltip: '在浏览器中打开 Web 配置面板',
          checked: false,
          enabled: true
        },
        {
          title: '退出',
          tooltip: '退出服务',
          checked: false,
          enabled: true
        }
      ]
    },
    debug: false,
    copyDir: false 
  });

  systray.onClick(action => {
    if (action.seq_id === 0) {
      onOpenWeb && onOpenWeb();
    } else if (action.seq_id === 1) {
      systray.kill();
      onExit && onExit();
    }
  });

  return systray;
}

module.exports = initTray;
module.exports.setupTray = initTray;
module.exports.initTray = initTray;