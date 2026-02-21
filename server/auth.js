const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("./db");

const SECRET = process.env.JWT_SECRET || "anipilot-change-me-in-production";

// Кеш токенов (не долбить БД каждый poll)
const _cache = new Map();
const CACHE_TTL = 60000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) if (now - v.ts > CACHE_TTL) _cache.delete(k);
}, 120000);

const Auth = {
  /* ── Коды привязки ── */
  generateCode() {
    const C = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += C[crypto.randomInt(C.length)];
    return code.slice(0, 3) + "-" + code.slice(3);
  },

  /* ── JWT ── */
  signToken(userId, tgId) {
    return jwt.sign({ uid: userId, tg: tgId }, SECRET, { expiresIn: "30d" });
  },

  verifyToken(token) {
    try {
      return jwt.verify(token, SECRET);
    } catch {
      return null;
    }
  },

  /* ── Middleware: UserScript (JWT) ── */
  async userAuth(req, res, next) {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "No token" });

    // Кеш
    const cached = _cache.get(token);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      req.user = cached.user;
      return next();
    }

    const decoded = Auth.verifyToken(token);
    if (!decoded) return res.status(401).json({ error: "Bad token" });

    const user = await db.getUserById(decoded.uid);
    if (!user || user.token !== token)
      return res.status(401).json({ error: "Revoked" });

    _cache.set(token, { user, ts: Date.now() });
    req.user = user;
    next();
  },

  /* ── Middleware: Mini App (initData) ── */
  async miniAuth(req, res, next) {
    const initData =
      req.headers["x-telegram-init-data"] || req.body?.initData || "";
    if (!initData) return res.status(401).json({ error: "No initData" });

    if (!Auth.validateInitData(initData)) {
      return res.status(401).json({ error: "Invalid initData" });
    }

    const tgUser = Auth.extractUser(initData);
    if (!tgUser?.id) return res.status(401).json({ error: "No user" });

    req.user = await db.getOrCreateUser(
      tgUser.id,
      tgUser.username || tgUser.first_name || "",
    );
    next();
  },

  /* ── Telegram initData validation ── */
  validateInitData(initData) {
    try {
      const params = new URLSearchParams(initData);
      const hash = params.get("hash");
      if (!hash) return false;
      params.delete("hash");

      const checkStr = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");

      const secret = crypto
        .createHmac("sha256", "WebAppData")
        .update(process.env.BOT_TOKEN)
        .digest();

      const computed = crypto
        .createHmac("sha256", secret)
        .update(checkStr)
        .digest("hex");

      return computed === hash;
    } catch {
      return false;
    }
  },

  extractUser(initData) {
    try {
      const u = new URLSearchParams(initData).get("user");
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  },

  // Очистить кеш конкретного токена (при logout)
  invalidate(token) {
    _cache.delete(token);
  },
};

module.exports = Auth;
