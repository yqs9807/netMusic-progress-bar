const fs = require('fs');
const path = require('path');

const exePath = path.resolve(__dirname, '..', 'dist', 'PixMusicControl.exe');

if (!fs.existsSync(exePath)) {
  console.error('[错误] 未找到文件:', exePath);
  process.exit(1);
}

const fd = fs.openSync(exePath, 'r+');

// 1. 读取 PE 头在 DOS 头的偏移量 (位于 0x3C，4 字节)
const peOffsetBuf = Buffer.alloc(4);
fs.readSync(fd, peOffsetBuf, 0, 4, 0x3C);
const peOffset = peOffsetBuf.readUInt32LE(0);

// 2. PE 签名 (4字节) + COFF 头 (20字节) + OptionalHeader 的 Subsystem 偏移 (PE32+ 64位为 68 字节)
// Subsystem 字段总偏移量 = peOffset + 4 + 20 + 68 = peOffset + 92
const subsystemOffset = peOffset + 92;

// 3. 读取当前子系统值验证
const subBuf = Buffer.alloc(2);
fs.readSync(fd, subBuf, 0, 2, subsystemOffset);
const currentSub = subBuf.readUInt16LE(0);

console.log(`[信息] 检测到当前 Subsystem: ${currentSub} (3=Console, 2=GUI)`);

// 4. 改写为 2 (IMAGE_SUBSYSTEM_WINDOWS_GUI)
subBuf.writeUInt16LE(2, 0);
fs.writeSync(fd, subBuf, 0, 2, subsystemOffset);
fs.closeSync(fd);

console.log('[成功] 已将可执行文件子系统改写为 Windows GUI，运行将不再弹出黑框！');