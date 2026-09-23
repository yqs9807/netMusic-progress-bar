/**
 * Ulanzi 像素屏排版渲染引擎
 * 负责解析配置并生成兼容 Ulanzi 固件原生规范的点阵 JSON 数据
 */

/**
 * 将整秒数转换为 MM:SS 格式
 * @param {number} sec - 秒数
 * @returns {string} 格式化时间
 */
function formatSec(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * 绘制通用的 3x5 状态指示小图标 (▶ / ||)
 * @param {Array} drawList - 图元目标数组
 * @param {number} x0 - 起始 X 坐标
 * @param {number} y0 - 起始 Y 坐标
 * @param {boolean} isPlaying - 当前播放状态
 * @param {Object} colors - 全局颜色配置
 */
function appendStatusIcon(drawList, x0, y0, isPlaying, colors) {
  if (isPlaying) {
    const c = colors.statusPlayIcon;
    drawList.push(
      { dl: [x0, y0, x0, y0 + 4, c] },
      { dl: [x0 + 1, y0 + 1, x0 + 1, y0 + 3, c] },
      { dl: [x0 + 2, y0 + 2, x0 + 2, y0 + 2, c] }
    );
  } else {
    const c = colors.statusPauseIcon;
    drawList.push(
      { dl: [x0, y0, x0, y0 + 4, c] },
      { dl: [x0 + 2, y0, x0 + 2, y0 + 4, c] }
    );
  }
}

/**
 * 绘制屏幕最底部的 1 像素全宽播放进度条
 * @param {Array} drawList - 图元目标数组
 * @param {number} currentSec - 当前秒数
 * @param {number} totalSec - 歌曲总秒数
 * @param {number} screenWidth - 屏幕宽度
 * @param {number} screenHeight - 屏幕高度
 * @param {Object} colors - 全局颜色配置
 */
function appendProgressBar(drawList, currentSec, totalSec, screenWidth, screenHeight, colors) {
  const progressRatio = totalSec > 0 ? Math.min(Math.max(currentSec / totalSec, 0), 1) : 0;
  const progressWidth = Math.round(progressRatio * (screenWidth - 1));

  // 1. 底槽暗色线
  drawList.push({
    dl: [0, screenHeight - 1, screenWidth - 1, screenHeight - 1, colors.progressBarTrack]
  });

  // 2. 高亮填充线
  if (progressWidth > 0) {
    drawList.push({
      dl: [0, screenHeight - 1, progressWidth, screenHeight - 1, colors.progressBarFill]
    });
  }
}

/**
 * 计算围绕内圈外沿的对端双高光及前后渐变过渡点
 * @param {number} currentSec - 当前秒数
 * @param {Object} colors - 全局颜色配置
 * @param {number} period - 旋转一圈所需的总秒数（默认 20 秒）
 * @returns {Array} 旋转点图元数组
 */
function getVinylSpecularHighlights(currentSec, colors, period = 20) {
  const centerX = 6;
  const centerY = 7;
  const radius = 3.0; // 紧贴半径为 2 的内芯外沿

  // 基础顺时针弧度
  const baseAngle = ((currentSec % period) / period) * 2 * Math.PI;
  // 前后羽化过渡的角度偏移（约 22.5 度）
  const offsetAngle = Math.PI / 8;

  // 从配置中读取高光配色（带 Fallback 兜底）
  const colorMain = colors.vinylHighlightMain || '#FFD700';
  const colorFade = colors.vinylHighlightFade || '#554822';

  const points = [];
  const pointMap = new Map();

  function addPoint(angle, color, priority) {
    const x = Math.round(centerX + radius * Math.sin(angle));
    const y = Math.round(centerY - radius * Math.cos(angle));
    const key = `${x},${y}`;

    // 像素点重叠时优先保留高优先级的主点
    if (!pointMap.has(key) || pointMap.get(key).priority < priority) {
      pointMap.set(key, { x, y, color, priority });
    }
  }

  // 计算两侧对端高光：0（主端）与 Math.PI（对端）
  [0, Math.PI].forEach((oppositeOffset) => {
    const centerA = baseAngle + oppositeOffset;
    // 前点（拖尾微光）
    addPoint(centerA - offsetAngle, colorFade, 1);
    // 后点（前导微光）
    addPoint(centerA + offsetAngle, colorFade, 1);
    // 中心主高光点
    addPoint(centerA, colorMain, 2);
  });

  for (const p of pointMap.values()) {
    points.push({ dp: [p.x, p.y, p.color] });
  }

  return points;
}

/**
 * 辅助：安全提取颜色，兼顾新版嵌套结构与旧版扁平结构
 */
function resolveColors(rawColors, preset) {
  const common = rawColors.common || rawColors;
  const presetColors = (rawColors.presets && rawColors.presets[preset]) || rawColors;
  return { ...common, ...presetColors };
}

function buildPayload(currentSec, totalSec, isPlaying, config) {
  const { display } = config;
  // 聚合得到当前预设生效的色彩字典
  const colors = resolveColors(config.colors, display.preset);
  
  const currentStr = formatSec(currentSec);
  const totalStr = formatSec(totalSec);

  const drawElements = [];
  let textElements = [];

  // 底栏进度条
  appendProgressBar(drawElements, currentSec, totalSec, display.screenWidth, display.screenHeight, colors);

  switch (display.preset) {
    case 'COMPACT_TAG': {
      appendStatusIcon(drawElements, 48, 1, isPlaying, colors);
      textElements = [
        {
          content: 'Net Music',
          fontHeight: 5,
          x: 1,
          y: 1,
          color: colors.tagHeader || colors.TagHeader || '#F20D24',
          rect: [0, 0, display.screenWidth, display.screenHeight],
          charSpacing: 1
        },
        {
          content: `${currentStr}`,
          fontHeight: 5,
          x: 1,
          y: 8,
          color: colors.currentTime,
          rect: [0, 0, display.screenWidth, display.screenHeight],
          charSpacing: 1
        },
        {
          content: `/${totalStr}`,
          fontHeight: 5,
          x: 19,
          y: 8,
          color: colors.totalTime,
          rect: [0, 0, display.screenWidth, display.screenHeight],
          charSpacing: 1
        }
      ];
      break;
    }

    case 'LARGE_CURRENT': {
      appendStatusIcon(drawElements, 48, 1, isPlaying, colors);
      textElements = [
        {
          content: currentStr,
          fontHeight: 10,
          x: 1,
          y: 3,
          color: colors.currentTime,
          rect: [0, 0, display.screenWidth, display.screenHeight],
          charSpacing: 1
        },
        {
          content: `/${totalStr}`,
          fontHeight: 5,
          x: 28,
          y: 8,
          color: colors.totalTime,
          rect: [0, 0, display.screenWidth, display.screenHeight],
          charSpacing: 1
        }
      ];
      break;
    }

    case 'RETRO_BADGE': {
      appendStatusIcon(drawElements, 48, 1, isPlaying, colors);

      // 黑胶盘面
      drawElements.push({ dfc: [6, 7, 5, colors.vinylBody] });

      // 旋转双高光
      const highlights = getVinylSpecularHighlights(currentSec, colors, 20);
      drawElements.push(...highlights);

      // 唱片中心
      drawElements.push(
        { dfc: [6, 7, 2, colors.vinylCenter] },
        { dp: [6, 7, isPlaying ? colors.vinylSpindle : colors.vinylBody] }
      );

      // 唱臂动作
      if (isPlaying) {
        drawElements.push(
          { dl: [12, 1, 9, 4, colors.tonearmPlay] },
          { dp: [9, 4, colors.vinylSpindle] }
        );
      } else {
        drawElements.push(
          { dl: [12, 1, 12, 4, colors.tonearmPause] },
          { dp: [12, 4, colors.tonearmBase] }
        );
      }

      drawElements.push({ dp: [12, 1, colors.tonearmBase] });

      // 时间文字
      textElements = [
        {
          content: currentStr,
          fontHeight: 5,
          x: 16,
          y: 1,
          color: colors.currentTime,
          rect: [0, 0, display.screenWidth, display.screenHeight],
          charSpacing: 1
        },
        {
          content: `/${totalStr}`,
          fontHeight: 5,
          x: 24,
          y: 8,
          color: colors.totalTime,
          rect: [0, 0, display.screenWidth, display.screenHeight],
          charSpacing: 1
        }
      ];
      break;
    }
  }

  return { text: textElements, draw: drawElements };
}

module.exports = {
  formatSec,
  buildPayload
};