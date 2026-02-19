const net = require("net");

function createTcpConnection(host, port, label) {
  const tag = label || `${host}:${port}`;
  console.log(`[TCP:${tag}] Connecting to ${host}:${port}...`);

  const socket = new net.Socket();

  socket.connect(port, host, () => {
    console.log(`[TCP:${tag}] Connected`);
  });

  socket.on("error", (err) => {
    console.error(`[TCP:${tag}] Error: ${err.message}`);
  });

  socket.on("close", () => {
    console.log(`[TCP:${tag}] Disconnected`);
  });

  return socket;
}

module.exports = { createTcpConnection };
