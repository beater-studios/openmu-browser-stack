const net = require("net");
const struct = require("util");

const modulus = [0x1f44f, 0x28386, 0x1125b, 0x1a192];
const encrypt_key = [0x5bc1, 0x2e87, 0x4d68, 0x354f];
const decrypt_key = [0x7b38, 0x7ff, 0xdeb3, 0x27c7];
const xor_key = [0xbd1d, 0xb455, 0x3b43, 0x9239];

function getBitIndex(i) { return i * 18; }
function getByteOffset(i) { return Math.floor(getBitIndex(i) / 8); }
function getBitOffset(i) { return getBitIndex(i) % 8; }
function getFirstBitMask(i) { return 255 >> getBitOffset(i); }
function getRemainderBitMask(i) {
  const bo = getBitOffset(i);
  return (((255 << (6 - bo)) & 255) - ((255 << (8 - bo)) & 255)) & 255;
}

function writeResultToTarget(target, i, val) {
  let byteOffset = getByteOffset(i);
  const bitOffset = getBitOffset(i);
  const firstMask = getFirstBitMask(i);

  // ReverseEndianness of 32-bit uint
  const b = Buffer.alloc(4);
  b.writeUInt32LE(val >>> 0, 0);
  const loc3 = b.readUInt32BE(0);

  target[byteOffset] = (target[byteOffset] | (((loc3 >>> (24 + bitOffset)) & 0xFF) & firstMask)) & 0xFF;
  byteOffset++;

  target[byteOffset] = ((loc3 >>> (16 + bitOffset)) & 0xFF);
  byteOffset++;

  target[byteOffset] = ((loc3 >>> (8 + bitOffset)) & ((255 << (8 - bitOffset)) & 255)) & 0xFF;

  const remMask = getRemainderBitMask(i);
  const loc5 = (((val >>> 16) << (6 - bitOffset)) & 0xFF);
  target[byteOffset] = (target[byteOffset] | (loc5 & remMask)) & 0xFF;
}

function encryptBlock(plain, size) {
  const inputWords = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const b0 = (i * 2 < plain.length) ? plain[i * 2] : 0;
    const b1 = (i * 2 + 1 < plain.length) ? plain[i * 2 + 1] : 0;
    inputWords[i] = (b0 | (b1 << 8)) >>> 0;
  }

  const res = [0, 0, 0, 0];
  res[0] = Number((BigInt(xor_key[0] ^ inputWords[0]) * BigInt(encrypt_key[0])) % BigInt(modulus[0]));
  for (let i = 1; i < 4; i++) {
    res[i] = Number((BigInt(xor_key[i] ^ inputWords[i] ^ (res[i - 1] & 0xFFFF)) * BigInt(encrypt_key[i])) % BigInt(modulus[i]));
  }

  for (let i = 0; i < 3; i++) {
    res[i] = (res[i] ^ xor_key[i] ^ (res[i + 1] & 0xFFFF)) >>> 0;
  }

  const target = Buffer.alloc(11, 0);
  for (let i = 0; i < 4; i++) {
    writeResultToTarget(target, i, res[i]);
  }

  let checksum = 0xF8;
  for (let i = 0; i < size; i++) {
    checksum ^= plain[i];
  }
  const val0 = (size ^ 0x3D) ^ checksum;
  target[9] = val0 & 0xFF;
  target[10] = checksum & 0xFF;
  return target;
}

const xor32Key = Buffer.from("ab11cdfe1823c5a3ca33c1cc666721f33212153529fffe1d44efcd41263c4e4d", "hex");

function applyXor32(packet) {
  // packet: Buffer [0xC3, length, code, ...]
  // header size for C3 is 2 bytes
  const buf = Buffer.from(packet);
  for (let i = 3; i < buf.length; i++) {
    buf[i] = (buf[i] ^ buf[i - 1] ^ xor32Key[i % 32]) & 0xFF;
  }
  return buf;
}

function encryptC3Packet(packet, counter) {
  // Apply XOR32 first
  const xorBuf = applyXor32(packet);
  // Then SimpleModulus encrypt payload
  const payload = xorBuf.subarray(2);
  const plainBuf = Buffer.alloc(1 + payload.length);
  plainBuf[0] = counter & 0xFF;
  payload.copy(plainBuf, 1);

  const blockSize = 8;
  const numBlocks = Math.ceil(plainBuf.length / blockSize);
  const encBlocks = [];

  for (let b = 0; b < numBlocks; b++) {
    const chunkStart = b * blockSize;
    const chunkEnd = Math.min(chunkStart + blockSize, plainBuf.length);
    const chunkSize = chunkEnd - chunkStart;
    const chunk = plainBuf.subarray(chunkStart, chunkEnd);
    encBlocks.push(encryptBlock(chunk, chunkSize));
  }

  const encData = Buffer.concat(encBlocks);
  const totalLength = 2 + encData.length;
  const res = Buffer.alloc(totalLength);
  res[0] = 0xC3;
  res[1] = totalLength;
  encData.copy(res, 2);
  return res;
}

const s = net.connect(45901, "127.0.0.1", () => {
  console.log("Connected to GameServer 45901");
});

let counter = 0;

s.on("data", data => {
  console.log("Received from GS (hex):", data.toString("hex"), "len:", data.length);
  if (data[0] === 0xC1 && data[2] === 0xF1 && data[3] === 0x00) {
    console.log("Got JoinServer packet (C1 F1 00)");
    // Build unencrypted LoginLongPassword packet
    const pkt = Buffer.alloc(60, 0);
    pkt[0] = 0xC3;
    pkt[1] = 60;
    pkt[2] = 0xF1;
    pkt[3] = 0x01;
    const user = Buffer.alloc(10, 0);
    user.write("test400");
    const pass = Buffer.alloc(20, 0);
    pass.write("123456");
    const xorKey = [0xFC, 0xCF, 0xAB];
    for (let i = 0; i < 10; i++) pkt[4 + i] = user[i] ^ xorKey[i % 3];
    for (let i = 0; i < 20; i++) pkt[14 + i] = pass[i] ^ xorKey[i % 3];
    pkt.writeUInt32BE(12345, 34);
    pkt.set([0x32, 0x30, 0x34, 0x30, 0x34], 38);
    pkt.write("k1Pk2jcET48mxL3b", 43, "ascii");

    console.log("Plaintext login packet:", pkt.toString("hex"));
    const encPkt = encryptC3Packet(pkt, counter++);
    console.log("Encrypted login packet:", encPkt.toString("hex"));
    s.write(encPkt);
  } else {
    console.log("Got response packet:", data.toString("hex"));
  }
});

s.on("close", () => console.log("Connection closed"));
s.on("error", e => console.error("Error:", e));
setTimeout(() => {
  console.log("Closing test...");
  s.end();
}, 8000);
