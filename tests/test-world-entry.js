const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json/list', res => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
      });
      if (data && data.length > 0) {
        const page = data.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch (e) {}
    await sleep(500);
  }
  return null;
}

async function main() {
  console.log('Launching Edge for In-Game World Entry Test...');
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--window-size=1024,768',
    '--enable-unsafe-webgpu',
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--no-sandbox',
    'about:blank'
  ], { stdio: 'ignore' });

  const wsUrl = await getWsUrl();
  if (!wsUrl) {
    console.error('Failed to get WebSocket debugger URL from Edge');
    edge.kill();
    process.exit(1);
  }

  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  function sendCmd(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  let serverListReceived = false;

  ws.addEventListener('open', async () => {
    await sendCmd('Runtime.enable');
    await sendCmd('Page.enable');
    await sendCmd('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sendCmd('Page.navigate', { url: 'http://localhost:8085' });
  });

  ws.addEventListener('message', async event => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const type = msg.params.type;
        const args = msg.params.args.map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
        if (!args.includes('Downloading data')) {
          console.log(`[CONSOLE ${type.toUpperCase()}]`, args);
        }
        if (args.includes('Success Receive Server List')) {
          serverListReceived = true;
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[EXCEPTION]', msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description);
      }
    } catch (e) {
      console.error('Error handling message:', e);
    }
  });

  // Wait for server list
  for (let s = 0; s < 60; s++) {
    await sleep(1000);
    if (serverListReceived) break;
  }
  await sleep(1500);

  // 1. Select Server
  console.log('\n--- Selecting Server ---');
  await sendCmd('Runtime.evaluate', { expression: `Module._MuWeb_SelectServer(0)` });
  await sleep(3000);

  // 2. Submit Login
  console.log('\n--- Submitting Login (test400 / 123456) ---');
  await sendCmd('Runtime.evaluate', {
    expression: `Module.ccall('MuWeb_SubmitLogin', 'boolean', ['string', 'string'], ['test400', '123456'])`
  });

  // Wait until character list is loaded (ProtocolState == 50)
  console.log('Waiting for character list (ProtocolState == 50)...');
  let charListReady = false;
  for (let s = 0; s < 30; s++) {
    await sleep(500);
    const st = await sendCmd('Runtime.evaluate', {
      expression: `Module._MuWeb_GetProtocolState ? Module._MuWeb_GetProtocolState() : -1`
    });
    if (st?.result?.value === 51) {
      console.log('Character list loaded! ProtocolState = 51');
      charListReady = true;
      break;
    }
  }
  await sleep(1500);

  // 3. Enter World with character 0
  console.log('\n--- Entering World with Character 0 ---');
  await sendCmd('Runtime.evaluate', { expression: `Module._MuWeb_EnterWorld(0)` });

  // Wait 12 seconds for world terrain and assets to load and render
  console.log('Waiting 12s for in-game world rendering...');
  await sleep(12000);

  try {
    const ingameShot = await sendCmd('Page.captureScreenshot', { format: 'png' });
    if (ingameShot?.data) {
      const outPath = 'C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step5_ingame.png';
      fs.writeFileSync(outPath, Buffer.from(ingameShot.data, 'base64'));
      console.log('Saved step5_ingame.png');
    }
  } catch (err) {
    console.error('Screenshot save failed:', err.message);
  }

  // Check state
  const stateRes = await sendCmd('Runtime.evaluate', {
    expression: `Module._MuWeb_GetProtocolState ? Module._MuWeb_GetProtocolState() : -1`
  });
  console.log('Final Protocol State:', stateRes?.result?.value);

  edge.kill();
  console.log('\n=== In-Game Test Finished ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
