const express = require("express");
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode");
const fs = require("fs");
const pino = require("pino");

const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY || "gulita_secret_key_2024";
const PORT = process.env.PORT || 3000;
const SESSION_DIR = "./session";

let sock = null;
let currentQR = null;
let isConnected = false;

const logger = pino({ level: "silent" });

async function connect() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  sock = makeWASocket({ auth: state, logger, browser: Browsers.ubuntu("Chrome"), printQRInTerminal: false });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      isConnected = false;
      console.log("QR listo — abrí /qr para escanearlo");
    }

    if (connection === "close") {
      isConnected = false;
      const err = lastDisconnect?.error;
      const code = (err instanceof Boom) ? err.output.statusCode : 0;
      console.log(`Desconectado. Código: ${code}. Error: ${err?.message || "sin error"}`);

      if (code === DisconnectReason.loggedOut) {
        console.log("Sesión cerrada. Borrando sesión...");
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      }
      setTimeout(connect, 3000);
    }

    if (connection === "open") {
      isConnected = true;
      currentQR = null;
      console.log("WhatsApp conectado!");
    }
  });
}

const auth = (req, res, next) => {
  if (req.headers["x-api-key"] !== API_KEY)
    return res.status(401).json({ error: "No autorizado" });
  next();
};

// Muestra el QR para escanear con el celular
app.get("/qr", async (req, res) => {
  if (isConnected) return res.send("<h2 style='font-family:sans-serif'>✅ WhatsApp conectado</h2>");
  if (!currentQR) return res.send("<h2 style='font-family:sans-serif'>Generando QR... recargá en unos segundos</h2>");
  const img = await qrcode.toDataURL(currentQR);
  res.send(`<img src="${img}" style="width:300px"><p style='font-family:sans-serif'>Escaneá con WhatsApp → Dispositivos vinculados</p>`);
});

// Envío de mensaje — llamado desde la Edge Function
app.post("/send", auth, async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message)
    return res.status(400).json({ error: "phone y message requeridos" });
  if (!isConnected)
    return res.status(503).json({ error: "WhatsApp no conectado" });

  try {
    const digits = phone.replace(/\D/g, "");
    const number = digits.startsWith("54") ? digits : `54${digits}`;
    await sock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
    res.json({ ok: true });
  } catch (e) {
    console.error("Error enviando mensaje:", e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/", (req, res) => res.json({ ok: true, connected: isConnected }));

app.listen(PORT, () => {
  console.log(`Bot escuchando en puerto ${PORT}`);
  connect();
});
