const express = require("express");
const path = require("path");
const api = require("./api");
const bot = require("./bot");
const db = require("./db");

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Telegram-Init-Data",
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Mini App static files
app.use("/webapp", express.static(path.join(__dirname, "..", "webapp")));

// Root → webapp
app.get("/", (_, res) => res.redirect("/webapp/"));

// API routes
app.use("/api", api);

// Telegram webhook
const WH_PATH = `/webhook/${process.env.BOT_TOKEN}`;
app.post(WH_PATH, (req, res) => {
  bot.handleUpdate(req.body).catch((e) => console.error("[Bot]", e.message));
  res.sendStatus(200);
});

// Health check
app.get("/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

// SPA fallback
app.get("/webapp/*", (_, res) => {
  res.sendFile(path.join(__dirname, "..", "webapp", "index.html"));
});

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await db.init();
  } catch (e) {
    console.error("[FATAL] DB:", e.message);
    process.exit(1);
  }
  const BASE = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  try {
    await bot.setup(`${BASE}${WH_PATH}`, `${BASE}/webapp`);
  } catch (e) {
    console.error("[WARN] Webhook:", e.message);
  }
  app.listen(PORT, () => {
    console.log(`[AniPilot] ✓ Server  → :${PORT}`);
    console.log(`[AniPilot] ✓ WebApp  → ${BASE}/webapp`);
  });
})();
