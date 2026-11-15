"use strict";

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { Server } = require("socket.io");
const ip = require("ip");
const qrcode = require("qrcode-terminal");

const { AUDIO_FILE, USERS_FILE, readJSON, writeJSON } = require("./server/persistence");
const { registerAuthHandlers } = require("./server/auth");
const { createGameService } = require("./server/game");
const { registerRoomHandlers } = require("./server/rooms");

const PORT = 3000;
const CERT_DIR = path.join(__dirname, "certs");
const certOptions = {
  key: fs.readFileSync(path.join(CERT_DIR, "key.pem")),
  cert: fs.readFileSync(path.join(CERT_DIR, "cert.pem")),
};

const server = https.createServer(certOptions, (req, res) => {
  const reqPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(__dirname, "public", reqPath.split("?")[0]);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Recurso No Encontrado");
    } else {
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
      });
      res.end(content, "utf-8");
    }
  });
});

const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8,
});
const connectedSockets = new Map();
const rooms = new Map();
const gameService = createGameService({
  io,
  rooms,
  connectedSockets,
  readJSON,
  writeJSON,
  AUDIO_FILE,
  USERS_FILE,
});

io.on("connection", (socket) => {
  registerAuthHandlers(socket, {
    connectedSockets,
    readJSON,
    writeJSON,
    USERS_FILE,
  });
  registerRoomHandlers(socket, {
    io,
    rooms,
    connectedSockets,
    startGame: gameService.startGame,
  });
  gameService.registerGameHandlers(socket);
});

server.listen(PORT, "0.0.0.0", () => {
  const localUrl = `https://${ip.address()}:${PORT}`;
  console.clear();
  console.log("====================================================");
  console.log("   SERVIDOR HTTPS ACTIVO (NODE.JS + SOCKET.IO)");
  console.log("   Trabajo Por Jay - Aimee");
  console.log(`   Localhost:  https://localhost:${PORT}`);
  console.log(`   Red Móvil:  ${localUrl}`);
  console.log("====================================================");
  console.log("Escanea el QR desde tu móvil (misma red WiFi):");
  qrcode.generate(localUrl, { small: true });
});
