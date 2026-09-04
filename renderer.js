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
          color: colors.compactTagHeader,
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

      // 1. 绘制圆形黑胶盘面 (圆心 x:6, y:7, 半径 r:5) 与中心红标
      drawElements.push(
        { dfc: [6, 7, 5, colors.vinylBody] },
        { dfc: [6, 7, 2, colors.vinylCenter] },
        { dp: [6, 7, isPlaying ? colors.vinylSpindle : colors.vinylBody] }
      );

      // 2. 联动唱臂动作
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

      // 3. 绘制唱臂基座 (固定旋转轴: 12, 1)
      drawElements.push(
        { dp: [12, 1, colors.tonearmBase] }
      );

      // 4. 右侧时间文本
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