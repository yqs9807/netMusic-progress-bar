# NetEase Cloud Music Now Playing for Ulanzi Pixel Clock（TC002）

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MQTT](https://img.shields.io/badge/MQTT-3.1.1%20%2F%205.0-blue.svg)](https://mqtt.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

基于 **Chrome DevTools Protocol (CDP)** 与 **MQTT** 构建的轻量级工具。

通过 CDP 协议实时捕获 Windows 版本网易云音乐（Electron 内核）的播放进度与时长，并以 JSON 协议推送至 MQTT Broker，供 **Ulanzi 像素屏（TC002）**显示。

---

## 特性亮点

- **零依赖外部插件**：纯 Node.js 实现，无需安装 `puppeteer-core`、BetterNCM 或修改客户端文件。
- **平滑无跳秒 (Dead Reckoning)**：克服了 Electron/Chromium 后台节流导致可能出现 DOM 2 秒刷新一次的问题，秒数均匀推进。
- **开箱即用的预设模式**：内置两种排版预设，配置项与配色方案全部前置集中管理。
- **极低系统资源占用**：单连接 WebSocket 本地回环通信，CPU 占用接近 0%，内存消耗 ~ 30MB。

---

## 界面预设展示

| 预设模式 (`displayPreset`) | 视觉效果描述 | 适用点阵规格 |
|---|---|---|
| `COMPACT_TAG` | 左上角红色标头 `net music`，中间为 `当前时常/总时长`，底部单像素进度条 | 52×16 |
| `LARGE_CURRENT` | 当前时长采用 **10号大字** 居左，总时长采用 **5号小字** 底部对齐，底部单像素进度条 | 52×16 |

---

## 快速上手

### 1. 克隆仓库并安装依赖

```bash
git clone [https://github.com/your-username/netease-ulanzi-monitor.git](https://github.com/your-username/netease-ulanzi-monitor.git)
cd netease-ulanzi-monitor
npm install
```

### 2. 修改配置项

打开 `netease-ulanzi-monitor.js`，在文件开头的 `CONFIG` 对象中修改您的软路由/服务器信息：

```javascript
const CONFIG = {
  cdpPort: 9222,                                // 网易云音乐远程调试端口
  mqttBroker: 'mqtt://192.168.3.100:1883',      // 您的 MQTT Broker 地址
  mqttTopic: 'ulanzi_a728/custom/netease',      // MQTT 目标 Topic
  screenWidth: 52,                             // 点阵屏宽度
  screenHeight: 16,                            // 点阵屏高度

  displayPreset: 'COMPACT_TAG',                 // 可选: 'COMPACT_TAG' 或 'LARGE_CURRENT'

  colors: {
    progressBarTrack: '#222222',
    progressBarFill: '#00FFFF',
    compactTagHeader: '#F20D24',
    compactTimeText: '#00FFCC',
    largeCurrentTime: '#F20D24',
    smallTotalTime: '#888888'
  }
};

```

### 3. 带参数启动网易云音乐

网易云音乐需要开启远程调试端口供脚本连接：

1. 退出当前正在运行的网易云音乐。
2. 右键网易云音乐桌面快捷方式 -> **属性** -> **快捷方式** 选项卡。
3. 在 **目标** 栏末尾添加参数（注意前面保留空格）：
```text
--remote-debugging-port=9222
```


4. 点击确定并重新启动网易云音乐。

### 4. 运行监控脚本

```bash
node netease-ulanzi-monitor.js
```

---

## Windows 开机无感知自启配置

使用 Windows 自带的 `Startup` 目录与静默 VBS 脚本，无需第三方管理工具即可实现开机后台运行：

1. 在项目根目录下创建 `run-silent.vbs`：
```vbscript
Set ws = CreateObject("WScript.Shell")
currentPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
ws.Run "node """ & currentPath & "\netease-ulanzi-monitor.js""", 0, False
```

2. 按下快捷键 `Win + R`，输入 `shell:startup` 并回车。
3. 右键 `run-silent.vbs` -> **创建快捷方式**，将生成的快捷方式剪切并粘贴到打开的 `Startup` 文件夹中。

---

## 协议与数据结构

本脚本直接向 MQTT 投递 Ulanzi 固件原生解析的 JSON 格式：

```json
{
  "text": [
    {
      "content": "01:23",
      "fontHeight": 10,
      "x": 2,
      "y": 2,
      "color": "#F20D24",
      "rect": [0, 0, 52, 16],
      "charSpacing": 1
    }
  ],
  "draw": [
    { "dl": [0, 15, 51, 15, "#222222"] },
    { "dl": [0, 15, 23, 15, "#00FFFF"] }
  ]
}
```

---

## 开源许可

本项目基于 [MIT License](https://www.google.com/search?q=LICENSE) 开源。
