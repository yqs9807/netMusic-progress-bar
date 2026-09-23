/**
 * Ulanzi TC002 色彩亮度兼容性检测脚本
 * 
 * 硬件特性:
 * Ulanzi TC002 的亮度调节范围为 5% ~ 100%。固件低亮度下存在 PWM 整数截断，
 * 当色彩通道最大值小于 20 (即 #141414) 时，在最低 5% 亮度下有效值不足 1，会导致像素熄灭。
 */

const fs = require('fs');
const path = require('path');

// 此时脚本在 scripts 目录下，上一级即为项目根目录
const configPath = path.resolve(__dirname, '..', 'config', 'config.json');

if (!fs.existsSync(configPath)) {
  console.error('[错误] 未找到 config.json，请先运行或从 config.example.json 复制创建配置文件！');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
  console.error('[错误] config.json 解析失败:', e.message);
  process.exit(1);
}

// 将嵌套的颜色对象拍平为一维键值对，例如 "common.progressBarTrack" : "#222222"
function extractAllColors(colorsObj) {
  const result = {};
  if (!colorsObj) return result;

  // 提取通用颜色
  if (colorsObj.common) {
    for (const [k, v] of Object.entries(colorsObj.common)) {
      result[`common.${k}`] = v;
    }
  }

  // 提取各个预设模式下的专属颜色
  if (colorsObj.presets) {
    for (const [presetName, presetColors] of Object.entries(colorsObj.presets)) {
      for (const [k, v] of Object.entries(presetColors)) {
        result[`${presetName}.${k}`] = v;
      }
    }
  }

  return result;
}

const flatColors = extractAllColors(config.colors);

/**
 * 计算 Hex 颜色在屏幕上不熄灭所需的最低亮度百分比
 */
function calculateMinBrightness(hex) {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 0;

  const maxChannel = Math.max(r, g, b);

  if (maxChannel === 0) {
    return { minBrightness: 0, maxChannel: 0, isBlack: true };
  }

  const minBrightness = Math.ceil(100 / maxChannel);
  return { minBrightness, maxChannel, isBlack: false };
}

console.log('========================================================================');
console.log('            Ulanzi TC002 颜色最低可见亮度检测结果                         ');
console.log('            (设备硬件有效调节范围: 5% ~ 100%)                            ');
console.log('========================================================================');
console.log('配置项名称                                 HEX颜色     通道最大值   最低可见亮度   状态');
console.log('------------------------------------------------------------------------');

let highestMinBrightness = 5;
let failColors = [];

for (const [key, hexValue] of Object.entries(flatColors)) {
  if (typeof hexValue !== 'string' || !hexValue.startsWith('#')) continue;

  const result = calculateMinBrightness(hexValue);
  // 加长 key 的占位以适配嵌套后的长属性名
  const keyPadded = key.padEnd(40, ' ');
  const hexPadded = hexValue.padEnd(10, ' ');
  const channelPadded = String(result.maxChannel).padEnd(10, ' ');

  if (result.isBlack) {
    console.log(`${keyPadded} ${hexPadded} ${channelPadded}  --            纯黑(不发光)`);
    continue;
  }

  const isCompatibleAtLowest = result.minBrightness <= 5;
  const statusStr = isCompatibleAtLowest ? '安全 (全亮度可见)' : `需 >= ${result.minBrightness}%`;

  console.log(`${keyPadded} ${hexPadded} ${channelPadded}  ${String(result.minBrightness).padStart(3, ' ')}%         ${statusStr}`);

  if (result.minBrightness > highestMinBrightness) {
    highestMinBrightness = result.minBrightness;
  }

  if (!isCompatibleAtLowest) {
    failColors.push({ key, hex: hexValue, min: result.minBrightness, channel: result.maxChannel });
  }
}

console.log('------------------------------------------------------------------------');

if (failColors.length > 0) {
  console.log(`[检测结论] 当前配置无法在设备的极端最低亮度 (5%) 下全量显示！`);
  console.log(`[全局建议] 屏幕日常使用请保持亮度 >= ${highestMinBrightness}%\n`);
  console.warn('[低亮度熄灭告警] 以下配置的通道值小于 20，在调至 5% 亮度时将完全熄灭：');
  failColors.forEach(item => {
    console.warn(`  - ${item.key} (${item.hex}): 通道值仅为 ${item.channel}，需亮度达到 ${item.min}% 才发光！`);
  });
  console.warn('  修复建议: 将对应颜色的十六进制分量提升至 >= #141414 (例如改用 #222222 或更高)。');
} else {
  console.log(`[检测结论] 完美兼容！所有颜色在设备允许调节的最低亮度 (5%) 下均可正常发光点亮。`);
}
console.log('========================================================================');