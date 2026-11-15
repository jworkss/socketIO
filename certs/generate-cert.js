"use strict";

const fs = require("node:fs");
const path = require("node:path");
const selfsigned = require("selfsigned");
const ip = require("ip");

const localIp = ip.address();
const certDir = __dirname;

const attrs = [{ name: "commonName", value: localIp }];
const pems = selfsigned.generate(attrs, {
  days: 365,
  keySize: 2048,
  algorithm: "sha256",
  extensions: [
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
        { type: 7, ip: localIp },
      ],
    },
  ],
});

fs.writeFileSync(path.join(certDir, "key.pem"), pems.private, "utf-8");
fs.writeFileSync(path.join(certDir, "cert.pem"), pems.cert, "utf-8");

console.log(
  `[SSL] Certificados generados exitosamente para localhost y ${localIp}`,
);
