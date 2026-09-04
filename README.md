# NetEase Cloud Music Now Playing for Ulanzi Pixel Clock（TC002）

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MQTT](https://img.shields.io/badge/MQTT-3.1.1%20%2F%205.0-blue.svg)](https://mqtt.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)


基于 **Chrome DevTools Protocol (CDP)** 与 **MQTT** 构建的轻量级桌面硬件联动工具。

通过 CDP 协议毫秒级捕获 Windows 客户端网易云音乐（Electron 内核）的播放状态与时间进度，结合 **Dead Reckoning（航位推测/本地时钟平滑）** 算法消除节流卡顿，以原生图元指令推送到 MQTT Broker，供 **Ulanzi 像素时钟（TC002，52×16 点阵）** 实时呈现。

---

## 特性亮点

* **零侵入与零外部依赖**：纯原生 Node.js 实现，无需安装 `puppeteer`、BetterNCM 插件，无需 Patch 客户端内核文件。
* **本地平滑推进 (Dead Reckoning)**：针对 Electron 渲染层节流（DOM 2 秒跳跃一次）问题，通过本地高精度时钟均匀推进，彻底杜绝跳秒。
* **精准状态即时响应**：针对网易云 DOM 结构直接匹配播放状态，即使捕获暂停/播放动作进行同步推送。
* **三种精美排版预设**：内置紧凑标签、大号主时钟以及带有机械唱臂联动的黑胶唱片模式。
* **模块化解耦架构**：配置参数抽离为独立 `config.json`，绘图排版抽象为独立 `renderer.js`，修改配色与微调布局完全无需修改服务主程序。
* **极低系统资源占用**：单连接 WebSocket 本地回环通信，CPU 占用接近 0%，内存常驻占用约 30MB。

---

## 界面预设展示（52 × 16）

| 预设模式 (`preset`) | 视觉布局与动态呈现 |
| --- | --- |
| `COMPACT_TAG` | 左上角小标头 `Net Music`，右上角微型播放 `▶` /暂停 `\|\|` 图标，左下角 5 号字体显示 `当前播放时常/总时长`，屏幕底部单像素进度条 |
| `LARGE_CURRENT` | 左侧突出展示当前时间（**10号大字体**），右下角对齐歌曲总时长（5号字），右上角状态图标，底部单像素进度条 |
| `RETRO_BADGE` | 左侧使用绘制圆形黑胶唱片，搭配机械唱臂联动（**播放时唱头斜切压入盘面，暂停时垂直停靠归位**），右侧展示时间数值与状态图标 |

---

## 项目结构

```text
netease-ulanzi-monitor/
├── config.json          # 全局用户配置文件（网络、预设选择、配色方案）
├── renderer.js          # Ulanzi 像素排版与图元构建渲染模块
├── app.js               # CDP 监听、本地平滑时钟引擎与 MQTT 主入口
├── run-silent.vbs       # Windows 后台静默自启脚本
├── package.json
└── README.md

```

---

## 快速上手

### 1. 克隆仓库并安装依赖

```bash
git clone https://github.com/yqs9807/netMusic-progress-bar.git
cd netease-ulanzi-monitor
npm install
```

### 2. 修改用户配置文件 `config.json`

打开根目录下的 `config.json`，根据你的网络环境与显示喜好修改参数即可，无需修改任何代码：

> 注意：
> - cdpPort：需要修改为与后续网易云音乐添加的调试参数端口，默认 9222，被占用时可修改为其他端口
> - mqttBroker：根据自己的情况修改 MQTT Broker 地址和端口号
> - mqttTopic: 根据设备的情况，DIY 应用的 Topic 为 {[topic_prefix]/custom/[DIYAPP_name]}
>   - 前缀：ulanzi_xxxx，其中 xxxx 为设备 MAC 地址后四位的小写，如设备MAC地址为 `CC:C4:B2:77:A1:23`，此处的前缀应该为 ulanzi_a123
>   - DIYAPP_name：设备会将此应用标记为 DIYAPP_name，不同的 DIYAPP_name 代表不同的应用，可以通过旋钮切换，此时默认为“netease”，用于可以自行修改。

```json
{
  "network": {
    "cdpPort": 9222,
    "mqttBroker": "mqtt://{Your MQTT Broker IP}:1883",
    "mqttTopic": "{topic_prefix}/custom/netease"
  },
  "display": {
    "screenWidth": 52,
    "screenHeight": 16,
    "preset": "RETRO_BADGE"
  },
  "colors": {
    "progressBarTrack": "#222222",        // 进度条未播放颜色
    "progressBarFill": "#00FFFF",         // 进度条已播放颜色

    "statusPlayIcon": "#00FFCC",          // 播放图标 ▶ 颜色
    "statusPauseIcon": "#FFCC00",         // 暂停图标 || 颜色

    "currentTime": "#00FFCC",             // 已播放时间颜色
    "totalTime": "#888888",               // 未播放时间颜色

    "TagHeader": "#F20D24",               // “Net Music” 颜色

    // RETRO_BADGE
    "vinylBody": "#2A2A2A",               // 唱片主体实心圆颜色
    "vinylCenter": "#F20D24",             // 唱片中心实心圆颜色
    "vinylSpindle": "#FFFFFF",            // 唱片轴心孔点
    "tonearmBase": "#888888",             // 唱臂基座颜色（旋转轴）
    "tonearmPlay": "#00FFCC",             // 播放时，唱臂颜色
    "tonearmPause": "#666666"             // 暂停时，唱臂颜色
  }
}
```

### 3. 带参数启动网易云音乐

网易云音乐桌面客户端需开启远程调试端口供 CDP 建立连接：

1. 退出当前正在运行的网易云音乐。

2. 右键网易云音乐桌面快捷方式 -> **属性** -> **快捷方式** 选项卡。

3. 在 **目标**（Target）栏末尾添加调试参数（**注意前面有一个空格**）：

```text
--remote-debugging-port=9222
```

4. 点击确定，并重新启动网易云音乐。


### 4. 运行监控服务

```bash
node app.js
```

---

## Windows 开机静默后台运行

使用 Windows 自带的 `Startup` 目录与静默 VBS 脚本，无需第三方管理工具即可实现开机无窗口后台运行：

1. 项目根目录下已提供 `run-silent.vbs` 文件，其内容如下：


```vbscript
Set ws = CreateObject("WScript.Shell")
currentPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
ws.Run "node """ & currentPath & "\app.js""", 0, False

```


2. 按下快捷键 `Win + R`，输入 `shell:startup` 并回车打开系统启动文件夹。


3. 右键 `run-silent.vbs` -> **创建快捷方式**，将生成的快捷方式复制到打开的 `Startup` 文件夹中即可。



> **提示**：如需停止后台运行的服务，在任务管理器中找到 `Node.js JavaScript Runtime` 进程结束即可。

---

## 协议与数据结构参考

服务每秒（或状态切换瞬间）通过 MQTT 向 Ulanzi 固件推送原生点阵描述协议：

```json
{
  "text": [
    {
      "content": "01:23",
      "fontHeight": 10,
      "x": 1,
      "y": 3,
      "color": "#F20D24",
      "rect": [0, 0, 52, 16],
      "charSpacing": 1
    },
    {
      "content": "/03:45",
      "fontHeight": 5,
      "x": 28,
      "y": 8,
      "color": "#888888",
      "rect": [0, 0, 52, 16],
      "charSpacing": 1
    }
  ],
  "draw": [
    { "dl": [0, 15, 51, 15, "#222222"] },
    { "dl": [0, 15, 23, 15, "#00FFFF"] },
    { "dl": [48, 1, 48, 5, "#00FFCC"] }
  ]
}

```

---

## 开源许可

本项目基于 [MIT License](https://www.google.com/search?q=LICENSE) 开源。

---

**参考源**

* **Chrome DevTools Protocol (CDP)**: `Runtime.evaluate` & `Emulation` Domain Specifications
* **MQTT Version 5.0 / 3.1.1 Specification**: OASIS Standard for IoT Messaging Protocol
* **Microsoft Learn**: Windows Script Host `WScript.Shell.Run` Method WindowStyle Reference

---

## 当前存在问题

受设备固件限制，当前无法自动切换到 DIY 模式，需要手动切换。