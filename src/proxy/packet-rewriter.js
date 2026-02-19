const PacketParser = require("./packet-parser");

// Rewrites ConnectionInfo (C1 F4 03) packets so the client reconnects
// through the proxy instead of directly to the game server.
// Format: C1 16 F4 03 [ip:16 bytes null-padded] [port:2 bytes LE]
class PacketRewriter {
  constructor(proxyHost, proxyPort, gameHost) {
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
    // Docker exposes ports on localhost, but OpenMU registers with the
    // machine's public IP which may not be routable locally
    this.gameHost = gameHost || "127.0.0.1";
    this.pendingGameServer = null;
  }

  processServerPacket(packet) {
    const id = PacketParser.identify(packet);
    if (!id) return { packet, rewritten: false };

    if (id.type === 0xc1 && id.code === 0xf4 && id.subCode === 0x03) {
      return this._rewriteConnectionInfo(packet);
    }

    return { packet, rewritten: false };
  }

  _rewriteConnectionInfo(packet) {
    if (packet.length < 22) {
      console.warn(
        "[REWRITER] ConnectionInfo packet too short:",
        packet.length,
      );
      return { packet, rewritten: false };
    }

    const ipBytes = packet.subarray(4, 20);
    const originalIp = ipBytes.toString("ascii").replace(/\0/g, "");
    const originalPort = packet.readUInt16LE(20);

    console.log(
      `[REWRITER] ConnectionInfo: ${originalIp}:${originalPort} -> ${this.proxyHost}:${this.proxyPort}`,
    );

    this.pendingGameServer = {
      host: this.gameHost,
      port: originalPort,
    };

    const rewritten = Buffer.from(packet);

    const proxyIpBuf = Buffer.alloc(16, 0);
    proxyIpBuf.write(this.proxyHost, "ascii");
    proxyIpBuf.copy(rewritten, 4);

    rewritten.writeUInt16LE(this.proxyPort, 20);

    return {
      packet: rewritten,
      rewritten: true,
      gameServerTarget: this.pendingGameServer,
    };
  }

  consumePendingTarget() {
    const target = this.pendingGameServer;
    this.pendingGameServer = null;
    return target;
  }

  hasPendingTarget() {
    return this.pendingGameServer !== null;
  }
}

module.exports = PacketRewriter;
