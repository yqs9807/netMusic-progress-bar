# PixMusicControl for Ulanzi Pixel Clock（TC002）

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MQTT](https://img.shields.io/badge/MQTT-3.1.1%20%2F%205.0-blue.svg)](https://mqtt.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

基于 **Chrome DevTools Protocol (CDP)** 与 **MQTT** 构建的桌面像素音乐控制台。

通过 CDP 协议毫秒级捕获 Windows 客户端网易云音乐（Electron 内核）的播放状态与时间进度，结合 **Dead Reckoning（航位推测/本地时钟平滑）** 算法消除节流卡顿，以原生图元指令推送到 MQTT Broker，在 **Ulanzi 像素时钟（TC002，52×16 点阵）** 实时呈现。附带原生暗黑风格 Web 控制面板与系统托盘管理，支持热重载调色与可视化预览。

---

## 特性亮点

* **零侵入与零客户端 Patch**：纯原生 Node.js 与 CDP 连接，无需修改网易云客户端内核，无需安装 BetterNCM 等第三方插件。
* **本地平滑推进 (Dead Reckoning)**：针对 Electron 渲染层节流（DOM 2 秒跳跃一次）问题，通过本地高精度时钟均匀自校准推进，彻底杜绝跳秒。
* **即时保存与热重载**：内置 Web 配置面板，保存参数后立即热更新内存并即刻推送一帧当前画面，无需重启后台服务。
* **三种不同排版预设**：内置紧凑标签、大号主时钟以及带有机械唱臂联动的黑胶唱片模式。
* **点阵调色板与实时 Web 仿真**：提供 Web 端 52×16 Canvas 虚拟点阵屏，所见即所得调试通用色彩及各预设专属颜色。
* **完善的生命周期守护与清屏机制**：网易云客户端关闭、系统托盘点击退出或捕获退出信号时，自动向硬件发送注销载荷恢复默认时钟。
* **原生系统托盘常驻**：提供 Windows 原生托盘图标与右键菜单，一键唤醒浏览器配置后台或优雅终止服务。
* **全协议认证支持**：MQTT 模块原生兼容 `mqtt://`、`mqtts://`、`ws://`、`wss://` 及自签名证书，支持标准 URI 账号密码鉴权。

---

## 界面预设展示（52 × 16）

| 预设模式 (`preset`) | 视觉布局与动态呈现 |
| --- | --- |
| `COMPACT_TAG` | 左上角小标头 `Net Music`，右上角微型播放 `▶` /暂停 `\|\|` 图标，左下角 5 号字体显示 `当前播放时间/总时长`，屏幕底部单像素进度条 |
| `LARGE_CURRENT` | 左侧突出展示当前时间（**10号大字体**），右下角对齐歌曲总时长（5号字），右上角状态图标，底部单像素进度条 |
| `RETRO_BADGE` | 左侧绘制圆形黑胶唱片（**播放时旋转高光，暂停时停止转动**），搭配机械唱臂联动（**播放时唱头斜切压入盘面，暂停时垂直停靠归位**），右侧展示时间数值与状态图标 |

---

## 项目结构

```text
pixmusiccontrol/
├── assets/
│   └── tray.ico             # Windows 系统托盘图标
├── config/
│   ├── config.example.json  # 配置文件模板
│   └── config.json          # 实际生效的用户配置文件（由模板复制生成）
├── src/
│   ├── app.js               # 核心监听、CDP 状态轮询、平滑时钟引擎与生命周期管理
│   ├── renderer.js          # Ulanzi 点阵排版、字模解析与 MQTT Payload 构建
│   └── tray.js              # 系统托盘菜单管理模块
├── web/
│   ├── index.html           # 控制台 Web UI 入口
│   ├── style.css            # 暗色机能风样式与响应式布局
│   ├── app.js               # Web 端虚拟点阵仿真 Canvas、调色逻辑与配置交互
│   ├── font.js              # 点阵 5 号与 10 号字模字典
│   └── icons/               # 矢量控制台图标与 Favicon
├── index.js                 # 主程序入口：装载 HTTP 配置服务、托盘与监听主循环
├── package.json
└── README.md

```

---

## 快速上手

### 1. 克隆仓库并安装依赖

```bash
git clone [https://github.com/yqs9807/netMusic-progress-bar.git](https://github.com/yqs9807/netMusic-progress-bar.git)
cd netMusic-progress-bar
npm install

```

### 2. 生成并修改用户配置文件 `config.json`

复制模板生成 `config.json`：

```bash
# Windows 命令提示符
copy config\config.example.json config\config.json

# PowerShell / Bash
cp config/config.example.json config/config.json

```

打开 `config/config.json`，根据网络与设备参数进行配置：

> 关键参数说明：
> * `webPort`：Web 配置面板监听端口，默认 `25688`。
> * `cdpPort`：与网易云音乐启动参数中的远程调试端口保持一致，默认 `9222`。
> * `mqttBroker`（必改）：MQTT Broker 连接地址。支持账号密码鉴权与多种协议，如 `mqtt://192.168.1.100:1883` 或 `mqtt://user:pass@192.168.1.100:1883`。
> * `mqttTopic`（必改）：Ulanzi TC002 接收自定义绘制的标准 Topic：`[topic_prefix]/custom/[DIYAPP_name]`。
> * 前缀（`topic_prefix`）：默认为 `ulanzi_xxxx`（`xxxx` 为设备 MAC 地址后 4 位小写）。
> * 应用名（`DIYAPP_name`）：自定义频道标识，默认为 `netease`。


```json
{
  "network": {
    "webPort": 25688,
    "cdpPort": 9222,
    "mqttBroker": "mqtt://192.168.1.100:1883",
    "mqttTopic": "ulanzi_xxxx/custom/netease"
  },
  "display": {
    "screenWidth": 52,
    "screenHeight": 16,
    "preset": "RETRO_BADGE"
  },
  "colors": {
    "common": {
      "progressBarTrack": "#222222",
      "progressBarFill": "#00FFFF",
      "currentTime": "#00FFCC",
      "totalTime": "#888888",
      "statusPlayIcon": "#00FFCC",
      "statusPauseIcon": "#FFCC00"
    },
    "presets": {
      "RETRO_BADGE": {
        "vinylBody": "#2A2A2A",
        "vinylCenter": "#F20D24",
        "vinylSpindle": "#FFFFFF",
        "vinylHighlightMain": "#FFD700",
        "vinylHighlightFade": "#554822",
        "tonearmBase": "#888888",
        "tonearmPlay": "#00FFCC",
        "tonearmPause": "#666666"
      },
      "COMPACT_TAG": {
        "tagHeader": "#F20D24"
      },
      "LARGE_CURRENT": {}
    }
  }
}

```

### 3. 带参数启动网易云音乐

网易云音乐桌面客户端需开启远程调试端口供 CDP 建立连接：

1. 退出当前运行的网易云音乐。
2. 右键网易云音乐桌面快捷方式 -> **属性** -> **快捷方式**。
3. 在 **目标**（Target）栏末尾追加调试参数（**注意前面有一个空格**）：

```text
 --remote-debugging-port=9222

```

4. 保存并重新启动网易云音乐。

> ⚠️ 重要提示：客户端静默升级后参数覆盖问题
> 网易云客户端升级后可能重置快捷方式目标路径。推荐在根目录下创建批处理脚本 `start-cloudmusic.bat` 启动：
> ```cmd
> @echo off
> start "" "C:\Program Files\NetEase\CloudMusic\cloudmusic.exe" --remote-debugging-port=9222
> ```

### 4. 运行服务与使用控制台

```bash
npm start

```

* 服务启动后将自动驻留于 Windows 任务栏系统托盘。
* 默认自动唤起浏览器打开 `http://127.0.0.1:25688` 访问 Web 控制面板。
* 在控制面板修改预设或配色方案后点击 **保存配置**，服务端将立即热重载并在屏幕端呈现变动。

---

## 屏幕低亮度色彩兼容性与检测

### 硬件 5% 最低亮度限制与色彩截断

Ulanzi TC002 官方固件允许调节的亮度区间为 **5% ~ 100%**。由于低亮度下存在 PWM 整数相乘截断，若颜色的 RGB 最大分量过小，在调低亮度时有效输出值会被裁切为 0，导致 **LED 像素点完全熄灭**。

为了确保色彩在设备**极限最低亮度 (5%)** 下依然能稳定发光，色彩的十六进制最大分量必须满足：

`max(R,G,B) >= 20 (即≥#141414)` 


| 色彩分量 (HEX) | 通道最大值 | 设备最低有效发光亮度 | 兼容性评估 |
| --- | --- | --- | --- |
| `#010101` ~ `#090909` | 1 ~ 9 | 100% ~ 12% | 极易熄灭，必须高亮度运行 |
| `#0A0A0A` ~ `#131313` | 10 ~ 19 | 10% ~ 6% | 低亮度失效，调至 5% 时熄灭 |
| **`#141414` 及以上** | **$\ge 20$** | **$\le 5\%$** | **全亮度兼容（5%~100% 安全发光）** |
| `#222222`（默认底槽） | 34 | 3% | 完美兼容 |
| `#2A2A2A`（黑胶唱片） | 42 | 3% | 完美兼容 |

---

## 协议与数据结构参考

运行期间，程序通过 MQTT 向 Ulanzi 固件持续推送原生图元描述协议：

```json
{
  "text": [
    {
      "content": "01:23",
      "fontHeight": 5,
      "x": 16,
      "y": 1,
      "color": "#00FFCC",
      "rect": [0, 0, 52, 16],
      "charSpacing": 1
    },
    {
      "content": "/03:45",
      "fontHeight": 5,
      "x": 24,
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

网易云客户端关闭或 PixMusicControl 退出时，服务向下发 `{}` 触发设备注销自定义应用并恢复默认桌面时钟。

---

## 已知问题与限制

1. 设备固件机制限制：首次运行需手动切换或等待轮询进入对应的自定义应用界面。
2. 网易云更新覆盖：官方客户端静默更新后可能会还原快捷方式，需重新追加 `--remote-debugging-port` 启动参数。

---

## 开源许可

本项目基于 [MIT License](https://www.google.com/search?q=LICENSE&utm_source=gemini) 开源。

---

**参考源**

* **Chrome DevTools Protocol (CDP)**: `Runtime.evaluate` & `Target` Domain Specifications
* **MQTT Version 5.0 / 3.1.1 Specification**: OASIS Standard for IoT Messaging Protocol
* **Ulanzi TC002 / Awtrix Light API**: Custom App Drawing Matrix Specifications

