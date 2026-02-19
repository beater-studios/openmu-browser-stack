const { WebSocketServer } = require("ws");
const PacketParser = require("./packet-parser");
const PacketRewriter = require("./packet-rewriter");
const { createTcpConnection } = require("./tcp-client");

function createProxyServer(config) {
  const {
    wsPort,
    wsHost,
    connectHost,
    connectPort,
    gameHost,
    proxyPublicHost,
    proxyPublicPort,
  } = config;

  // ConnectionInfo (F4 03) redirects are stored per client IP so the next
  // WebSocket connection from that IP routes to the correct game server port
  const sessionTargets = new Map();

  const wss = new WebSocketServer({
    port: wsPort,
    host: wsHost,
    perMessageDeflate: false,
  });
  console.log(`[WS] Proxy listening on ws://${wsHost}:${wsPort}`);

  let connectionId = 0;

  wss.on("connection", (ws, req) => {
    const id = ++connectionId;
    const clientIp = req.socket.remoteAddress;
    const tag = `conn#${id}`;

    console.log(`[WS:${tag}] New connection from ${clientIp}`);

    const sessionKey = clientIp;
    let tcpHost, tcpPort;

    if (sessionTargets.has(sessionKey)) {
      const target = sessionTargets.get(sessionKey);
      sessionTargets.delete(sessionKey);
      tcpHost = target.host;
      tcpPort = target.port;
      console.log(
        `[WS:${tag}] Routing to Game Server (redirect): ${tcpHost}:${tcpPort}`,
      );
    } else {
      tcpHost = connectHost;
      tcpPort = connectPort;
      console.log(
        `[WS:${tag}] Routing to Connect Server: ${tcpHost}:${tcpPort}`,
      );
    }

    const rewriter = new PacketRewriter(
      proxyPublicHost,
      proxyPublicPort,
      gameHost,
    );
    const tcp = createTcpConnection(tcpHost, tcpPort, tag);
    const serverParser = new PacketParser(`${tag}:server`);

    let wsAlive = true;
    let tcpAlive = false;

    tcp.on("connect", () => {
      tcpAlive = true;
    });

    tcp.on("data", (data) => {
      if (!wsAlive) return;
      serverParser.feed(data);
    });

    serverParser.on("packet", (packet) => {
      if (!wsAlive) return;

      const result = rewriter.processServerPacket(packet);

      if (result.rewritten && result.gameServerTarget) {
        console.log(
          `[${tag}] Game server redirect: ${result.gameServerTarget.host}:${result.gameServerTarget.port}`,
        );
        sessionTargets.set(sessionKey, result.gameServerTarget);
      }

      try {
        ws.send(result.packet);
      } catch (err) {
        console.error(`[WS:${tag}] Send error: ${err.message}`);
      }
    });

    ws.on("message", (data) => {
      if (!tcpAlive) return;
      tcp.write(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    ws.on("close", (code) => {
      wsAlive = false;
      console.log(`[WS:${tag}] Closed (code=${code})`);
      if (tcpAlive) {
        tcp.destroy();
        tcpAlive = false;
      }
    });

    ws.on("error", (err) => {
      console.error(`[WS:${tag}] Error: ${err.message}`);
      wsAlive = false;
      if (tcpAlive) {
        tcp.destroy();
        tcpAlive = false;
      }
    });

    tcp.on("close", () => {
      tcpAlive = false;
      if (wsAlive) {
        console.log(`[${tag}] TCP closed, closing WS`);
        ws.close();
        wsAlive = false;
      }
    });

    tcp.on("error", (err) => {
      console.error(`[TCP:${tag}] Error: ${err.message}`);
      tcpAlive = false;
      if (wsAlive) {
        ws.close();
        wsAlive = false;
      }
    });
  });

  wss.on("error", (err) => {
    console.error(`[WS] Server error: ${err.message}`);
  });

  return wss;
}

module.exports = { createProxyServer };
