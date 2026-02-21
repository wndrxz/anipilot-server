const db = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

/* ── Telegram API wrapper ── */
async function tg(method, body) {
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    console.error(`[TG] ${method}:`, e.message);
    return null;
  }
}

/* ── Шаблоны уведомлений ── */
function fmtTime(s) {
  const m = Math.floor(s / 60),
    sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const TEMPLATES = {
  video_crash: (p) => ({
    text:
      `⚠️ *Воспроизведение прервано*\n${p.title || "Аниме"} С${p.season || "?"}Е${p.episode || "?"}` +
      (p.time > 0 ? `\n⏱ на ${fmtTime(p.time)}` : ""),
    kb: [
      [{ text: "▶ Продолжить", callback_data: `resume:${p._uid}` }],
      [{ text: "🔍 Найти другое", callback_data: `search:${p._uid}` }],
    ],
  }),

  connection_lost: (p) => ({
    text: `📡 *Соединение потеряно*\n${p.title ? `Последнее: ${p.title}` : ""}`,
    kb: [[{ text: "▶ Продолжить", callback_data: `resume:${p._uid}` }]],
  }),

  marathon_crash: (p) => ({
    text: `💥 *Марафон прерван*\n${p.title || "?"} (${p.idx || "?"}/${p.total || "?"})`,
    kb: [
      [
        { text: "▶ Продолжить", callback_data: `mcont:${p._uid}` },
        { text: "⏹ Стоп", callback_data: `mstop:${p._uid}` },
      ],
    ],
  }),

  marathon_complete: (p) => ({
    text:
      `🎉 *Марафон завершён!*\n${p.total || "?"} аниме` +
      (p.time ? `, ${p.time}` : ""),
    kb: [
      [
        { text: "🔄 Новый", callback_data: `mnew:${p._uid}` },
        { text: "📊 Стата", callback_data: `stats:${p._uid}` },
      ],
    ],
  }),

  script_offline: (p) => ({
    text:
      `🔌 *AniPilot отключился*\nНе отвечает 10+ мин` +
      (p.title ? `\nПоследнее: ${p.title}` : ""),
    kb: [[{ text: "🔄 Проверить", callback_data: `check:${p._uid}` }]],
  }),
};

/* ── Маппинг тип → настройка ── */
const SETTING_MAP = {
  video_crash: "notify_crash",
  connection_lost: "notify_crash",
  marathon_crash: "notify_marathon",
  marathon_complete: "notify_marathon",
  script_offline: "notify_offline",
};

/* ── Главная функция ── */
const Notify = {
  tg, // экспортируем для bot.js

  async send(userId, type, payload = {}) {
    try {
      const user = await db.getUserById(userId);
      if (!user) return;

      // Проверка настройки
      const key = SETTING_MAP[type];
      if (key && !user[key]) return;

      // Антиспам: 5 мин cooldown
      if (!(await db.canNotify(userId, type, 300000))) return;

      const tmpl = TEMPLATES[type];
      if (!tmpl) return;

      const msg = tmpl({ ...payload, _uid: userId });

      await tg("sendMessage", {
        chat_id: user.telegram_id,
        text: msg.text,
        parse_mode: "Markdown",
        reply_markup: msg.kb ? { inline_keyboard: msg.kb } : undefined,
      });

      await db.logNotification(userId, type);
    } catch (e) {
      console.error(`[Notify] ${type}:`, e.message);
    }
  },
};

module.exports = Notify;
