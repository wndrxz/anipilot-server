const db = require("./db");
const notify = require("./notify");

let lastRun = 0;

module.exports = async function lazyCron() {
  const now = Date.now();
  if (now - lastRun < 60000) return; // макс раз в минуту
  lastRun = now;

  try {
    // 1. Офлайн-детекция: heartbeat > 10 мин
    const stale = await db.getStaleOnline(600000);
    for (const row of stale) {
      const anime = row.current_anime;
      await notify.send(row.user_id, "script_offline", {
        title: anime?.title || "",
      });
      await db.upsertState(row.user_id, {
        is_online: false,
        notified_offline: true,
      });
    }

    // 2. Чистка старых команд (>1ч) и уведомлений (>24ч)
    await db.cleanOldCommands();
    await db.cleanOldNotifications();
  } catch (e) {
    console.error("[Cron]", e.message);
  }
};
