/**
 * U-Clock TC002 虚拟仿真与配置校验逻辑
 */

let currentConfig = null;
const canvas = document.getElementById('matrixCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

const COLS = 52;
const ROWS = 16;
const PIXEL_SIZE = 10;
const GAP = 2;

let isNeteaseOnline = false;
let isPlayingState = true;
let currentSec = 75;
let totalSec = 240;

let toastTimer = null;

// 初始化应用切屏调度器（防御性挂载）
let appSwitcher = null;
if (typeof AppSwitcher !== 'undefined') {
  appSwitcher = new AppSwitcher({
    appName: 'netease',
    pauseTimeoutMs: 3 * 60 * 1000
  });
}
window.appSwitcher = appSwitcher;

function showToast(message = '配置已同步！') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = message;
  toast.classList.add('show');

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, 2000);
}

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

function drawUlanziFilledCircle(x0, y0, r, color) {
  for (let y = y0 - r; y <= y0 + r; y++) {
    drawLedPixel(x0, y, color);
  }

  let f = 1 - r;
  let ddF_x = 1;
  let ddF_y = -2 * r;
  let x = 0;
  let y = r;

  while (x < y) {
    if (f >= 0) {
      y--;
      ddF_y += 2;
      f += ddF_y;
    }
    x++;
    ddF_x += 2;
    f += ddF_x;

    for (let cy = y0 - y; cy <= y0 + y; cy++) {
      drawLedPixel(x0 + x, cy, color);
      drawLedPixel(x0 - x, cy, color);
    }
    for (let cy = y0 - x; cy <= y0 + x; cy++) {
      drawLedPixel(x0 + y, cy, color);
      drawLedPixel(x0 - y, cy, color);
    }
  }
}

function drawLedPixel(x, y, hexColor) {
  if (!ctx || x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  const px = x * (PIXEL_SIZE + GAP);
  const py = y * (PIXEL_SIZE + GAP);

  ctx.fillStyle = hexColor || '#000000';
  ctx.fillRect(px, py, PIXEL_SIZE, PIXEL_SIZE);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fillRect(px, py, PIXEL_SIZE, 2);
}

function drawText(text, startX, startY, color, fontHeight = 5, spacing = 1) {
  const fontDict = fontHeight === 10 ? (typeof FONT_10 !== 'undefined' ? FONT_10 : {}) : (typeof FONT_5 !== 'undefined' ? FONT_5 : {});
  let cursorX = startX;

  for (const char of text) {
    const glyph = fontDict[char];
    if (!glyph) {
      cursorX += 3;
      continue;
    }

    const { w, h, data } = glyph;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (data[row * w + col] === 1) {
          drawLedPixel(cursorX + col, startY + row, color);
        }
      }
    }
    cursorX += w + spacing;
  }
}

function drawStatusIcon(x0, y0, playing, colors) {
  if (playing) {
    const c = colors.statusPlayIcon || '#FF4048';
    for (let y = y0; y <= y0 + 4; y++) drawLedPixel(x0, y, c);
    for (let y = y0 + 1; y <= y0 + 3; y++) drawLedPixel(x0 + 1, y, c);
    drawLedPixel(x0 + 2, y0 + 2, c);
  } else {
    const c = colors.statusPauseIcon || '#FFCC00';
    for (let y = y0; y <= y0 + 4; y++) drawLedPixel(x0, y, c);
    for (let y = y0 + 4; y >= y0; y--) drawLedPixel(x0 + 2, y, c);
  }
}

function getActiveColors() {
  if (!currentConfig) return {};
  const common = (currentConfig.colors && currentConfig.colors.common) || {};
  const currentPreset = currentConfig.display?.preset || 'RETRO_BADGE';
  const presets = (currentConfig.colors && currentConfig.colors.presets && currentConfig.colors.presets[currentPreset]) || {};
  return { ...common, ...presets };
}

function renderMatrix() {
  if (!ctx || !currentConfig) return;

  ctx.fillStyle = '#060608';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const px = c * (PIXEL_SIZE + GAP);
      const py = r * (PIXEL_SIZE + GAP);
      ctx.fillStyle = '#101116';
      ctx.fillRect(px, py, PIXEL_SIZE, PIXEL_SIZE);
    }
  }

  const colors = getActiveColors();
  const display = currentConfig.display || { preset: 'RETRO_BADGE' };
  const currentStr = formatTime(currentSec);
  const totalStr = formatTime(totalSec);

  // 进度条底槽与高亮
  for (let c = 0; c < COLS; c++) {
    drawLedPixel(c, 15, colors.progressBarTrack || '#222222');
  }
  const fillWidth = totalSec > 0 ? Math.round((currentSec / totalSec) * (COLS - 1)) : 0;
  for (let c = 0; c <= fillWidth; c++) {
    drawLedPixel(c, 15, colors.progressBarFill || '#00FFFF');
  }

  // 播放状态小图标
  drawStatusIcon(48, 1, isPlayingState, colors);

  switch (display.preset) {
    case 'RETRO_BADGE': {
      drawUlanziFilledCircle(6, 7, 5, colors.vinylBody || '#2A2A2A');

      const period = 20;
      const baseAngle = ((currentSec % period) / period) * 2 * Math.PI;
      const offsetAngle = Math.PI / 8;
      const colorMain = colors.vinylHighlightMain || '#FFD700';
      const colorFade = colors.vinylHighlightFade || '#554822';

      [0, Math.PI].forEach(oppo => {
        const a = baseAngle + oppo;
        const xPre = Math.round(6 + 3.0 * Math.sin(a - offsetAngle));
        const yPre = Math.round(7 - 3.0 * Math.cos(a - offsetAngle));
        const xNext = Math.round(6 + 3.0 * Math.sin(a + offsetAngle));
        const yNext = Math.round(7 - 3.0 * Math.cos(a + offsetAngle));
        drawLedPixel(xPre, yPre, colorFade);
        drawLedPixel(xNext, yNext, colorFade);

        const xMain = Math.round(6 + 3.0 * Math.sin(a));
        const yMain = Math.round(7 - 3.0 * Math.cos(a));
        drawLedPixel(xMain, yMain, colorMain);
      });

      drawUlanziFilledCircle(6, 7, 2, colors.vinylCenter || '#F20D24');
      drawLedPixel(6, 7, isPlayingState ? (colors.vinylSpindle || '#FFFFFF') : (colors.vinylBody || '#2A2A2A'));

      if (isPlayingState) {
        drawLedPixel(12, 1, colors.tonearmBase || '#888888');
        drawLedPixel(11, 2, colors.tonearmPlay || '#00FFCC');
        drawLedPixel(10, 3, colors.tonearmPlay || '#00FFCC');
        drawLedPixel(9, 4, colors.vinylSpindle || '#FFFFFF');
      } else {
        for (let y = 1; y <= 4; y++) drawLedPixel(12, y, colors.tonearmPause || '#666666');
        drawLedPixel(12, 4, colors.tonearmBase || '#888888');
        drawLedPixel(12, 1, colors.tonearmBase || '#888888');
      }

      drawText(currentStr, 16, 1, colors.currentTime || '#00FFCC', 5, 1);
      drawText(`/${totalStr}`, 24, 8, colors.totalTime || '#888888', 5, 1);
      break;
    }

    case 'COMPACT_TAG': {
      drawText('Net Music', 1, 1, colors.tagHeader || '#F20D24', 5, 1);
      drawText(currentStr, 1, 8, colors.currentTime || '#00FFCC', 5, 1);
      drawText(`/${totalStr}`, 19, 8, colors.totalTime || '#888888', 5, 1);
      break;
    }

    case 'LARGE_CURRENT': {
      drawText(currentStr, 1, 3, colors.currentTime || '#00FFCC', 10, 1);
      drawText(`/${totalStr}`, 28, 8, colors.totalTime || '#888888', 5, 1);
      break;
    }
  }
}

function renderColorControllers() {
  const commonContainer = document.getElementById('commonColorControls');
  const presetContainer = document.getElementById('presetColorControls');
  const presetTitle = document.getElementById('presetColorTitle');

  if (!commonContainer || !presetContainer) return;

  commonContainer.innerHTML = '';
  presetContainer.innerHTML = '';

  const commonMap = {
    progressBarTrack: '进度条底槽',
    progressBarFill: '进度条高亮',
    currentTime: '当前播放时间',
    totalTime: '歌曲总时长',
    statusPlayIcon: '播放状态图标',
    statusPauseIcon: '暂停状态图标'
  };

  const presetExclusiveMap = {
    RETRO_BADGE: {
      title: '唱片模式专属配色',
      items: {
        vinylBody: '黑胶底盘',
        vinylCenter: '内芯标签',
        vinylSpindle: '唱片中心轴',
        vinylHighlightMain: '旋转主高光',
        vinylHighlightFade: '旋转羽化光',
        tonearmBase: '唱臂旋转底座',
        tonearmPlay: '唱臂 (播放态)',
        tonearmPause: '唱臂 (暂停态)'
      }
    },
    COMPACT_TAG: {
      title: '紧凑模式专属配色',
      items: {
        tagHeader: 'Net Music 标题'
      }
    },
    LARGE_CURRENT: {
      title: '大字模式专属配色',
      items: {}
    }
  };

  if (!currentConfig.colors) currentConfig.colors = {};
  if (!currentConfig.colors.common) currentConfig.colors.common = {};
  if (!currentConfig.colors.presets) currentConfig.colors.presets = {};

  Object.entries(commonMap).forEach(([key, label]) => {
    const val = currentConfig.colors.common[key] || '#ffffff';
    commonContainer.appendChild(createColorControlItem(label, val, (newVal) => {
      currentConfig.colors.common[key] = newVal;
      renderMatrix();
    }));
  });

  const currentPreset = currentConfig.display?.preset || 'RETRO_BADGE';
  const currentPresetInfo = presetExclusiveMap[currentPreset] || { title: '模式专属配色', items: {} };
  if (presetTitle) {
    presetTitle.innerHTML = `<img src="icons/palette.svg" class="icon-title" alt="">${currentPresetInfo.title}`;
  }

  if (!currentConfig.colors.presets[currentPreset]) currentConfig.colors.presets[currentPreset] = {};

  const exclusiveKeys = Object.entries(currentPresetInfo.items);
  if (exclusiveKeys.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.style.fontSize = '12px';
    emptyNotice.style.color = 'var(--text-muted)';
    emptyNotice.innerText = '该模式暂无专属配色项，全部继承通用色彩。';
    presetContainer.appendChild(emptyNotice);
  } else {
    exclusiveKeys.forEach(([key, label]) => {
      const val = currentConfig.colors.presets[currentPreset][key] || '#ffffff';
      presetContainer.appendChild(createColorControlItem(label, val, (newVal) => {
        currentConfig.colors.presets[currentPreset][key] = newVal;
        renderMatrix();
      }));
    });
  }
}

function createColorControlItem(label, currentValue, onChange) {
  const div = document.createElement('div');
  div.className = 'color-item';
  div.innerHTML = `
    <div class="color-item-info">
      <span>${label}</span>
      <span class="color-warn-tip"></span>
    </div>
    <input type="color" value="${currentValue}">
  `;

  // 初始渲染时执行一次亮度风险检测
  if (window.ColorChecker) {
    window.ColorChecker.updateColorItemStatus(div, currentValue);
  }

  // 监听原生调色板选择
  div.querySelector('input').addEventListener('input', (e) => {
    const val = e.target.value;
    onChange(val);
    if (window.ColorChecker) {
      window.ColorChecker.updateColorItemStatus(div, val);
    }
  });

  return div;
}

// 表单整体校验
const validateInputs = () => {
  let isValid = true;

  document.querySelectorAll('.field-error').forEach(el => el.classList.remove('show'));
  document.querySelectorAll('input').forEach(el => el.classList.remove('invalid'));

  const setError = (id, msg) => {
    const errEl = document.getElementById(`err-${id}`);
    const inputEl = document.getElementById(id);
    if (errEl) {
      errEl.innerText = msg;
      errEl.classList.add('show');
    }
    if (inputEl) inputEl.classList.add('invalid');
    isValid = false;
  };

  const webPort = parseInt(document.getElementById('webPort').value, 10);
  if (isNaN(webPort) || webPort < 1024 || webPort > 65535) {
    setError('webPort', '端口必须在 1024 - 65535 之间');
  }

  const cdpPort = parseInt(document.getElementById('cdpPort').value, 10);
  if (isNaN(cdpPort) || cdpPort < 1024 || cdpPort > 65535) {
    setError('cdpPort', '端口必须在 1024 - 65535 之间');
  }

  const broker = document.getElementById('mqttBroker').value.trim();
  const brokerRegex = /^(mqtt|mqtts|ws|wss):\/\/.+/i;
  if (broker && !brokerRegex.test(broker)) {
    setError('mqttBroker', '地址格式错误，应以 mqtt:// 或 ws:// 开头');
  }

  const deviceIpInput = document.getElementById('deviceIp');
  if (deviceIpInput) {
    const ipVal = deviceIpInput.value.trim();
    const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})$/;
    if (ipVal !== '' && !ipv4Regex.test(ipVal)) {
      setError('deviceIp', 'IP 地址格式不正确 (例: 192.168.3.45)');
    }
  }

  const topicVal = document.getElementById('mqttTopic').value.trim();
  if (topicVal !== '' && !topicVal.includes('/')) {
    setError('mqttTopic', 'Topic 格式通常包含斜杠');
  }

  return isValid;
};

// 单字段实时输入校验
const validateField = (id, value) => {
  const errEl = document.getElementById(`err-${id}`);
  const inputEl = document.getElementById(id);
  if (!errEl || !inputEl) return true;

  let errorMsg = '';

  switch (id) {
    case 'webPort':
    case 'cdpPort': {
      const port = parseInt(value, 10);
      if (value !== '' && (isNaN(port) || port < 1024 || port > 65535)) {
        errorMsg = '端口必须在 1024 - 65535 之间';
      }
      break;
    }
    case 'mqttBroker': {
      const brokerRegex = /^(mqtt|mqtts|ws|wss):\/\/.+/i;
      if (value !== '' && !brokerRegex.test(value.trim())) {
        errorMsg = '地址格式错误，应以 mqtt:// 或 ws:// 开头';
      }
      break;
    }
    case 'deviceIp': {
      const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})$/;
      if (value.trim() !== '' && !ipv4Regex.test(value.trim())) {
        errorMsg = 'IP 地址格式不正确 (例: 192.168.3.45)';
      }
      break;
    }
    case 'mqttTopic': {
      if (value.trim() !== '' && !value.includes('/')) {
        errorMsg = 'Topic 格式通常包含斜杠，如 ulanzi_xxx/custom/netease';
      }
      break;
    }
  }

  if (errorMsg) {
    errEl.innerText = errorMsg;
    errEl.classList.add('show');
    inputEl.classList.add('invalid');
    return false;
  } else {
    errEl.classList.remove('show');
    inputEl.classList.remove('invalid');
    return true;
  }
};

// 为所有表单控件自动绑定 input 实时校验事件
['webPort', 'cdpPort', 'mqttBroker', 'mqttTopic', 'deviceIp'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', (e) => {
      validateField(id, e.target.value);
    });
  }
});

// 拦截网易云同步时点击禁用开关的提示逻辑
const switchWrapper = document.getElementById('switchTipWrapper');
const toggle = document.getElementById('playStateToggle');

if (switchWrapper && toggle) {
  switchWrapper.addEventListener('click', () => {
    if (toggle.disabled) {
      showToast('当前网易云已同步，开关由客户端接管');
    }
  });
}

function setupUI(cfg) {
  if (!cfg.network) cfg.network = {};
  if (!cfg.display) cfg.display = { preset: 'RETRO_BADGE' };

  // 1. 同步预设单选框
  const radioInputs = document.querySelectorAll('input[name="displayPreset"]');
  radioInputs.forEach(radio => {
    radio.checked = (radio.value === cfg.display.preset);
    radio.addEventListener('change', (e) => {
      currentConfig.display.preset = e.target.value;
      renderColorControllers();
      renderMatrix();
    });
  });

  // 2. 播放状态 Toggle (支持离线手动切换)
  const toggleEl = document.getElementById('playStateToggle');
  const toggleLabel = document.getElementById('playStateLabel');
  if (toggleEl) {
    toggleEl.checked = isPlayingState;
    toggleEl.addEventListener('change', (e) => {
      if (!isNeteaseOnline) {
        isPlayingState = e.target.checked;
        if (toggleLabel) {
          toggleLabel.innerText = isPlayingState ? '播放状态' : '暂停状态';
        }
        renderMatrix();
      }
    });
  }

  // 3. 通信表单赋值安全兜底
  const setInputValue = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val !== undefined ? val : '';
  };
  setInputValue('webPort', cfg.network.webPort || 25688);
  setInputValue('cdpPort', cfg.network.cdpPort || 9222);
  setInputValue('mqttBroker', cfg.network.mqttBroker || '');
  setInputValue('mqttTopic', cfg.network.mqttTopic || '');
  setInputValue('deviceIp', cfg.network.deviceIP || '');

  // 4. 挂载失焦实时校验
  ['webPort', 'cdpPort', 'mqttBroker', 'mqttTopic', 'deviceIp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('blur', validateInputs);
  });

  // 5. 首次加载时立刻执行一次渲染
  renderColorControllers();
  renderMatrix();
}

function startLiveSync() {
  const statusBadge = document.getElementById('serviceStatus');
  const toggleEl = document.getElementById('playStateToggle');
  const toggleLabel = document.getElementById('playStateLabel');
  const switchWrapperEl = document.getElementById('switchTipWrapper');



  setInterval(() => {
    if (!isNeteaseOnline && isPlayingState) {
      currentSec = (currentSec + 1) % totalSec;
    }
    renderMatrix();
  }, 1000);

  setInterval(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const status = await res.json();

      if (window.appSwitcher) {
        const devIpInput = document.getElementById('deviceIp');
        if (devIpInput && devIpInput.value.trim()) {
          window.appSwitcher.setDeviceIp(devIpInput.value.trim());
        }
        window.appSwitcher.handleTick(status);
      }

      if (status.isRunning && status.totalSec > 0) {
        isNeteaseOnline = true;
        isPlayingState = status.isPlaying;
        currentSec = status.currentSec;
        totalSec = status.totalSec;

        if (statusBadge) {
          statusBadge.innerText = '网易云已同步';
          statusBadge.style.background = '#102d24';
          statusBadge.style.color = '#34d399';
        }

        if (toggleEl) {
          toggleEl.checked = isPlayingState;
          toggleEl.disabled = true;
        }
        if (switchWrapperEl) {
          switchWrapperEl.classList.add('tooltip-trigger');
          switchWrapperEl.setAttribute('data-tip', '当前网易云已同步，开关由客户端接管');
          switchWrapperEl.style.cursor = 'not-allowed';
        }
        if (toggleLabel) toggleLabel.innerText = isPlayingState ? '播放中 (网易云)' : '已暂停 (网易云)';
      } else {
        isNeteaseOnline = false;
        if (statusBadge) {
          statusBadge.innerText = '模拟运行中';
          statusBadge.style.background = '#2a2618';
          statusBadge.style.color = '#fbbf24';
        }

        if (toggleEl) {
          toggleEl.disabled = false;
        }
        if (switchWrapperEl) {
          switchWrapperEl.classList.remove('tooltip-trigger');
          switchWrapperEl.removeAttribute('data-tip');
          switchWrapperEl.style.cursor = 'pointer';
        }
        if (toggleLabel) {
          toggleLabel.innerText = isPlayingState ? '播放状态' : '暂停状态';
        }
      }
    } catch (e) {
      isNeteaseOnline = false;
      if (toggleEl) {
        toggleEl.disabled = false;
      }
      if (switchWrapperEl) {
        switchWrapperEl.classList.remove('tooltip-trigger');
        switchWrapperEl.removeAttribute('data-tip');
        switchWrapperEl.style.cursor = 'pointer';
      }
    }
  }, 500);
}

async function saveCurrentConfig(isAuto = false) {
  if (!validateInputs()) {
    return false;
  }

  if (!currentConfig) {
    try {
      const fetchCfg = await fetch('/api/config');
      if (fetchCfg.ok) currentConfig = await fetchCfg.json();
    } catch (e) { }
  }

  if (!currentConfig) return false;
  if (!currentConfig.network) currentConfig.network = {};

  currentConfig.network.webPort = parseInt(document.getElementById('webPort').value, 10);
  currentConfig.network.cdpPort = parseInt(document.getElementById('cdpPort').value, 10);
  currentConfig.network.mqttBroker = document.getElementById('mqttBroker').value.trim();
  currentConfig.network.mqttTopic = document.getElementById('mqttTopic').value.trim();

  const deviceIpInput = document.getElementById('deviceIp');
  if (deviceIpInput) {
    currentConfig.network.deviceIP = deviceIpInput.value.trim();
  }

  // 调用独立模块检测并标黄异常颜色
  let riskCount = 0;
  if (window.ColorChecker) {
    riskCount = window.ColorChecker.checkAndHighlightColors();
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentConfig)
    });

    if (res.ok) {
      if (riskCount > 0) {
        showToast(`配置已保存！发现 ${riskCount} 处颜色低亮度易失真，已标黄`);
      } else {
        showToast(isAuto ? '设备与通信配置已自动保存！' : '配置已同步！');
      }
      return true;
    } else {
      if (!isAuto) showToast('保存失败，请检查网络！');
    }
  } catch (err) {
    if (!isAuto) showToast('服务端无响应！');
  }
  return false;
}

// 暴露全局保存函数供外部模块调用
window.saveCurrentConfig = saveCurrentConfig;

let autoSaveTimer = null;
function triggerAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveCurrentConfig(true);
  }, 800);
}

// 为“设备与通信配置”卡片内的输入框挂载自动保存监听
const commFields = ['deviceIp', 'webPort', 'cdpPort', 'mqttBroker', 'mqttTopic'];
commFields.forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', () => {
      triggerAutoSave();
    });
    el.addEventListener('change', () => {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      saveCurrentConfig(true);
    });
  }
});

const saveBtn = document.getElementById('saveBtn');
if (saveBtn) {
  saveBtn.addEventListener('click', () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    saveCurrentConfig(false);
  });
}

async function init() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('网络请求异常');
    currentConfig = await res.json();
    setupUI(currentConfig);
    startLiveSync();
  } catch (err) {
    console.error('加载配置失败:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}