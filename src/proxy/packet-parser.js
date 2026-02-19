const { EventEmitter } = require("events");

// MU packet types: C1/C3 have 1-byte length, C2/C4 have 2-byte BE length.
// C3/C4 are encrypted (SimpleModulus/XOR32) but the proxy treats them as opaque.
class PacketParser extends EventEmitter {
  constructor(label) {
    super();
    this.label = label || "parser";
    this.buffer = Buffer.alloc(0);
  }

  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    this._parse();
  }

  _parse() {
    while (this.buffer.length >= 2) {
      const type = this.buffer[0];

      if (type !== 0xc1 && type !== 0xc2 && type !== 0xc3 && type !== 0xc4) {
        console.warn(
          `[${this.label}] Invalid packet type: 0x${type.toString(16)}, skipping byte`,
        );
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      let packetLength;

      if (type === 0xc1 || type === 0xc3) {
        packetLength = this.buffer[1];
      } else {
        if (this.buffer.length < 3) return;
        packetLength = this.buffer.readUInt16BE(1);
      }

      if (packetLength < 3) {
        console.warn(
          `[${this.label}] Invalid packet length: ${packetLength}, skipping`,
        );
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      if (this.buffer.length < packetLength) return;

      const packet = this.buffer.subarray(0, packetLength);
      this.buffer = this.buffer.subarray(packetLength);

      this.emit("packet", packet);
    }
  }

  static identify(packet) {
    if (!packet || packet.length < 3) return null;

    const type = packet[0];
    let code, subCode;

    if (type === 0xc1 || type === 0xc3) {
      code = packet[2];
      subCode = packet.length > 3 ? packet[3] : null;
    } else {
      code = packet.length > 3 ? packet[3] : null;
      subCode = packet.length > 4 ? packet[4] : null;
    }

    return { type, code, subCode };
  }

  static formatPacket(packet, maxBytes) {
    maxBytes = maxBytes || 32;
    const hex = packet
      .subarray(0, Math.min(packet.length, maxBytes))
      .toString("hex")
      .match(/.{1,2}/g)
      .join(" ")
      .toUpperCase();
    const suffix = packet.length > maxBytes ? "..." : "";
    const id = PacketParser.identify(packet);
    const idStr = id
      ? `[${id.type.toString(16).toUpperCase()} code=0x${(id.code || 0).toString(16).toUpperCase()} sub=0x${(id.subCode || 0).toString(16).toUpperCase()}]`
      : "[??]";
    return `${idStr} (${packet.length}b) ${hex}${suffix}`;
  }
}

module.exports = PacketParser;
