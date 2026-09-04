/**
 * NetEase Cloud Music Now Playing Monitor
 * 主入口服务：负责 CDP 连接、状态采样、时钟平滑及 MQTT 通信
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const { formatSec, buildPayload } = require('./renderer');

// ==========================================
// 读取外部配置文件 (严格检验路径)
// ==========================================
const configPath = path.resolve(__dirname, 'config.json');
let config;

try {
  const configFile = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(configFile);
} catch (err) {
  console.error('[配置错误] 无法正确加载 config.json:', err.message);
  process.exit(1);
}

// ==========================================
// 核心状态变量
// ==========================================
let mqttConnected = false;
let anchorCurrent = 0;       // 最近一次从网易云 DOM 校准的基准秒数
let anchorTotal = 0;         // 歌曲总秒数
let anchorTimestamp = 0;     // 同步时的本地时间戳 (毫秒)
let isPlaying = false;       // 播放状态标记
let lastPublishedSecond = -1;// 上次已发布的整秒数
let lastPublishedPlayState = null; // 上次已发布的播放状态

// 初始化 MQTT 客户端
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
 * 组装并发送当前的屏幕点阵数据
 * @param {number} currentSec - 当前整秒数
 */
function publishCurrentState(currentSec) {
  const payloadObj = buildPayload(currentSec, anchorTotal, isPlaying, config);
  const payloadStr = JSON.stringify(payloadObj);

  console.log(`[推送] ${formatSec(currentSec)}/${formatSec(anchorTotal)} | 模式: ${config.display.preset} | 状态: ${isPlaying ? '播放中 ▶' : '暂停 ||'}`);

  if (mqttConnected) {
    mqttClient.publish(config.network.mqttTopic, payloadStr);
  }
}

// ==========================================
// 本地平滑时钟引擎 (严格 200ms 刷新率保证平滑)
// ==========================================
setInterval(() => {
  if (anchorTotal <= 0 || anchorTimestamp === 0) return;

  let estimatedCurrent = anchorCurrent;
  if (isPlaying) {
    const elapsed = (Date.now() - anchorTimestamp) / 1000;
    estimatedCurrent = Math.min(anchorCurrent + elapsed, anchorTotal);
  }
  const currentSecFloor = Math.floor(estimatedCurrent);

  // 当整秒递增，或者播放/暂停发生切换时，立即向 MQTT 投递数据
  if (currentSecFloor !== lastPublishedSecond || isPlaying !== lastPublishedPlayState) {
    lastPublishedSecond = currentSecFloor;
    lastPublishedPlayState = isPlaying;
    publishCurrentState(currentSecFloor);
  }
}, 200);

/**
 * 探测网易云音乐 Electron 调试端点
 * @param {number} port - 调试端口
 * @returns {Promise<string>} 返回目标 WebSocket 调试 URL
 */
function getDebugTarget(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: port,
      path: '/json/list',
      timeout: 3000
    }, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const targets = JSON.parse(rawData);
          const target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || targets[0];

          if (!target || !target.webSocketDebuggerUrl) {
            return reject(new Error('未在 /json/list 中匹配到有效调试目标'));
          }

          let wsUrl = target.webSocketDebuggerUrl.replace('ws://localhost:', 'ws://127.0.0.1:');
          resolve(wsUrl);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`连接 CDP 端口 ${port} 超时，请确认网易云已携带 --remote-debugging-port 启动`));
    });

    req.on('error', (err) => reject(err));
  });
}

/**
 * 启动 CDP 监控与状态采样
 */
async function startMonitoring() {
  try {
    const wsUrl = await getDebugTarget(config.network.cdpPort);
    const ws = new WebSocket(wsUrl, {
      headers: { Host: `127.0.0.1:${config.network.cdpPort}` },
      handshakeTimeout: 5000
    });

    let msgId = 1;
    let pollTimer = null;

    ws.on('open', () => {
      console.log('[CDP] 连接成功，开启状态监测...');

      // 周期性采集播放进度及状态
      pollTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;

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

        ws.send(JSON.stringify({
          id: msgId,
          method: 'Runtime.evaluate',
          params: {
            expression: expression,
            returnByValue: true
          }
        }));
      }, 200);
    });

    ws.on('message', (message) => {
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

          // 播放 -> 暂停 瞬间：锁定当前虚拟平滑秒数，严禁往回退
          if (previousState && !isPlaying) {
            const currentPredicted = anchorCurrent + (Date.now() - anchorTimestamp) / 1000;
            anchorCurrent = Math.min(Math.max(currentPredicted, rawCurrent), anchorTotal);
            anchorTimestamp = Date.now();
            lastPublishedPlayState = null;
          } 
          // 暂停 -> 播放 瞬间：使用最新 DOM 值重置锚点
          else if (!previousState && isPlaying) {
            anchorCurrent = rawCurrent;
            anchorTimestamp = Date.now();
            lastPublishedPlayState = null;
          } 
          // 持续播放中：若用户拖拽进度条或切歌（时差 > 2 秒），进行校准
          else if (isPlaying) {
            const currentPredicted = anchorCurrent + (Date.now() - anchorTimestamp) / 1000;
            const diff = rawCurrent - currentPredicted;

            if (Math.abs(diff) > 2.0 || anchorTimestamp === 0) {
              anchorCurrent = rawCurrent;
              anchorTimestamp = Date.now();
            }
          }
        } else {
          isPlaying = false;
        }
      } catch (e) {}
    });

    ws.on('error', (err) => {
      console.error('[WS 异常]', err.message);
    });

    ws.on('close', (code) => {
      console.log(`[WS 断开] 状态码: ${code}，3 秒后自动重试...`);
      isPlaying = false;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      setTimeout(startMonitoring, 3000);
    });

  } catch (err) {
    console.error('[初始化失败]', err.message, '，3 秒后重试...');
    setTimeout(startMonitoring, 3000);
  }
}

// 启动主程序
startMonitoring();