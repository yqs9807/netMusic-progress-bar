const http = require('http');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');

function startConfigServer(configPath, onConfigUpdate, getRuntimeStatus, port = 25688) {
  const webDir = path.resolve(__dirname, '..', 'web');

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml'
  };

  // 维护局域网自动发现的设备状态
  let discoveredDevice = {
    ip: null,
    mac: null,
    sn: null,
    model: null,
    lastSeen: 0,
    online: false
  };

  // 启动 UDP 55555 端口广播监听服务
  function initUdpDiscovery() {
    const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    udpServer.on('error', (err) => {
      console.error('[UDP Discovery Error] 套接字发生异常:', err.message);
      if (err.code === 'EACCES') {
        console.error('[UDP Discovery Error] 端口 55555 绑定被拒绝 (EACCES)。原因通常是该端口被 Windows WinNAT/Hyper-V 划入了保留端口排除范围。');
      } else if (err.code === 'EADDRINUSE') {
        console.error('[UDP Discovery Error] 端口 55555 已被其他进程占用 (EADDRINUSE)。');
      }
      try {
        udpServer.close();
      } catch (closeErr) {
        console.error('[UDP Discovery Error] 关闭 UDP 套接字失败:', closeErr.message);
      }
    });

    udpServer.on('message', (msg, rinfo) => {
      try {
        const dataStr = msg.toString().trim();
        const parts = dataStr.split(':');

        if (parts.length >= 4 && parts[0].includes('Ulanzi')) {
          const modelName = parts[0];
          const rawMac = parts[1];
          const sn = parts[2];
          const statusFlag = parts[3] === 'true';
          const deviceIp = rinfo.address;

          const isNew = discoveredDevice.ip !== deviceIp;

          discoveredDevice = {
            ip: deviceIp,
            mac: rawMac,
            sn: sn,
            model: modelName,
            lastSeen: Date.now(),
            online: statusFlag
          };

          if (isNew) {
            console.log(`[UDP Discovery] 成功捕获并解析设备: IP=${deviceIp}, MAC=${rawMac}, SN=${sn}`);
          }
        }
      } catch (parseErr) {
        console.error('[UDP Discovery Error] 解析广播报文异常:', parseErr.message, '原始数据:', msg.toString());
      }
    });

    udpServer.on('listening', () => {
      try {
        udpServer.setBroadcast(true);
      } catch (broadcastErr) {
        console.error('[UDP Discovery Error] 开启套接字广播模式失败:', broadcastErr.message);
      }
      const addr = udpServer.address();
      console.log(`[UDP Discovery] 局域网自发现监听已就绪: ${addr.address}:${addr.port}`);
    });

    try {
      udpServer.bind(55555, '0.0.0.0');
    } catch (bindErr) {
      console.error('[UDP Discovery Error] 绑定端口 55555 同步异常:', bindErr.message);
    }

    setInterval(() => {
      if (discoveredDevice.online && Date.now() - discoveredDevice.lastSeen > 15000) {
        discoveredDevice.online = false;
        console.log('[UDP Discovery] 设备心跳广播超时，已标记离线');
      }
    }, 5000);
  }

  // 随 HTTP 服务一同启动 UDP 监听
  initUdpDiscovery();

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // 1. 获取当前配置
    if (req.url === '/api/config' && req.method === 'GET') {
      if (fs.existsSync(configPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(fs.readFileSync(configPath, 'utf-8'));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '配置不存在' }));
    }

    // 2. 保存新配置
    if (req.url === '/api/config' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          fs.writeFileSync(configPath, JSON.stringify(parsed, null, 4), 'utf-8');
          if (onConfigUpdate) onConfigUpdate(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          console.error('[HTTP Server Error] 保存配置文件失败:', e.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 3. 获取网易云当前实时播放状态
    if (req.url === '/api/status' && req.method === 'GET') {
      const status = getRuntimeStatus ? getRuntimeStatus() : { isRunning: false };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(status));
    }

    // 4. 获取局域网自动发现的 Ulanzi 设备状态
    if (req.url === '/api/discoveredDevice' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(discoveredDevice));
    }

    // 5. 硬件跨域请求代理
    if (req.url === '/api/proxy' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { url, method, payload } = JSON.parse(body);
          const fetchOptions = {
            method: method || 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache'
            }
          };
          if (payload && (method === 'POST' || method === 'PUT')) {
            fetchOptions.body = typeof payload === 'string' ? payload : JSON.stringify(payload);
          }
          const response = await fetch(url, fetchOptions);
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(data));
        } catch (e) {
          console.error('[HTTP Proxy Error] 请求硬件设备代理失败:', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 6. 静态前端文件托管
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(webDir, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      return res.end(fs.readFileSync(filePath));
    }

    res.writeHead(404);
    res.end('404 Not Found');
  });

  server.on('error', (err) => {
    console.error(`[HTTP Server Error] Web 服务端口 ${port} 监听失败:`, err.message);
  });

  server.listen(port, '127.0.0.1');
}

module.exports = { startConfigServer };