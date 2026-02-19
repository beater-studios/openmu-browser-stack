const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const { createProxyServer } = require("./ws-server");

const config = {
  wsPort: parseInt(process.env.WS_PORT || "7100", 10),
  wsHost: process.env.WS_HOST || "0.0.0.0",
  connectHost: process.env.MU_CONNECT_HOST || "127.0.0.1",
  connectPort: parseInt(process.env.MU_CONNECT_PORT || "44405", 10),
  gameHost: process.env.MU_GAME_HOST || "127.0.0.1",
  proxyPublicHost: process.env.PROXY_PUBLIC_HOST || "127.0.0.1",
  proxyPublicPort: parseInt(process.env.PROXY_PUBLIC_PORT || "7100", 10),
};

console.log("=== OpenMU Browser Stack — WebSocket-TCP Proxy ===");
console.log(`  WebSocket:      ws://${config.wsHost}:${config.wsPort}`);
console.log(`  Connect Server: ${config.connectHost}:${config.connectPort}`);
console.log(`  Game Host:      ${config.gameHost}`);
console.log(`  Public Address: ${config.proxyPublicHost}:${config.proxyPublicPort}`);
console.log("");

createProxyServer(config);
