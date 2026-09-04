/**
 * NetEase Cloud Music Now Playing Monitor
 * 主入口服务：集成网易云进程生命周期监听、退出清屏、CDP 及 MQTT
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const { formatSec, buildPayload } = require('./renderer');

// ==========================================
// 加载配置文件 (严格路径与容错)
// ==========================================
const configPath = path.resolve(__dirname, 'config.json');
const examplePath = path.resolve(__dirname, 'config.example.json');
let config;

if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} else if (fs.existsSync(examplePath)) {
  console.warn('[警告] 未找到 config.json，已加载 config.example.json 模板！');
  config = JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
} else {
  console.error('[错误] 找不到任何配置文件');
  process.exit(1);
}

// ==========================================
// 核心状态变量
// ==========================================
let mqttConnected = false;
let anchorCurrent = 0;
let anchorTotal = 0;
let anchorTimestamp = 0;
let isPlaying = false;
let lastPublishedSecond = -1;
let lastPublishedPlayState = null;

let isNeteaseRunning = false;
let cdpWs = null;
let cdpPollTimer = null;
let smoothClockTimer = null;

// ==========================================
// MQTT 客户端
// ==========================================
const mqttClient = mqtt.connect(config.network.mqttBroker, {
  connectTimeout: 5000,
  reconnectPeriod: 5000
});

mqttClient.on('connect', () => {
  mqttConnected = true;
  console.log('[MQTT] 成功连接至 Broker:', config.network.mqttBroker);
});

mqttClient.on('error', (err) => {
  console.warn('[MQTT 异常]', err.message);
});

/**
 * 组装并发送当前点阵数据
 */
function publishCurrentState(currentSec) {
  const payloadObj = buildPayload(currentSec, anchorTotal, isPlaying, config);
  const payloadStr = JSON.stringify(payloadObj);

  if (mqttConnected) {
    mqttClient.publish(config.network.mqttTopic, payloadStr);
  }
}

/**
 * 网易云退出时向设备发送空 Payload 清屏并关闭 DIY-app
 */
function publishClearScreen() {
  if (mqttConnected) {
    mqttClient.publish(config.network.mqttTopic, "{}", () => {
      console.log('[清屏] 已向屏幕发送空 Payload，关闭 DIY-app。');
    });
  }
}

// ==========================================
// 平滑时钟引擎调度
// ==========================================
function startSmoothClock() {
  if (smoothClockTimer) return;

  smoothClockTimer = setInterval(() => {
    if (!isNeteaseRunning || anchorTotal <= 0 || anchorTimestamp === 0) return;

    let estimatedCurrent = anchorCurrent;
    if (isPlaying) {
      const elapsed = (Date.now() - anchorTimestamp) / 1000;
      estimatedCurrent = Math.min(anchorCurrent + elapsed, anchorTotal);
    }
    const currentSecFloor = Math.floor(estimatedCurrent);

    if (currentSecFloor !== lastPublishedSecond || isPlaying !== lastPublishedPlayState) {
      lastPublishedSecond = currentSecFloor;
      lastPublishedPlayState = isPlaying;
      publishCurrentState(currentSecFloor);
    }
  }, 200);
}

function stopSmoothClock() {
  if (smoothClockTimer) {
    clearInterval(smoothClockTimer);
    smoothClockTimer = null;
  }
  lastPublishedSecond = -1;
  lastPublishedPlayState = null;
  anchorCurrent = 0;
  anchorTotal = 0;
  anchorTimestamp = 0;
  isPlaying = false;
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
      startSmoothClock();

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
      }, 200);
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

          if (previousState && !isPlaying) {
            const currentPredicted = anchorCurrent + (Date.now() - anchorTimestamp) / 1000;
            anchorCurrent = Math.min(Math.max(currentPredicted, rawCurrent), anchorTotal);
            anchorTimestamp = Date.now();
            lastPublishedPlayState = null;
          } else if (!previousState && isPlaying) {
            anchorCurrent = rawCurrent;
            anchorTimestamp = Date.now();
            lastPublishedPlayState = null;
          } else if (isPlaying) {
            const currentPredicted = anchorCurrent + (Date.now() - anchorTimestamp) / 1000;
            const diff = rawCurrent - currentPredicted;

            if (Math.abs(diff) > 2.0 || anchorTimestamp === 0) {
              anchorCurrent = rawCurrent;
              anchorTimestamp = Date.now();
            }
          }
        }
      } catch (e) {}
    });

    cdpWs.on('close', () => {
      disconnectCDP();
    });

    cdpWs.on('error', () => {
      disconnectCDP();
    });

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
    try { cdpWs.terminate(); } catch (e) {}
    cdpWs = null;
  }
}

// ==========================================
// Windows 进程守护监听 (每 3 秒检测一次)
// ==========================================
function checkNeteaseProcess() {
  exec('tasklist /FI "IMAGENAME eq cloudmusic.exe" /NH', (err, stdout) => {
    if (err) return;

    const running = stdout.toLowerCase().includes('cloudmusic.exe');

    // 状态转换：网易云已启动
    if (running && !isNeteaseRunning) {
      isNeteaseRunning = true;
      console.log('[进程守护] 检测到网易云音乐已启动，正在连接 CDP...');
      connectCDP();
    }
    // 状态转换：网易云已退出
    else if (!running && isNeteaseRunning) {
      isNeteaseRunning = false;
      console.log('[进程守护] 检测到网易云音乐已关闭。');
      disconnectCDP();
      stopSmoothClock();
      publishClearScreen();
    }
    // 保持运行状态下，若 CDP 掉线则持续重连
    else if (running && !cdpWs) {
      connectCDP();
    }
  });
}

// 启动常驻进程轮询守护
setInterval(checkNeteaseProcess, 3000);
checkNeteaseProcess();