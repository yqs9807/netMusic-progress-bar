// ==========================================
// 色彩亮度兼容性与低占空比失真检测模块
// ==========================================

const ColorChecker = {
  /**
   * 评估单色在 TC002 硬件下的最低可用安全亮度
   * 包含通道截断归零与 ESP32 LEDC PWM 超低占空比突变评估
   */
  evaluateColorBrightness(hex) {
    if (!hex || typeof hex !== 'string') {
      return { isRisky: false, minBrightness: 5, reason: '' };
    }

    const cleanHex = hex.replace('#', '');
    const num = parseInt(cleanHex, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const maxC = Math.max(r, g, b);

    if (maxC === 0) {
      return { isRisky: false, minBrightness: 5, reason: '' };
    }

    // 1. 熄灭阈值：主通道不灭所需的最少亮度 (值 * 亮度 / 100 >= 1)
    const extinctMin = Math.ceil(100 / maxC);

    // 2. 弱通道截断判定：次通道归零会导致严重色相偏移（如 #f20d24 绿通道归零导致紫化）
    const activeChannels = [r, g, b].filter(c => c > 0);
    const minC = Math.min(...activeChannels);
    const distortionMin = Math.ceil(100 / minC);

    const hasVulnerableChannel = activeChannels.length > 1 && minC < 25;

    let minSafeBrightness = Math.max(5, distortionMin);

    // 规避小于等于 7% 时由于硬件 PWM 最小导通时间非线性引发的过冲跳亮
    if (hasVulnerableChannel && minSafeBrightness < 10) {
      minSafeBrightness = Math.max(minSafeBrightness, 10);
    }

    const isRisky = extinctMin > 5 || (hasVulnerableChannel && distortionMin > 5);

    return {
      isRisky,
      minBrightness: Math.min(100, minSafeBrightness),
      reason: extinctMin > 5 ? '极低亮度下将完全熄灭' : '低亮度下弱通道被截断导致偏色/变紫'
    };
  },

  /**
   * 更新单个 .color-item 容器的标黄状态与提示文字
   */
  updateColorItemStatus(itemEl, hexValue) {
    if (!itemEl) return;
    const tipEl = itemEl.querySelector('.color-warn-tip');
    const result = this.evaluateColorBrightness(hexValue);

    if (result.isRisky) {
      itemEl.classList.add('warn-risk');
      if (tipEl) {
        tipEl.innerText = `建议最低亮度 ≥ ${result.minBrightness}%`;
      }
    } else {
      itemEl.classList.remove('warn-risk');
      if (tipEl) {
        tipEl.innerText = '';
      }
    }
  },

  /**
   * 遍历页面所有颜色选择器，执行全局标黄排查
   * @returns {number} 风险项总数
   */
  checkAndHighlightColors() {
    const colorItems = document.querySelectorAll('.color-item');
    let riskCount = 0;

    colorItems.forEach(item => {
      const input = item.querySelector('input[type="color"]');
      if (!input) return;

      const result = this.evaluateColorBrightness(input.value);
      this.updateColorItemStatus(item, input.value);
      if (result.isRisky) {
        riskCount++;
      }
    });

    return riskCount;
  }
};

window.ColorChecker = ColorChecker;