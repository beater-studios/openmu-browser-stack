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
  console.log('Launching Edge for End-to-End Login Test...');
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

  console.log('Connected to CDP at', wsUrl);
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
  let gameServerConnected = false;
  let loginSuccess = false;
  let charListReceived = false;

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
        if (args.includes('NET: Login response result=0x01') || args.includes('ReceiveJoinServer')) {
          gameServerConnected = true;
        }
        if (args.includes('Success Receive Log-In') || args.includes('RECEIVE_LOG_IN_SUCCESS')) {
          loginSuccess = true;
        }
        if (args.includes('ReceiveCharacterList') || args.includes('Character list')) {
          charListReceived = true;
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[EXCEPTION]', msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description);
      }
    } catch (e) {
      console.error('Error handling message:', e);
    }
  });

  // 1. Wait for server list received
  console.log('Waiting for ConnectServer server list...');
  for (let s = 0; s < 60; s++) {
    await sleep(1000);
    if (serverListReceived) break;
  }

  if (!serverListReceived) {
    console.error('Timeout waiting for server list');
    edge.kill();
    process.exit(1);
  }

  console.log('Server list received! Waiting 2s for stabilization...');
  await sleep(2000);

  const shot1 = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shot1?.data) {
    fs.writeFileSync('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step1_servers.png', Buffer.from(shot1.data, 'base64'));
    console.log('Saved step1_servers.png');
  }

  // 2. Select Server 0 (Valhalla -> Subserver 0)
  console.log('\n--- Calling MuWeb_SelectServer(0) ---');
  const selResult = await sendCmd('Runtime.evaluate', {
    expression: `(() => {
      if (typeof Module._MuWeb_SelectServer === 'function') {
        const res = Module._MuWeb_SelectServer(0);
        return { success: res, state: Module._MuWeb_GetProtocolState() };
      }
      return { error: 'MuWeb_SelectServer not found' };
    })()`,
    returnByValue: true
  });
  console.log('MuWeb_SelectServer result:', selResult?.result?.value);

  // Wait for GameServer connection and Login Window
  console.log('Waiting 4s for GameServer connection and LoginWindow...');
  await sleep(4000);

  const shot2 = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shot2?.data) {
    fs.writeFileSync('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step2_login_window.png', Buffer.from(shot2.data, 'base64'));
    console.log('Saved step2_login_window.png');
  }

  // Check state
  const stateRes = await sendCmd('Runtime.evaluate', {
    expression: `Module._MuWeb_GetProtocolState ? Module._MuWeb_GetProtocolState() : -1`
  });
  console.log('CurrentProtocolState:', stateRes?.result?.value);

  // 3. Submit Login Credentials: test400 / 123456
  console.log('\n--- Calling MuWeb_SubmitLogin("test400", "123456") ---');
  const loginResult = await sendCmd('Runtime.evaluate', {
    expression: `(() => {
      if (typeof Module.ccall === 'function') {
        return Module.ccall('MuWeb_SubmitLogin', 'boolean', ['string', 'string'], ['test400', '123456']);
      }
      return false;
    })()`,
    returnByValue: true
  });
  console.log('MuWeb_SubmitLogin result:', loginResult?.result?.value);

  // Wait 4s for character list
  console.log('Waiting 4s for login response and character list...');
  await sleep(4000);

  const shot3 = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shot3?.data) {
    fs.writeFileSync('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step3_character_select.png', Buffer.from(shot3.data, 'base64'));
    console.log('Saved step3_character_select.png');
  }

  const stateRes2 = await sendCmd('Runtime.evaluate', {
    expression: `Module._MuWeb_GetProtocolState ? Module._MuWeb_GetProtocolState() : -1`
  });
  console.log('CurrentProtocolState after login:', stateRes2?.result?.value);

  // 4. Enter World
  console.log('\n--- Calling MuWeb_EnterWorld(0) ---');
  const enterResult = await sendCmd('Runtime.evaluate', {
    expression: `Module._MuWeb_EnterWorld ? Module._MuWeb_EnterWorld(0) : false`
  });
  console.log('MuWeb_EnterWorld result:', enterResult?.result?.value);

  console.log('Waiting 5s for world loading...');
  await sleep(5000);

  const shot4 = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shot4?.data) {
    fs.writeFileSync('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step4_world.png', Buffer.from(shot4.data, 'base64'));
    console.log('Saved step4_world.png');
  }

  edge.kill();
  console.log('\n=== End-to-End Test Completed ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
