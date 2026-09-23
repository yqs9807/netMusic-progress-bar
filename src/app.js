/**
 * NetEase Cloud Music Now Playing Monitor
 * 核心监听与同步服务 (Node.js 后端)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const { formatSec, buildPayload } = require('./renderer');

// ==========================================
// 加载配置文件
// ==========================================
const configPath = path.resolve(__dirname, '..', 'config', 'config.json');
const examplePath = path.resolve(__dirname, '..', 'config', 'config.example.json');
let config;

function loadConfig() {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } else if (fs.existsSync(examplePath)) {
    console.warn('[警告] 未找到 config.json，已加载 config.example.json 模板！');
    config = JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
  } else {
    console.error('[错误] 找不到任何配置文件');
    process.exit(1);
  }
}

loadConfig();

// ==========================================
// 核心状态变量
// ==========================================
let mqttConnected = false;
let anchorCurrent = 0;
let anchorTotal = 0;
let anchorTimestamp = 0;
let isPlaying = false;
let displayedSecond = 0;

let isNeteaseRunning = false;
let cdpWs = null;
let cdpPollTimer = null;
let tickerTimeout = null;
let nextExpectedTick = 0;
let processCheckTimer = null;
let mqttClient = null;

// ==========================================
// 启动与生命周期管理
// ==========================================
function startApp() {
  mqttClient = mqtt.connect(config.network.mqttBroker, {
    connectTimeout: 5000,
    reconnectPeriod: 5000,
    rejectUnauthorized: false // 兼容私有/局域网自签名 SSL 证书
  });

  mqttClient.on('connect', () => {
    mqttConnected = true;
    console.log('[MQTT] 成功连接至 Broker:', config.network.mqttBroker);
  });

  mqttClient.on('error', (err) => {
    console.warn('[MQTT 异常]', err.message);
  });

  if (!processCheckTimer) {
    processCheckTimer = setInterval(checkNeteaseProcess, 3000);
    checkNeteaseProcess();
  }
}

function reloadConfig(newConfig) {
  config = newConfig;
  console.log('[配置] 主监听核心已热重载最新配置');

  // 如果网易云处于运行状态（无论播放还是暂停），立刻向 MQTT 强推一帧新配置画面
  if (isNeteaseRunning) {
    publishCurrentState(displayedSecond);
    console.log('[屏幕同步] 已向硬件即时推送最新样式与配色帧');
  }
}

/**
 * 优雅停止服务并清空屏幕
 */
async function stopApp() {
  console.log('[退出] 正在清理服务并向屏幕发送清屏信号...');

  // 1. 安全停止所有运行中的定时器与平滑时钟
  if (processCheckTimer) {
    clearInterval(processCheckTimer);
    processCheckTimer = null;
  }
  disconnectCDP();
  stopSmoothClock();

  // 2. 向 Ulanzi 下发清屏指令
  if (mqttClient && mqttClient.connected) {
    const clearPayload = JSON.stringify({});

    try {
      await new Promise((resolve, reject) => {
        // QoS 设置为 1，确保收到 broker ACK 确认后再放行
        mqttClient.publish(config.network.mqttTopic, clearPayload, { qos: 1 }, (err) => {
          if (err) {
            console.error('[MQTT] 清屏数据发送失败:', err.message);
            reject(err);
          } else {
            console.log('[MQTT] 已下发清屏指令');
            resolve();
          }
        });
      });
    } catch (e) {
      console.warn('[MQTT] 发送清屏跳过:', e.message);
    }

    // 等待 100ms 确保底层 TCP 数据帧彻底出网
    await new Promise(r => setTimeout(r, 100));

    // 优雅关闭 MQTT 客户端
    await new Promise(resolve => mqttClient.end(false, resolve));
  }

  console.log('[退出] 服务已完全释放');
}

/**
 * 组装并发送当前点阵数据
 */
function publishCurrentState(currentSec) {
  const payloadObj = buildPayload(currentSec, anchorTotal, isPlaying, config);
  const payloadStr = JSON.stringify(payloadObj);

  if (mqttConnected && mqttClient) {
    mqttClient.publish(config.network.mqttTopic, payloadStr);
  }
}

/**
 * 网易云退出时向设备发送空 Payload 清屏并关闭 DIY-app
 */
function publishClearScreen() {
  if (mqttConnected && mqttClient) {
    mqttClient.publish(config.network.mqttTopic, "{}", () => {
      console.log('[清屏] 已向屏幕发送空 Payload，关闭 DIY-app。');
    });
  }
}

// ==========================================
// 高精度自校准平滑时钟引擎 (1.000s 严格节拍)
// ==========================================
function scheduleNextTick() {
  if (!isNeteaseRunning) return;

  const now = Date.now();
  let delay = nextExpectedTick - now;
  if (delay < 0) delay = 0;

  tickerTimeout = setTimeout(() => {
    tickClock();
  }, delay);
}

function tickClock() {
  if (!isNeteaseRunning) return;

  if (isPlaying) {
    if (displayedSecond < anchorTotal) {
      displayedSecond += 1;
    }
    if (anchorTimestamp > 0) {
      const realPredicted = anchorCurrent + (Date.now() - anchorTimestamp) / 1000;
      if (Math.abs(realPredicted - displayedSecond) > 1.5) {
        displayedSecond = Math.floor(realPredicted);
      }
    }
  }

  publishCurrentState(displayedSecond);

  nextExpectedTick += 1000;
  scheduleNextTick();
}

function startSmoothClock() {
  if (tickerTimeout) return;

  displayedSecond = Math.floor(anchorCurrent);
  nextExpectedTick = Date.now() + 1000;

  publishCurrentState(displayedSecond);
  scheduleNextTick();
}

function stopSmoothClock() {
  if (tickerTimeout) {
    clearTimeout(tickerTimeout);
    tickerTimeout = null;
  }
  anchorCurrent = 0;
  anchorTotal = 0;
  anchorTimestamp = 0;
  isPlaying = false;
  displayedSecond = 0;
}

// ==========================================
// CDP 连接管理
// ==========================================
function getDebugTarget(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: port,
      path: '/json/list',
      timeout: 2500
    }, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const targets = JSON.parse(rawData);
          const target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || targets[0];
          if (!target || !target.webSocketDebuggerUrl) {
            return reject(new Error('未匹配到有效调试目标'));
          }
          resolve(target.webSocketDebuggerUrl.replace('ws://localhost:', 'ws://127.0.0.1:'));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('连接超时'));
    });
    req.on('error', (err) => reject(err));
  });
}

async function connectCDP() {
  if (!isNeteaseRunning || cdpWs) return;

  try {
    const wsUrl = await getDebugTarget(config.network.cdpPort);
    cdpWs = new WebSocket(wsUrl, {
      headers: { Host: `127.0.0.1:${config.network.cdpPort}` },
      handshakeTimeout: 5000
    });

    let msgId = 1;

    cdpWs.on('open', () => {
      console.log('[CDP] 调试端点连接建立，开始捕获状态...');

      cdpPollTimer = setInterval(() => {
        if (!cdpWs || cdpWs.readyState !== WebSocket.OPEN) return;

        const expression = `
          (() => {
            const input = document.querySelector('div[aria-label="播放进度调节"] input[type="range"]');
            const hasPauseBtn = document.querySelector('.cmd-icon-pause, [aria-label="pause"]') !== null;
            const hasPlayBtn = document.querySelector('.cmd-icon-play, [aria-label="play"]') !== null;
            
            let isAudioPlaying = null;
            if (hasPauseBtn) {
              isAudioPlaying = true;
            } else if (hasPlayBtn) {
              isAudioPlaying = false;
            }

            if (input) {
              return {
                current: parseFloat(input.value) || 0,
                total: parseFloat(input.max) || 0,
                btnState: isAudioPlaying
              };
            }
            return null;
          })()
        `;

        if (++msgId > 10000) msgId = 1;

        cdpWs.send(JSON.stringify({
          id: msgId,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true }
        }));
      }, 300);
    });

    cdpWs.on('message', (message) => {
      try {
        const res = JSON.parse(message.toString());
        const data = res?.result?.result?.value;

        if (data && data.total > 0) {
          const rawCurrent = data.current;
          anchorTotal = data.total;
          const previousState = isPlaying;

          if (typeof data.btnState === 'boolean') {
            isPlaying = data.btnState;
          }

          if (!tickerTimeout) {
            anchorCurrent = rawCurrent;
            anchorTimestamp = Date.now();
            startSmoothClock();
            return;
          }

          if (previousState !== isPlaying) {
            anchorCurrent = rawCurrent;
            anchorTimestamp = Date.now();
            publishCurrentState(displayedSecond);
            return;
          }

          if (Math.abs(rawCurrent - displayedSecond) > 2.5) {
            anchorCurrent = rawCurrent;
            anchorTimestamp = Date.now();
            displayedSecond = Math.floor(rawCurrent);
            publishCurrentState(displayedSecond);
          }
        }
      } catch (e) { }
    });

    cdpWs.on('close', () => { disconnectCDP(); });
    cdpWs.on('error', () => { disconnectCDP(); });

  } catch (err) {
    disconnectCDP();
  }
}

function disconnectCDP() {
  if (cdpPollTimer) {
    clearInterval(cdpPollTimer);
    cdpPollTimer = null;
  }
  if (cdpWs) {
    try { cdpWs.terminate(); } catch (e) { }
    cdpWs = null;
  }
}

function checkNeteaseProcess() {
  exec('tasklist /FI "IMAGENAME eq cloudmusic.exe" /NH', (err, stdout) => {
    if (err) return;

    const running = stdout.toLowerCase().includes('cloudmusic.exe');

    if (running && !isNeteaseRunning) {
      isNeteaseRunning = true;
      console.log('[进程守护] 检测到网易云音乐已启动，正在连接 CDP...');
      connectCDP();
    } else if (!running && isNeteaseRunning) {
      isNeteaseRunning = false;
      console.log('[进程守护] 检测到网易云音乐已关闭。');
      disconnectCDP();
      stopSmoothClock();
      publishClearScreen();
    } else if (running && !cdpWs) {
      connectCDP();
    }
  });
}

/**
 * 获取当前运行时播放状态供 Web 仿真器同步
 */
function getRuntimeStatus() {
  return {
    isRunning: isNeteaseRunning,
    isPlaying: isPlaying,
    currentSec: displayedSecond,
    totalSec: anchorTotal
  };
}

module.exports = {
  startApp,
  reloadConfig,
  stopApp,
  getRuntimeStatus
};