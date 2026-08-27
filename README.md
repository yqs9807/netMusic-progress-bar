# NetEase Cloud Music Now Playing for Ulanzi Pixel Clock

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![MQTT](https://img.shields.io/badge/MQTT-3.1.1%20%2F%205.0-blue.svg)](https://mqtt.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

基于 **Chrome DevTools Protocol (CDP)** 与 **Dead Reckoning (本地时钟平滑预测)** 算法构建的轻量级工具。实时捕获 Windows 版本网易云音乐（Electron 内核）的播放进度与时长，并以原生 JSON 协议推送至 MQTT Broker，供 **Ulanzi 像素屏**（如 52×16 / 32×8 等点阵设备）显示。

---

## 特性亮点

- **零依赖外部插件**：纯 Node.js 实现，无需安装 `puppeteer-core`、BetterNCM 或修改客户端文件。
- **平滑无跳秒 (Dead Reckoning)**：克服了 Electron/Chromium 后台节流导致的 DOM 2 秒刷新一次问题，秒数均匀推进。
- **智能防触控误触**：内置 CDP Emulation 自动修正指令，防止页面鼠标变成圆圈触控指针。
- **开箱即用的预设模式**：内置两种排版预设，配置项与配色方案全部前置集中管理。
- **极低系统资源占用**：单连接 WebSocket 本地回环通信，CPU 占用接近 0%，内存消耗 < 20MB。

---

## 界面预设展示

| 预设模式 (`displayPreset`) | 视觉效果描述 | 适用点阵规格 |
|---|---|---|
| `COMPACT_TAG` | 左上角红色标头 `net music`，中间为 `当前/总时长`，底部单像素进度条 | 52×16 / 64×16 |
| `LARGE_CURRENT` | 当前时长采用 **10号大字** 居左，总时长采用 **5号小字** 底部对齐，底部单像素进度条 | 52×16 / 64×16 |

---

## 快速上手

### 1. 克隆仓库并安装依赖

```bash
git clone [https://github.com/your-username/netease-ulanzi-monitor.git](https://github.com/your-username/netease-ulanzi-monitor.git)
cd netease-ulanzi-monitor
npm install
