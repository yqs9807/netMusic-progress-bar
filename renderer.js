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
 * 主排版渲染导出函数
 * @param {number} currentSec - 当前播放秒数
 * @param {number} totalSec - 歌曲总时长秒数
 * @param {boolean} isPlaying - 是否处于播放中
 * @param {Object} config - 外部导入的完整配置对象
 * @returns {Object} 符合 Ulanzi 协议规范的 Payload
 */
function buildPayload(currentSec, totalSec, isPlaying, config) {
  const { display, colors } = config;
  const currentStr = formatSec(currentSec);
  const totalStr = formatSec(totalSec);

  const drawElements = [];
  let textElements = [];

  // 统一绘制基础底栏进度条
  appendProgressBar(drawElements, currentSec, totalSec, display.screenWidth, display.screenHeight, colors);

  switch (display.preset) {
    // ----------------------------------------------------
    // 预设模式一: COMPACT_TAG (紧凑双行标签模式)
    // ----------------------------------------------------
    case 'COMPACT_TAG': {
      appendStatusIcon(drawElements, 48, 1, isPlaying, colors);

      textElements = [
        {
          content: 'Net Music',
          fontHeight: 5,
          x: 1,
          y: 1,
          color: colors.TagHeader || '#F20D24',
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

    // ----------------------------------------------------
    // 预设模式二: LARGE_CURRENT (大字体重点显示当前进度)
    // ----------------------------------------------------
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

    // ----------------------------------------------------
    // 预设模式三: RETRO_BADGE (黑胶唱片与机械唱臂联动模式)
    // ----------------------------------------------------
    case 'RETRO_BADGE': {
      appendStatusIcon(drawElements, 48, 1, isPlaying, colors);

      // 1. 绘制圆形黑胶底盘 (半径 5)
      drawElements.push(
        { dfc: [6, 7, 5, colors.vinylBody] }
      );

      // 2. 注入对端双高光点（播放时随时间旋转，暂停时自动在当前角度静止定格）
      const highlights = getVinylSpecularHighlights(currentSec, colors, 20);
      drawElements.push(...highlights);

      // 3. 中心红标 (半径 2) 与中心轴孔
      drawElements.push(
        { dfc: [6, 7, 2, colors.vinylCenter] },
        { dp: [6, 7, colors.vinylSpindle] }
      );

      // 4. 联动唱臂动作
      if (isPlaying) {
        // 播放中：唱臂斜向伸入黑胶盘面 (12,1) -> (9,4)
        drawElements.push(
          { dl: [12, 1, 9, 4, colors.tonearmPlay] },
          { dp: [9, 4, colors.vinylSpindle] }
        );
      } else {
        // 暂停：唱臂垂直停靠归位至 (12,1) -> (12,4)
        drawElements.push(
          { dl: [12, 1, 12, 4, colors.tonearmPause] },
          { dp: [12, 4, colors.tonearmBase] }
        );
      }

      // 5. 唱臂基座 (固定旋转轴: 12, 1)
      drawElements.push(
        { dp: [12, 1, colors.tonearmBase] }
      );

      // 6. 右侧时间文本
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

  return {
    text: textElements,
    draw: drawElements
  };
}

module.exports = {
  formatSec,
  buildPayload
};