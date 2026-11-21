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
  console.log('=== Starting In-Game Click Verification ===');
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
        if (args.includes('[InputDiag]') || args.includes('[MoveHero]') || args.includes('[OpenMU]') || args.includes('[HUD]') || args.includes('Protocol') || args.includes('Server List')) {
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
  console.log('Waiting for Server List...');
  for (let s = 0; s < 60; s++) {
    await sleep(1000);
    if (serverListReceived) break;
  }
  await sleep(1500);

  // 1. Select Server
  console.log('\n--- Step 1: Selecting Server ---');
  await sendCmd('Runtime.evaluate', { expression: `Module._MuWeb_SelectServer(0)` });
  await sleep(3000);

  // 2. Submit Login
  console.log('\n--- Step 2: Submitting Login (test400 / 123456) ---');
  await sendCmd('Runtime.evaluate', {
    expression: `Module.ccall('MuWeb_SubmitLogin', 'boolean', ['string', 'string'], ['test400', '123456'])`
  });

  // Wait until character list is loaded (ProtocolState == 51)
  console.log('Waiting for character list (ProtocolState == 51)...');
  for (let s = 0; s < 30; s++) {
    await sleep(500);
    const st = await sendCmd('Runtime.evaluate', {
      expression: `Module._MuWeb_GetProtocolState ? Module._MuWeb_GetProtocolState() : -1`
    });
    if (st?.result?.value === 51) {
      console.log('Character list loaded! ProtocolState = 51');
      break;
    }
  }
  await sleep(1500);

  // 3. Enter World with character 0
  console.log('\n--- Step 3: Entering World with Character 0 ---');
  await sendCmd('Runtime.evaluate', { expression: `Module._MuWeb_EnterWorld(0)` });

  // Wait 12 seconds for world terrain and assets to load and render
  console.log('Waiting 12s for in-game world rendering...');
  await sleep(12000);

  console.log('\n--- Step 4: Testing In-Game Canvas Focus & Window Active ---');
  const focusCheck = await sendCmd('Runtime.evaluate', {
    expression: `(() => {
      focusGameCanvas();
      const canvas = document.getElementById('canvas');
      const rect = canvas.getBoundingClientRect();
      return {
        activeElement: document.activeElement ? document.activeElement.id : null,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    })()`,
    returnByValue: true
  });
  console.log('Focus and canvas rect:', focusCheck?.result?.value);

  console.log('\n--- Step 5: Dispatching Pointer / Mouse Click on Terrain (x: 512, y: 300) ---');
  // First simulate mouse move
  await sendCmd('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 512,
    y: 300
  });
  await sleep(200);

  // Then mouse press
  await sendCmd('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 512,
    y: 300,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await sleep(150);

  // Then mouse release
  await sendCmd('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 512,
    y: 300,
    button: 'left',
    buttons: 0
  });

  console.log('Waiting 3s for character movement...');
  await sleep(3000);

  // Also test direct synthetic PointerEvent to canvas to compare
  console.log('\n--- Step 6: Dispatching DOM PointerEvent to canvas directly (x: 600, y: 320) ---');
  await sendCmd('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.getElementById('canvas');
      const rect = canvas.getBoundingClientRect();
      const clientX = rect.left + (600 / 1024) * rect.width;
      const clientY = rect.top + (320 / 768) * rect.height;
      
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, button: 0, buttons: 1, bubbles: true }));
      setTimeout(() => {
        canvas.dispatchEvent(new PointerEvent('pointerup', { clientX, clientY, button: 0, buttons: 0, bubbles: true }));
      }, 100);
      return { clientX, clientY };
    })()`,
    returnByValue: true
  });

  await sleep(3000);

  try {
    const ingameShot = await sendCmd('Page.captureScreenshot', { format: 'png' });
    if (ingameShot?.data) {
      const outPath = 'C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step6_after_click.png';
      fs.writeFileSync(outPath, Buffer.from(ingameShot.data, 'base64'));
      console.log('Saved step6_after_click.png');
    }
  } catch (err) {
    console.error('Screenshot save failed:', err.message);
  }

  edge.kill();
  console.log('\n=== In-Game Click Verification Finished ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
