// ==========================================
// Ulanzi TC002 应用自动切换调度模块 (浏览器端)
// ==========================================

const TOOL_INDEX_MAP = {
  clock: 1,
  weather: 2,
  busy: 3,
  scoreboard: 4,
  tomato: 5,
  stopwatch: 6,
  battery: 7,
  soundlight: 8,
  ipshow: 9
};

class AppSwitcher {
  constructor(options = {}) {
    this.deviceIp = options.deviceIp || '';
    this.appName = options.appName || 'netease';
    this.pauseTimeoutMs = options.pauseTimeoutMs || 3 * 60 * 1000; // 默认暂停 3 分钟后切回

    this.currentScreen = null; // 'diy' | 'tools'
    this.pauseTimerStart = null;
    this.isSwitching = false;
  }

  setDeviceIp(ip) {
    this.deviceIp = ip;
  }

  // 通过后端代理向设备发送请求
  async proxyRequest(path, method = 'GET', payload = null) {
    if (!this.deviceIp) return null;
    const url = `http://${this.deviceIp}${path}`;
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, payload })
    });
    if (!res.ok) throw new Error(`代理请求失败: ${res.status}`);
    return res.json();
  }

  // 1. 切换至网易云 Custom App
  async switchToNeteaseApp() {
    if (!this.deviceIp || this.isSwitching) return;
    this.isSwitching = true;
    try {
      const res = await this.proxyRequest(`/api/switchDiyApp?name=${encodeURIComponent(this.appName)}`, 'POST');
      if (res && (res.code === 200 || !res.error)) {
        this.currentScreen = 'diy';
        this.pauseTimerStart = null;
        console.log(`[AppSwitcher] 已切换至 Custom App: ${this.appName}`);
      }
    } catch (err) {
      console.error('[AppSwitcher] 切换网易云 App 异常:', err.message);
    } finally {
      this.isSwitching = false;
    }
  }

  // 2. 校验原生工具状态并安全切回时钟或首个可用工具
  async switchToClockOrFallback() {
    if (!this.deviceIp || this.isSwitching) return;
    this.isSwitching = true;
    try {
      const configData = await this.proxyRequest('/getToolsConfig', 'GET');
      if (!configData || !configData.toolsInfos) {
        throw new Error('未获取到有效 tools 配置');
      }

      const toolsInfos = configData.toolsInfos;
      const toolsOrder = configData.toolsOrder || [1, 2, 3, 4, 5, 6, 7, 8, 9];

      let targetIndex = null;
      let targetName = '';

      // 优先判断时钟是否开启
      if (toolsInfos.clock && toolsInfos.clock.enable) {
        targetIndex = TOOL_INDEX_MAP.clock;
        targetName = 'clock';
      } else {
        // 时钟未开启，按 toolsOrder 寻找第一个启用的应用
        const indexToName = Object.entries(TOOL_INDEX_MAP).reduce((acc, [name, idx]) => {
          acc[idx] = name;
          return acc;
        }, {});

        for (const idx of toolsOrder) {
          const name = indexToName[idx];
          if (name && toolsInfos[name] && toolsInfos[name].enable) {
            targetIndex = idx;
            targetName = name;
            break;
          }
        }
      }

      if (!targetIndex) {
        console.warn('[AppSwitcher] 设备未启用任何原生工具应用，放弃回切');
        return;
      }

      const switchRes = await this.proxyRequest('/switchApp', 'POST', {
        type: 'tools',
        index: targetIndex
      });

      if (switchRes && (switchRes.code === 200 || !switchRes.error)) {
        this.currentScreen = 'tools';
        this.pauseTimerStart = null;
        console.log(`[AppSwitcher] 已切回原生工具: ${targetName} (Index: ${targetIndex})`);
      }
    } catch (err) {
      console.error('[AppSwitcher] 执行工具回切异常:', err.message);
    } finally {
      this.isSwitching = false;
    }
  }

  // 3. 轮询驱动器
  handleTick(status) {
    if (!this.deviceIp) return;

    const isRunning = status && status.isRunning;
    const isPlaying = isRunning && status.isPlaying;

    if (isPlaying) {
      this.pauseTimerStart = null;
      if (this.currentScreen !== 'diy') {
        this.switchToNeteaseApp();
      }
    } else {
      // 暂停或网易云未运行
      if (this.currentScreen === 'diy') {
        if (!this.pauseTimerStart) {
          this.pauseTimerStart = Date.now();
        } else if (Date.now() - this.pauseTimerStart >= this.pauseTimeoutMs) {
          console.log(`[AppSwitcher] 暂停已达超时阈值 (${this.pauseTimeoutMs / 1000}s)，执行回切`);
          this.switchToClockOrFallback();
        }
      }
    }
  }
}

window.AppSwitcher = AppSwitcher;