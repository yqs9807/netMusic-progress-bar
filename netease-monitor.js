/**
 * NetEase Cloud Music Now Playing Monitor for Ulanzi Pixel Screen
 * 
 * 架构原理:
 * 1. 利用 Chrome DevTools Protocol (CDP) 连接网易云音乐 Electron 渲染进程
 * 2. 读取进度条组件的秒数与总时长
 * 3. 采用 Dead Reckoning (本地时钟平滑预测) 消除 DOM 节流与网络抖动造成的跳秒
 * 4. 格式化为 Ulanzi 像素屏原生 JSON 协议并通过 MQTT 发送
 */

const http = require('http');
const WebSocket = require('ws');
const mqtt = require('mqtt');

// ==========================================
// 全局可配置项 (用户自定义区域)
// ==========================================
const CONFIG = {
  // 1. 网络与服务配置
  cdpPort: 9222,                                // 网易云音乐启动参数 --remote-debugging-port 端口
  mqttBroker: 'mqtt://192.168.3.100:1883',      // MQTT 服务器地址及端口
  mqttTopic: 'ulanzi_a728/custom/netease',      // MQTT 推送主题
  screenWidth: 52,                             // 屏幕点阵宽度 (默认 52)
  screenHeight: 16,                            // 屏幕点阵高度 (默认 16)

  // 2. 界面预设模式选择:
  //    - 'COMPACT_TAG': 全部为5号小字，左上角红色 "net music" 标头，中间为当前/总时长，底部进度条
  //    - 'LARGE_CURRENT': 当前时长为10号大字，总时长为5号小字，底部进度条
  displayPreset: 'LARGE_CURRENT',

  // 3. 全局配色方案
  colors: {
    // 进度条配色
    progressBarTrack: '#222222',   // 进度条底槽暗色
    progressBarFill: '#00FFFF',    // 进度条填充高亮色 (青色)

    // 预设模式一 (COMPACT_TAG) 专属颜色
    compactTagHeader: '#F20D24',   // 左上角 "net music" 标题颜色 (网易红)
    compactTimeText: '#00FFCC',    // 中间 "01:23/03:45" 时间文本颜色

    // 预设模式二 (LARGE_CURRENT) 专属颜色
    largeCurrentTime: '#F20D24',   // 10号大字当前时间颜色 (网易红)
    smallTotalTime: '#888888'      // 5号小字总时长颜色 (暗灰)
  }
};

// ==========================================
// 核心状态控制
// ==========================================
let mqttConnected = false;
let anchorCurrent = 0;       // 最近一次从客户端同步的秒数基准
let anchorTotal = 0;         // 歌曲总秒数
let anchorTimestamp = 0;     // 同步时的本地时间戳 (毫秒)
let isPlaying = false;       // 播放状态标记
let lastPublishedSecond = -1;// 缓存上次推送的整秒数，避免重复发包

// 初始化 MQTT 客户端
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

/**
 * 格式化秒数为 MM:SS
 * @param {number} sec - 秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatSec(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * 构建发送给 Ulanzi 像素屏的 Payload 数据
 * @param {number} currentSec - 当前播放秒数
 * @param {number} totalSec - 歌曲总秒数
 * @returns {object} 符合 Ulanzi 格式规范的 JSON 对象
 */
function buildUlanziPayload(currentSec, totalSec) {
  const currentStr = formatSec(currentSec);
  const totalStr = formatSec(totalSec);

  // 计算底部进度条点阵长度 (0 ~ screenWidth-1)
  const progressRatio = Math.min(Math.max(currentSec / totalSec, 0), 1);
  const progressWidth = Math.round(progressRatio * (CONFIG.screenWidth - 1));

  // 1. 构建绘制图元 (底部进度条槽与高亮填充)
  const drawElements = [
    { dl: [0, CONFIG.screenHeight - 1, CONFIG.screenWidth - 1, CONFIG.screenHeight - 1, CONFIG.colors.progressBarTrack] }
  ];

  if (progressWidth > 0) {
    drawElements.push({
      dl: [0, CONFIG.screenHeight - 1, progressWidth, CONFIG.screenHeight - 1, CONFIG.colors.progressBarFill]
    });
  }

  // 2. 根据选中的预设构建文字图层
  let textElements = [];

  if (CONFIG.displayPreset === 'COMPACT_TAG') {
    // 预设一：左上角红色标头 + 中间紧凑时间 + 底部进度条
    textElements = [
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
        content: `${currentStr}/${totalStr}`,
        fontHeight: 5,
        x: 5,
        y: 8,
        color: CONFIG.colors.compactTimeText,
        rect: [0, 0, CONFIG.screenWidth, CONFIG.screenHeight],
        charSpacing: 1
      }
    ];
  } else {
    // 预设二：当前时长10号大字 + 总时长5号小字 + 底部进度条
    textElements = [
      {
        content: currentStr,
        fontHeight: 10,
        x: 2,
        y: 2,
        color: CONFIG.colors.largeCurrentTime,
        rect: [0, 0, CONFIG.screenWidth, CONFIG.screenHeight],
        charSpacing: 1
      },
      {
        content: `/${totalStr}`,
        fontHeight: 5,
        x: 29,
        y: 7,
        color: CONFIG.colors.smallTotalTime,
        rect: [0, 0, CONFIG.screenWidth, CONFIG.screenHeight],
        charSpacing: 1
      }
    ];
  }

  return {
    text: textElements,
    draw: drawElements
  };
}

// ==========================================
// 本地平滑时钟引擎 (严格 200ms 刷新率保证平滑)
// ==========================================
setInterval(() => {
  if (!isPlaying || anchorTotal <= 0 || anchorTimestamp === 0) return;

  // 通过本地时钟流逝时间推算真实秒数
  const elapsed = (Date.now() - anchorTimestamp) / 1000;
  const estimatedCurrent = Math.min(anchorCurrent + elapsed, anchorTotal);
  const currentSecFloor = Math.floor(estimatedCurrent);

  // 整秒发生变化时触发一次 MQTT 推送
  if (currentSecFloor !== lastPublishedSecond) {
    lastPublishedSecond = currentSecFloor;

    const payloadObj = buildUlanziPayload(currentSecFloor, anchorTotal);
    const payloadStr = JSON.stringify(payloadObj);

    console.log(`[平滑时钟] 进度: ${formatSec(currentSecFloor)}/${formatSec(anchorTotal)} | 模式: ${CONFIG.displayPreset}`);

    if (mqttConnected) {
      mqttClient.publish(CONFIG.mqttTopic, payloadStr);
    }
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

          // 强制将 localhost 替换为 127.0.0.1 避免 IPv6 解析异常
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
 * 启动 CDP 监控与状态校准
 */
async function startMonitoring() {
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
      console.log('[CDP] 连接成功，正在重置鼠标指针模式并开启采样...');

      // 禁用 DevTools 触控仿真，恢复桌面原生鼠标指针
      ws.send(JSON.stringify({
        id: msgId++,
        method: 'Emulation.setTouchEmulationEnabled',
        params: { enabled: false }
      }));

      ws.send(JSON.stringify({
        id: msgId++,
        method: 'Emulation.setEmitTouchEventsForMouse',
        params: { enabled: false, configuration: 'desktop' }
      }));

      // 维持 250ms 轮询用于捕获播放状态与校准基准时间
      setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const expression = `
          (() => {
            const input = document.querySelector('div[aria-label="播放进度调节"] input[type="range"]');
            if (input) {
              return {
                current: parseFloat(input.value) || 0,
                total: parseFloat(input.max) || 0
              };
            }
            return null;
          })()
        `;

        ws.send(JSON.stringify({
          id: msgId++,
          method: 'Runtime.evaluate',
          params: {
            expression: expression,
            returnByValue: true
          }
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

          // 判定暂停：如果 DOM 值持续 2.5 秒未发生改变，视作已暂停播放
          if (rawCurrent === lastRawCurrent) {
            rawUnchangedCount++;
            if (rawUnchangedCount > 10) {
              isPlaying = false;
            }
          } else {
            rawUnchangedCount = 0;
            isPlaying = true;
            lastRawCurrent = rawCurrent;

            // 当偏差大于 1.5 秒（切歌或拖拽进度）时重置本地时间基准
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
      console.log(`[WS 断开] 状态码: ${code}，3 秒后自动重试...`);
      isPlaying = false;
      setTimeout(startMonitoring, 3000);
    });

  } catch (err) {
    console.error('[初始化失败]', err.message, '，3 秒后重试...');
    setTimeout(startMonitoring, 3000);
  }
}

// 启动主程序
startMonitoring();