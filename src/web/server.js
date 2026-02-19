const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const PORT = parseInt(process.env.WEB_PORT || "8080", 10);
const HOST = process.env.WEB_HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "../../public");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];
  if (!req.url.includes(".wasm") && !req.url.includes(".data")) {
    console.log(`[WEB] ${req.method} ${req.url}`);
  }

  // Required for SharedArrayBuffer (WASM threading)
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

  const filePath = urlPath === "/" ? "/index.html" : urlPath;
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
    });
    fs.createReadStream(fullPath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[WEB] Server at http://${HOST}:${PORT}`);
  console.log(`[WEB] Static files: ${PUBLIC_DIR}`);
});
