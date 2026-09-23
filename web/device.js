// ==========================================
// Ulanzi TC002 硬件直连通信模块
// ==========================================

const deviceIpInput = document.getElementById('deviceIp');
const connectDeviceBtn = document.getElementById('connectDeviceBtn');
const deviceControlPanel = document.getElementById('deviceControlPanel');
const devMac = document.getElementById('devMac');
const devMqttStatus = document.getElementById('devMqttStatus');
const devBrightness = document.getElementById('devBrightness');
const devBrightnessValStr = document.getElementById('devBrightnessValStr');
const pushMqttToDeviceBtn = document.getElementById('pushMqttToDeviceBtn');
const genTopicBtn = document.getElementById('genTopicBtn');

async function deviceRequest(ip, path, method = 'GET', payload = null) {
  const url = `http://${ip}${path}`;
  const response = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, method, payload })
  });
  if (!response.ok) throw new Error('代理请求失败');
  return response.json();
}

// 核心执行连接与获取属性的逻辑
async function triggerDeviceConnect(ip, force = false) {
  if (!ip) return;

  // IPv4 正则校验
  const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})\.(25[0-5]|2[0-4]\d|1\d{2}|\d{1,2})$/;
  if (!ipv4Regex.test(ip)) {
    return;
  }

  if (!force && connectDeviceBtn && connectDeviceBtn.disabled) return;

  if (connectDeviceBtn) {
    connectDeviceBtn.innerText = '连接中...';
    connectDeviceBtn.style.opacity = '0.6';
    connectDeviceBtn.style.cursor = 'not-allowed';
  }

  try {
    const baseInfo = await deviceRequest(ip, '/getBase');
    if (baseInfo && baseInfo.mac) {
      const rawMac = baseInfo.mac.replace(/[:\s]/g, '').toUpperCase();
      const formattedMac = rawMac.match(/.{1,2}/g).join(':');

      if (window.appSwitcher) {
        window.appSwitcher.setDeviceIp(ip);
        window.appSwitcher.switchToNeteaseApp();
      }

      devMac.innerText = formattedMac;
      deviceControlPanel.style.display = 'block';

      // 连接成功后，禁用按钮，直到用户再次修改 IP
      if (connectDeviceBtn) {
        connectDeviceBtn.disabled = true;
        connectDeviceBtn.innerText = '已连接';
        connectDeviceBtn.style.opacity = '0.5';
        connectDeviceBtn.style.cursor = 'not-allowed';
      }

      devMqttStatus.innerText = '已连接';
      devMqttStatus.style.background = '#102d24';
      devMqttStatus.style.color = '#34d399';
      devMqttStatus.style.borderColor = '#059669';

      const macLast4 = rawMac.slice(-4).toLowerCase();
      const topicInput = document.getElementById('mqttTopic');
      if (topicInput && (!topicInput.value || topicInput.value.trim() === '')) {
        topicInput.value = `ulanzi_${macLast4}/custom/netease`;
        // 自动填入 Topic 后触发自动保存
        if (typeof window.saveCurrentConfig === 'function') {
          window.saveCurrentConfig(true);
        }
      }

      try {
        const statusRes = await deviceRequest(ip, '/getMqttStatus');
        if (statusRes.data && statusRes.data.connected) {
          devMqttStatus.innerText = 'MQTT 已连接';
        } else {
          devMqttStatus.innerText = 'MQTT 未连接';
          devMqttStatus.style.background = '#331a1d';
          devMqttStatus.style.color = '#ff4757';
          devMqttStatus.style.borderColor = '#991b1b';
        }
      } catch (e) { }

    } else {
      throw new Error('设备返回数据异常');
    }
  } catch (err) {
    deviceControlPanel.style.display = 'none';
    devMqttStatus.innerText = '连接失败';
    devMqttStatus.style.background = '#331a1d';
    devMqttStatus.style.color = '#ff4757';
    devMqttStatus.style.borderColor = '#991b1b';

    if (connectDeviceBtn) {
      connectDeviceBtn.disabled = false;
      connectDeviceBtn.innerText = '连接设备';
      connectDeviceBtn.style.opacity = '1';
      connectDeviceBtn.style.cursor = 'pointer';
    }
  }
}

// 监听 IP 输入框的内容改变：只要用户修改了输入框，就立刻恢复“连接设备”按钮可用
if (deviceIpInput) {
  deviceIpInput.addEventListener('input', () => {
    if (connectDeviceBtn) {
      connectDeviceBtn.disabled = false;
      connectDeviceBtn.innerText = '连接设备';
      connectDeviceBtn.style.opacity = '1';
      connectDeviceBtn.style.cursor = 'pointer';
    }
  });
}

// 手动点击连接
if (connectDeviceBtn) {
  connectDeviceBtn.addEventListener('click', () => {
    const ip = deviceIpInput.value.trim();
    if (!ip) return showToast('请输入设备 IP');
    triggerDeviceConnect(ip);
  });
}

// 失焦自动连接
if (deviceIpInput) {
  deviceIpInput.addEventListener('blur', () => {
    const ip = deviceIpInput.value.trim();
    if (ip && deviceControlPanel.style.display === 'none' && (!connectDeviceBtn || !connectDeviceBtn.disabled)) {
      triggerDeviceConnect(ip);
    }
  });
}

// 页面加载自动静默连接
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const ip = deviceIpInput ? deviceIpInput.value.trim() : '';
    if (ip) {
      triggerDeviceConnect(ip);
    }
  }, 300);
});

// 一键填 Topic 按钮事件绑定
if (genTopicBtn) {
  genTopicBtn.addEventListener('click', () => {
    const macStr = devMac.innerText;
    if (macStr && macStr !== '--') {
      const macLast4 = macStr.replace(/[:]/g, '').slice(-4).toLowerCase();
      const topicInput = document.getElementById('mqttTopic');
      if (topicInput) {
        topicInput.value = `ulanzi_${macLast4}/custom/netease`;
        showToast(`已应用 Topic: ulanzi_${macLast4}/custom/netease`);
        // 自动保存生成的 Topic
        if (typeof window.saveCurrentConfig === 'function') {
          window.saveCurrentConfig(true);
        }
      }
    }
  });
}

if (devBrightness) {
  devBrightness.addEventListener('input', (e) => {
    if (devBrightnessValStr) devBrightnessValStr.innerText = `${e.target.value}%`;
  });

  devBrightness.addEventListener('change', async (e) => {
    const ip = deviceIpInput.value.trim();
    if (!ip) return showToast('请先填写并连接设备 IP');
    const val = parseInt(e.target.value, 10);

    const payload = {
      brightness: {
        level: "mid",
        mid: val
      }
    };

    try {
      const res = await deviceRequest(ip, '/setConfig', 'POST', payload);
      if (res.code === 200) {
        showToast(`设备亮度已同步设为 ${val}%`);
      }
    } catch (err) {
      showToast('亮度调节指令发送失败');
    }
  });
}

if (pushMqttToDeviceBtn) {
  pushMqttToDeviceBtn.addEventListener('click', async () => {
    const ip = deviceIpInput.value.trim();
    if (!ip) return showToast('请先填写设备 IP');

    const brokerUrl = document.getElementById('mqttBroker').value.trim();
    const topicVal = document.getElementById('mqttTopic').value.trim();
    if (!brokerUrl) return showToast('请先填写 MQTT Broker 地址');

    let mqttIp = "", mqttPort = "1883", mqttUser = "", mqttPwd = "";

    try {
      const urlObj = new URL(brokerUrl);
      mqttIp = urlObj.hostname;
      mqttPort = urlObj.port || "1883";
      mqttUser = decodeURIComponent(urlObj.username || "");
      mqttPwd = decodeURIComponent(urlObj.password || "");
    } catch (e) {
      return showToast('MQTT Broker 格式无法解析');
    }

    let prefix = "ulanzi";
    if (topicVal && topicVal.includes('/')) {
      const rootPart = topicVal.split('/')[0];
      prefix = rootPart.split('_')[0] || "ulanzi";
    }

    const payload = {
      isMqtt: true,
      ip: mqttIp,
      port: mqttPort,
      mqtt_name: mqttUser,
      mqtt_pwd: mqttPwd,
      mqtt_prefix: prefix,
      isHADiscoveryEnabled: false
    };

    try {
      const res = await deviceRequest(ip, '/setMqttConfig', 'POST', payload);
      if (res.code === 200) {
        showToast('MQTT 配置已成功下发至硬件设备！');
      } else {
        showToast('设备拒绝了该配置');
      }
    } catch (err) {
      showToast('MQTT 配置下发失败');
    }
  });
}

// 自动发现轮询逻辑（修正变量作用域与保存调用位置）
let detectRetryCount = 0;
const maxDetectRetries = 15;

async function autoDetectDevice() {
  try {
    const res = await fetch('/api/discoveredDevice');
    if (res.ok) {
      const device = await res.json();

      if (device && device.online && device.ip) {
        const ipInput = document.getElementById('deviceIp');

        if (ipInput && ipInput.value.trim() !== device.ip) {
          ipInput.value = device.ip;
          showToast(`局域网已自动发现设备: ${device.ip}`);
          triggerDeviceConnect(device.ip, true);

          // 自动将探测到的新 IP 保存到 config.json
          if (typeof window.saveCurrentConfig === 'function') {
            window.saveCurrentConfig(true);
          }
        } else if (ipInput && ipInput.value.trim() === device.ip && connectDeviceBtn && !connectDeviceBtn.disabled) {
          triggerDeviceConnect(device.ip, true);
        }
        return; // 成功识别后退出重试
      }
    }
  } catch (e) {
    // 忽略单次网络探测异常
  }

  detectRetryCount++;
  if (detectRetryCount < maxDetectRetries) {
    setTimeout(autoDetectDevice, 1000);
  }
}

// 页面加载完成后启动探测
window.addEventListener('DOMContentLoaded', () => {
  autoDetectDevice();
});