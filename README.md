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
├── config.example.json  # 配置文件模板（提交至 Git，不包含个人敏感配置）
├── config.json          # 实际生效的用户配置文件（包含本机配置，已被 .gitignore 忽略）
├── renderer.js          # Ulanzi 像素排版与图元构建渲染模块
├── app.js               # 进程守护、CDP 监听、本地平滑时钟引擎与 MQTT 主入口
├── run-silent.vbs       # Windows 后台静默自启脚本
├── package.json
└── README.md

```

---

## 快速上手

### 1. 克隆仓库并安装依赖

```bash
git clone https://github.com/yqs9807/netMusic-progress-bar.git
cd netMusic-progress-bar
npm install
```

### 2. 生成并修改用户配置文件 `config.json`

打开根目录下的 `config.example.json`，复制一份并重命名为 `config.json` ，根据你的网络环境与显示喜好修改参数即可，无需修改任何代码：

> 注意：
> 
> 本项目无法直接开箱运行，运行前必须由模板复制生成 config.json 并修改您的设备专属参数（尤其是 mqttBroker 与 mqttTopic），否则脚本将无法与 MQTT Broker 建立连接，设备也将无法接收显示数据。


> 关键参数配置指南
> - mqttBroker（必改）：修改为您实际搭建的 MQTT 服务器 IP 与端口（例如软路由、NAS 或 Home Assistant 的 MQTT 实例，格式如 mqtt://192.168.1.1:1883）。
>   - 如果设有账号密码，请按标准 URI 格式填写：mqtt://username:password@192.168.1.1:1883。
> - mqttTopic（必改）：Ulanzi TC002 接收自定义绘图的格式标准为：[topic_prefix]/custom/[DIYAPP_name]。  
>   - 前缀（topic_prefix）：默认规则为 ulanzi_xxxx，其中 xxxx 为您的 Ulanzi TC002 的 MAC 地址最后 4 位小写。例如屏设备 MAC 为 CC:C4:B2:77:A1:23，前缀则必须填为 ulanzi_a123。  
>   - 应用名（DIYAPP_name）：设备会将此点阵标记为一个独立的自定义应用（可通过机身旋钮左右切换其他），默认设为 netease，如无特殊冲突建议保持默认。  
>   - cdpPort：与后续网易云音乐添加的调试启动参数端口一致，默认为 9222。如已被系统其他应用占用可更改为其他端口（如 9223）。

```json
{
  "network": {
    "cdpPort": 9222,
    "mqttBroker": "mqtt://{Your MQTT Broker IP}:1883",
    "mqttTopic": "{topic_prefix}/custom/netease"
  },
  "display": {
    "screenWidth": 52,                      // 点阵屏幕长，不建议修改
    "screenHeight": 16,                     // 点阵屏幕高，不建议修改
    "preset": "RETRO_BADGE"                 // 三选一预设
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

3. 在 **目标**（Target）栏末尾添加调试参数（**注意前面有一个空格**）`：`

```text
 --remote-debugging-port=9222
```

4. 点击确定，并重新启动网易云音乐。

> ⚠️ 重要提示：网易云客户端更新后参数失效问题
> 
> 当网易云音乐在后台完成自动静默更新或版本升级后，Windows 的桌面/开始菜单快捷方式会被安装程序强制重新生成并覆盖，导致此前手动追加的 `--remote-debugging-port=9222` 参数丢失，进而造成控制端无法捕获播放状态。
> 
> - 应对与防重置方案：
> 
>   重新检查快捷方式：如果在客户端更新后屏幕不再显示播放进度，请重复上述步骤检查目标栏参数是否已被还原并重新填入。
> 
>   持久化启动方式（推荐）：不要直接修改网易云默认快捷方式，而是在项目根目录下创建一个专用的启动脚本 start-cloudmusic.bat，之后通过该批处理或其快捷方式启动网易云（请根据您的实际安装路径调整下面 cloudmusic.exe 的路径）：
> 
> ``` DOS
> @echo off
> start "" "C:\Program Files\NetEase\CloudMusic\cloudmusic.exe" --remote-debugging-port=9222
> ```
> 

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

## 当前存在问题

1. 受设备固件限制，当前无法自动切换到 DIY 模式，需要手动切换。
2. 网易云音乐更新后，快捷方式的设置会被重置，需要再次手动添加相关启动参数。

---

## 开源许可

本项目基于 [MIT License](https://www.google.com/search?q=LICENSE) 开源。

---

**参考源**

* **Chrome DevTools Protocol (CDP)**: `Runtime.evaluate` & `Emulation` Domain Specifications
* **MQTT Version 5.0 / 3.1.1 Specification**: OASIS Standard for IoT Messaging Protocol
* **Microsoft Learn**: Windows Script Host `WScript.Shell.Run` Method WindowStyle Reference

