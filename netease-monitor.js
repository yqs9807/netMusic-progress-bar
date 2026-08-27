/**
 * NetEase Cloud Music Now Playing Monitor for Ulanzi Pixel Screen (Zero-Leak Version)
 */

const http = require('http');
const WebSocket = require('ws');
const mqtt = require('mqtt');

// ==========================================
// 全局可配置项
// ==========================================
const CONFIG = {
  cdpPort: 9222,
  mqttBroker: 'mqtt://192.168.3.100:1883',
  mqttTopic: 'ulanzi_a728/custom/netease',
  screenWidth: 52,
  screenHeight: 16,

  // 可选: 'COMPACT_TAG' 或 'LARGE_CURRENT'
  displayPreset: 'COMPACT_TAG',

  colors: {
    progressBarTrack: '#222222',
    progressBarFill: '#00FFFF',
    compactTagHeader: '#F20D24',
    compactTimeText: '#00FFCC',
    largeCurrentTime: '#F20D24',
    smallTotalTime: '#888888'
  }
};

// ==========================================
// 静态对象池 (避免反复 GC 分配内存)
// ==========================================
const STATIC_PAYLOAD = {
  text: [],
  draw: [
    // draw[0]: 进度底槽
    { dl: [0, CONFIG.screenHeight - 1, CONFIG.screenWidth - 1, CONFIG.screenHeight - 1, CONFIG.colors.progressBarTrack] },
    // draw[1]: 进度填充线 (固定保留在数组中)
    { dl: [0, CONFIG.screenHeight - 1, 0, CONFIG.screenHeight - 1, CONFIG.colors.progressBarFill] }
  ]
};

if (CONFIG.displayPreset === 'COMPACT_TAG') {
  STATIC_PAYLOAD.text = [
    {
      content: 'net music',
      fontHeight: 5,
      x: 2,
      y: 1,
      color: CONFIG.colors.compactTagHeader,
      rect: [0, 0, CONFIG.screenWidth, CONFIG.screenHeight],
      charSpacing: 1
    },
    {
      content: '00:00/00:00',
      fontHeight: 5,
      x: 2,
      y: 8,
      color: CONFIG.colors.compactTimeText,
      rect: [0, 0, CONFIG.screenWidth, CONFIG.screenHeight],
      charSpacing: 1
    }
  ];
} else {
  STATIC_PAYLOAD.text = [
    {
      content: '00:00',
      fontHeight: 10,
      x: 2,
      y: 2,
      color: CONFIG.colors.largeCurrentTime,
      rect: [0, 0, CONFIG.screenWidth, CONFIG.screenHeight],
      charSpacing: 1
    },
    {
      content: '/00:00',
      fontHeight: 5,
      x: 30,
      y: 7,
      color: CONFIG.colors.smallTotalTime,
      rect: [0, 0, CONFIG.screenWidth, CONFIG.screenHeight],
      charSpacing: 1
    }
  ];
}

// 预先编译的 CDP 查询指令
const CDP_EVAL_EXPRESSION = `
  (() => {
    const input = document.querySelector('div[aria-label="播放进度调节"] input[type="range"]');
    return input ? { current: parseFloat(input.value) || 0, total: parseFloat(input.max) || 0 } : null;
  })()
`;

// ==========================================
// 状态与定时器句柄
// ==========================================
let mqttConnected = false;
let anchorCurrent = 0;
let anchorTotal = 0;
let anchorTimestamp = 0;
let isPlaying = false;
let lastPublishedSecond = -1;
let cdpPollTimer = null;
let smoothClockTimer = null;
let reconnectTimer = null;

// 初始化 MQTT
const mqttClient = mqtt.connect(CONFIG.mqttBroker, {
  connectTimeout: 5000,
  reconnectPeriod: 5000
});

mqttClient.on('connect', () => {
  mqttConnected = true;
  console.log('[MQTT] 成功连接至 Broker:', CONFIG.mqttBroker);
});

mqttClient.on('error', (err) => {
  console.warn('[MQTT 异常]', err.message);
});

function formatSec(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

// 启动平滑时钟引擎
function startSmoothClock() {
  if (smoothClockTimer) clearInterval(smoothClockTimer);

  smoothClockTimer = setInterval(() => {
    if (!isPlaying || anchorTotal <= 0 || anchorTimestamp === 0) return;

    const elapsed = (Date.now() - anchorTimestamp) / 1000;
    const estimatedCurrent = Math.min(anchorCurrent + elapsed, anchorTotal);
    const currentSecFloor = Math.floor(estimatedCurrent);

    if (currentSecFloor !== lastPublishedSecond) {
      lastPublishedSecond = currentSecFloor;

      const currentStr = formatSec(currentSecFloor);
      const totalStr = formatSec(anchorTotal);

      // 计算进度条宽度 (0 ~ screenWidth-1)
      const progressRatio = Math.min(Math.max(currentSecFloor / anchorTotal, 0), 1);
      const progressWidth = Math.round(progressRatio * (CONFIG.screenWidth - 1));

      // 原地修改文本内容
      if (CONFIG.displayPreset === 'COMPACT_TAG') {
        STATIC_PAYLOAD.text[1].content = `${currentStr}/${totalStr}`;
      } else {
        STATIC_PAYLOAD.text[0].content = currentStr;
        STATIC_PAYLOAD.text[1].content = `/${totalStr}`;
      }

      // 直接安全修改进度填充线终点坐标，不增删数组元素
      STATIC_PAYLOAD.draw[1].dl[2] = progressWidth;

      const payloadStr = JSON.stringify(STATIC_PAYLOAD);

      if (mqttConnected) {
        mqttClient.publish(CONFIG.mqttTopic, payloadStr);
      }
    }
  }, 200);
}

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
          resolve(target.webSocketDebuggerUrl.replace('ws://localhost:', 'ws://127.0.0.1:'));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`连接 CDP 端口 ${port} 超时`));
    });
    req.on('error', (err) => reject(err));
  });
}

async function startMonitoring() {
  if (cdpPollTimer) {
    clearInterval(cdpPollTimer);
    cdpPollTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    const wsUrl = await getDebugTarget(CONFIG.cdpPort);
    const ws = new WebSocket(wsUrl, {
      headers: { Host: `127.0.0.1:${CONFIG.cdpPort}` },
      handshakeTimeout: 5000
    });

    let msgId = 1;
    let lastRawCurrent = -1;
    let rawUnchangedCount = 0;

    ws.on('open', () => {
      console.log('[CDP] 连接建立，开启状态校准...');

      // 重置鼠标光标模拟
      ws.send(JSON.stringify({ id: 99991, method: 'Emulation.setTouchEmulationEnabled', params: { enabled: false } }));
      ws.send(JSON.stringify({ id: 99992, method: 'Emulation.setEmitTouchEventsForMouse', params: { enabled: false, configuration: 'desktop' } }));

      // 开启 CDP 轮询
      cdpPollTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (++msgId > 10000) msgId = 1;

        ws.send(JSON.stringify({
          id: msgId,
          method: 'Runtime.evaluate',
          params: { expression: CDP_EVAL_EXPRESSION, returnByValue: true }
        }));
      }, 250);
    });

    ws.on('message', (message) => {
      try {
        const res = JSON.parse(message.toString());
        const data = res?.result?.result?.value;

        if (data && data.total > 0) {
          const rawCurrent = data.current;
          anchorTotal = data.total;

          if (rawCurrent === lastRawCurrent) {
            rawUnchangedCount++;
            if (rawUnchangedCount > 10) {
              isPlaying = false;
            }
          } else {
            rawUnchangedCount = 0;
            isPlaying = true;
            lastRawCurrent = rawCurrent;

            const currentPredicted = anchorCurrent + (Date.now() - anchorTimestamp) / 1000;
            if (Math.abs(rawCurrent - currentPredicted) > 1.5 || anchorTimestamp === 0) {
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
      console.log(`[WS 断开] 状态码: ${code}，3 秒后重试...`);
      isPlaying = false;
      if (cdpPollTimer) {
        clearInterval(cdpPollTimer);
        cdpPollTimer = null;
      }
      reconnectTimer = setTimeout(startMonitoring, 3000);
    });

  } catch (err) {
    console.error('[初始化失败]', err.message, '，3 秒后重试...');
    reconnectTimer = setTimeout(startMonitoring, 3000);
  }
}

// 启动主引擎与监控
startSmoothClock();
startMonitoring();