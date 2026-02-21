const db = require("./db");
const auth = require("./auth");
const notify = require("./notify");
const ai = require("./ai");
const search = require("./search");

const { tg } = notify;
let WEBAPP_URL = "";

/* ── Helpers ── */
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

async function editOrSend(chatId, msgId, text, extra = {}) {
  if (msgId) {
    const r = await tg("editMessageText", {
      chat_id: chatId,
      message_id: msgId,
      text,
      ...extra,
    });
    if (r?.ok) return r;
  }
  return tg("sendMessage", { chat_id: chatId, text, ...extra });
}

/* ── Bot ── */
const Bot = {
  async setup(webhookUrl, webappUrl) {
    WEBAPP_URL = webappUrl;

    const r = await tg("setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
    });
    console.log("[Bot] Webhook:", r?.ok ? "✓" : "FAILED");

    if (WEBAPP_URL) {
      await tg("setChatMenuButton", {
        menu_button: {
          type: "web_app",
          text: "🎬 AniPilot",
          web_app: { url: WEBAPP_URL },
        },
      });
    }
  },

  async handleUpdate(upd) {
    if (upd.message) await Bot.onMessage(upd.message);
    if (upd.callback_query) await Bot.onCallback(upd.callback_query);
  },

  /* ════════════════════════════
       Messages
       ════════════════════════════ */
  async onMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();
    const from = msg.from;

    const user = await db.getOrCreateUser(
      from.id,
      from.username || from.first_name || "",
    );

    const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, "");
    const arg = text.slice(cmd.length).trim();

    switch (cmd) {
      case "/start":
        return Bot.cmdStart(chatId, user);
      case "/connect":
        return Bot.cmdConnect(chatId, user);
      case "/status":
        return Bot.cmdStatus(chatId, user);
      case "/search":
        return Bot.cmdSearch(chatId, user, arg);
      case "/marathon":
        return Bot.cmdMarathon(chatId, user);
      case "/stats":
        return Bot.cmdStats(chatId, user);
      case "/recommend":
        return Bot.cmdRecommend(chatId, user);
      case "/random":
        return Bot.cmdRandom(chatId, user);
      case "/help":
        return Bot.cmdHelp(chatId);
      default:
        // Any text without / → search
        if (text && !text.startsWith("/")) {
          return Bot.cmdSearch(chatId, user, text);
        }
    }
  },

  /* ── /start ── */
  async cmdStart(chatId, user) {
    const kb = [];
    if (WEBAPP_URL) {
      kb.push([{ text: "🎬 Открыть AniPilot", web_app: { url: WEBAPP_URL } }]);
    }
    kb.push([
      { text: "🔗 Привязать скрипт", callback_data: `connect:${user.id}` },
    ]);

    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "Markdown",
      text:
        `🎬 *AniPilot* — ИИ-навигатор аниме\n\n` +
        `✨ Ищи по описанию, сцене, персонажу\n` +
        `📺 Управляй плеером с телефона\n` +
        `🎬 Марафоны с авто-переходом\n` +
        `🎯 ИИ-рекомендации\n` +
        `📊 Статистика просмотра\n\n` +
        `Для начала: /connect`,
      reply_markup: { inline_keyboard: kb },
    });
  },

  /* ── /connect ── */
  async cmdConnect(chatId, user) {
    const code = auth.generateCode();
    await db.setConnectCode(user.id, code, Date.now() + 300000);

    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "Markdown",
      text:
        `🔗 *Код привязки:*\n\n\`${code}\`\n\n` +
        `Введите в настройках AniPilot на сайте\n⏰ Действителен 5 минут`,
    });
  },

  /* ── /status ── */
  async cmdStatus(chatId, user) {
    const s = await db.getState(user.id);
    if (!s) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Скрипт не привязан → /connect",
      });
    }

    const online = s.is_online && Date.now() - s.last_heartbeat < 120000;
    let t = `📊 *Статус*\n\n${online ? "🟢" : "🔴"} Скрипт: ${online ? "онлайн" : "офлайн"}\n`;

    if (s.current_anime?.title) {
      t += `🎬 ${s.current_anime.title} С${s.current_season || "?"}Е${s.current_episode || "?"}\n`;
      t += `${s.is_playing ? "▶ Играет" : "⏸ Пауза"}`;
      if (s.video_time > 0) t += ` — ${fmtTime(s.video_time)}`;
      t += "\n";
    }

    if (s.marathon_on) {
      const q = s.marathon_queue || [];
      t += `\n🎬 Марафон: ${s.marathon_idx + 1}/${q.length}`;
    }

    t += `\n\n🔥 Сегодня: ${s.binge_today || 0} серий · ${s.watch_minutes || 0}м`;

    // Player controls if online
    const kb = [];
    if (online && s.current_anime?.title) {
      kb.push([
        {
          text: s.is_playing ? "⏸ Пауза" : "▶ Плей",
          callback_data: `${s.is_playing ? "pause" : "play"}:${user.id}`,
        },
        { text: "⏭ След.", callback_data: `next:${user.id}` },
      ]);
    }
    kb.push([
      { text: "🔄 Обновить", callback_data: `status_refresh:${user.id}` },
    ]);

    await tg("sendMessage", {
      chat_id: chatId,
      text: t,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: kb },
    });
  },

  /* ── /search ── */
  async cmdSearch(chatId, user, query) {
    if (!query) {
      return tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "Markdown",
        text: "🔍 Напишите запрос:\n`/search наруто` или просто название",
      });
    }

    const tmp = await tg("sendMessage", {
      chat_id: chatId,
      text: "🤖 ИИ анализирует...",
    });
    const msgId = tmp?.result?.message_id;

    try {
      const aiRes = await ai.ask(query);

      if (!aiRes.found) {
        let t = "❌ Не найдено";
        if (aiRes.suggestions?.length) {
          t += `\n\nПопробуйте: ${aiRes.suggestions.join(", ")}`;
        }
        return editOrSend(chatId, msgId, t);
      }

      const title = aiRes.title_ru || aiRes.title_en;
      const queries = [
        ...(aiRes.search_queries || []),
        aiRes.title_ru,
        aiRes.title_en,
        query,
      ].filter(Boolean);
      const results = await search.search(queries);

      if (!results.length) {
        return editOrSend(
          chatId,
          msgId,
          `✅ ИИ: *${title}*\n❌ На сайте не найдено`,
          { parse_mode: "Markdown" },
        );
      }

      const kb = results.slice(0, 5).map((r) => [
        {
          text: `${r.title}${r.rating ? " ★" + r.rating : ""}`,
          callback_data: `watch:${user.id}:${r.id}`,
        },
      ]);

      await editOrSend(
        chatId,
        msgId,
        `✅ *${title}* (${aiRes.confidence || "?"}%)\n${aiRes.desc || ""}\n\nВыберите:`,
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: kb },
        },
      );
    } catch (e) {
      await editOrSend(chatId, msgId, `❌ Ошибка: ${e.message}`);
    }
  },

  /* ── /marathon ── */
  async cmdMarathon(chatId, user) {
    const s = await db.getState(user.id);
    if (!s) {
      return tg("sendMessage", { chat_id: chatId, text: "❌ /connect" });
    }

    const q = s.marathon_queue || [];
    if (!q.length) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "🎬 Марафон пуст\nДобавьте через поиск или Mini App",
      });
    }

    let t = `🎬 *Марафон*${s.marathon_on ? " ▶" : ""}\n\n`;
    q.forEach((it, i) => {
      const cur = s.marathon_on && i === s.marathon_idx;
      t += `${cur ? "▶ " : ""}${i + 1}. ${it.title} С${it.season || 1}Е${it.ep || 1}\n`;
    });

    const kb = s.marathon_on
      ? [
          [
            { text: "⏭ Следующий", callback_data: `mnext:${user.id}` },
            { text: "⏹ Стоп", callback_data: `mstop:${user.id}` },
          ],
        ]
      : [
          [
            { text: "▶ Старт", callback_data: `mstart:${user.id}` },
            { text: "🗑 Очистить", callback_data: `mclear:${user.id}` },
          ],
        ];

    await tg("sendMessage", {
      chat_id: chatId,
      text: t,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: kb },
    });
  },

  /* ── /stats ── */
  async cmdStats(chatId, user) {
    const s = await db.getState(user.id);

    const min = s?.watch_minutes || 0;
    const timeStr =
      min < 60
        ? `${min}м`
        : `${Math.floor(min / 60)}ч${min % 60 ? " " + (min % 60) + "м" : ""}`;

    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "Markdown",
      text:
        `📊 *Статистика*\n\n` +
        `🕐 Сегодня: ${timeStr}\n` +
        `🔥 Серий: ${s?.binge_today || 0}`,
    });
  },

  /* ── /recommend ── */
  async cmdRecommend(chatId, user) {
    const state = await db.getState(user.id);
    const history = (state?.history || []).slice(0, 10);

    if (history.length < 2) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "📭 Нужна история просмотра (мин. 2 аниме)\nПосмотрите что-нибудь на animix.lol!",
      });
    }

    const tmp = await tg("sendMessage", {
      chat_id: chatId,
      text: "🎯 ИИ подбирает рекомендации...",
    });
    const msgId = tmp?.result?.message_id;

    try {
      const recs = await ai.recommend(
        history.map((h) => ({ title: h.title, genres: h.genres || "" })),
      );

      const results = [];
      for (const rec of recs) {
        const queries = [rec.query, rec.title_ru, rec.title_en].filter(Boolean);
        if (!queries.length) continue;
        try {
          const found = await search.search(queries);
          if (found.length) {
            results.push({ ...found[0], reason: rec.reason });
          }
        } catch {}
      }

      if (!results.length) {
        return editOrSend(chatId, msgId, "❌ Не нашёл подходящего на сайте");
      }

      let text = "🎯 *Рекомендации для тебя:*\n\n";
      const kb = [];

      results.forEach((r, i) => {
        text += `${i + 1}. *${r.title}*`;
        if (r.rating) text += ` ★${r.rating}`;
        text += `\n💡 _${r.reason}_\n\n`;
        kb.push([
          {
            text: `▶ ${r.title}`,
            callback_data: `watch:${user.id}:${r.id}`,
          },
        ]);
      });

      await editOrSend(chatId, msgId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: kb },
      });
    } catch (e) {
      await editOrSend(chatId, msgId, "❌ " + e.message);
    }
  },

  /* ── /random ── */
  async cmdRandom(chatId, user) {
    const r = await search.random();
    if (!r) {
      return tg("sendMessage", {
        chat_id: chatId,
        text: "❌ Не получилось, попробуйте ещё раз",
      });
    }

    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "Markdown",
      text: `🎲 *${r.title}*${r.rating ? "\n★ " + r.rating : ""}${r.genres?.length ? "\n" + r.genres.slice(0, 3).join(", ") : ""}`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "▶ Смотреть", callback_data: `watch:${user.id}:${r.id}` },
            { text: "🎲 Ещё", callback_data: `random:${user.id}` },
          ],
        ],
      },
    });
  },

  /* ── /help ── */
  async cmdHelp(chatId) {
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "Markdown",
      text:
        `📖 *AniPilot — Команды*\n\n` +
        `/connect — Привязать скрипт\n` +
        `/status — Текущий статус + плеер\n` +
        `/search <запрос> — ИИ-поиск\n` +
        `/recommend — ИИ-рекомендации\n` +
        `/random — Случайное аниме\n` +
        `/marathon — Марафон\n` +
        `/stats — Статистика\n\n` +
        `💡 Просто напишите название — я найду!`,
    });
  },

  /* ════════════════════════════
       Callbacks
       ════════════════════════════ */
  async onCallback(cbq) {
    const data = cbq.data || "";
    const chatId = cbq.message?.chat?.id;
    const msgId = cbq.message?.message_id;
    const parts = data.split(":");
    const action = parts[0];
    const rawUid = parts[1];
    const extra = parts[2];
    const userId = parseInt(rawUid);

    await tg("answerCallbackQuery", { callback_query_id: cbq.id });

    if (!userId || isNaN(userId)) return;
    const user = await db.getUserById(userId);
    if (!user) return;

    // Check script online status
    const state = await db.getState(userId);
    const isOn =
      state?.is_online && Date.now() - (state?.last_heartbeat || 0) < 120000;
    const hint = isOn ? "" : "\n📋 Команда в очереди — откройте animix.lol";

    switch (action) {
      case "connect":
        return Bot.cmdConnect(chatId, user);

      case "resume":
        await db.addCommand(userId, "resume", {
          url: state?.current_url,
          time: state?.video_time,
        });
        await tg("sendMessage", {
          chat_id: chatId,
          text: `▶ Продолжаем...${hint}`,
        });
        break;

      case "next":
        await db.addCommand(userId, "next_episode", {});
        await tg("sendMessage", {
          chat_id: chatId,
          text: `⏭ Следующая серия...${hint}`,
        });
        break;

      case "play":
        await db.addCommand(userId, "play", {});
        await tg("sendMessage", {
          chat_id: chatId,
          text: `▶ Воспроизведение${hint}`,
        });
        break;

      case "pause":
        await db.addCommand(userId, "pause", {});
        await tg("sendMessage", {
          chat_id: chatId,
          text: `⏸ Пауза${hint}`,
        });
        break;

      case "watch": {
        const animeId = extra;
        if (!animeId) break;
        await db.addCommand(userId, "navigate", {
          animeId: animeId,
          season: 1,
          episode: 1,
          url: search.url(animeId),
        });
        await tg("sendMessage", {
          chat_id: chatId,
          text: `▶ Открываем...${hint}`,
        });
        break;
      }

      case "mstart":
        await db.addCommand(userId, "marathon_start", {});
        await tg("sendMessage", {
          chat_id: chatId,
          text: `▶ Марафон запущен!${hint}`,
        });
        break;

      case "mstop":
        await db.addCommand(userId, "marathon_stop", {});
        await tg("sendMessage", {
          chat_id: chatId,
          text: "⏹ Марафон остановлен",
        });
        break;

      case "mcont":
        await db.addCommand(userId, "marathon_continue", {});
        await tg("sendMessage", {
          chat_id: chatId,
          text: `▶ Продолжаем марафон...${hint}`,
        });
        break;

      case "mnext":
        await db.addCommand(userId, "marathon_next", {});
        await tg("sendMessage", {
          chat_id: chatId,
          text: `⏭ Следующий...${hint}`,
        });
        break;

      case "mclear":
        await db.upsertState(userId, {
          marathon_queue: [],
          marathon_on: false,
          marathon_idx: 0,
        });
        await db.addCommand(userId, "marathon_clear", {});
        await tg("sendMessage", {
          chat_id: chatId,
          text: "🗑 Марафон очищен",
        });
        break;

      case "random":
        return Bot.cmdRandom(chatId, user);

      case "status_refresh":
        // Edit existing message with fresh status
        try {
          const freshState = await db.getState(userId);
          const freshOnline =
            freshState?.is_online &&
            Date.now() - (freshState?.last_heartbeat || 0) < 120000;
          let t = `📊 *Статус* (обновлено)\n\n${freshOnline ? "🟢" : "🔴"} Скрипт: ${freshOnline ? "онлайн" : "офлайн"}\n`;

          if (freshState?.current_anime?.title) {
            t += `🎬 ${freshState.current_anime.title} С${freshState.current_season || "?"}Е${freshState.current_episode || "?"}\n`;
            t += `${freshState.is_playing ? "▶ Играет" : "⏸ Пауза"}`;
            if (freshState.video_time > 0)
              t += ` — ${fmtTime(freshState.video_time)}`;
            t += "\n";
          }
          t += `\n🔥 Сегодня: ${freshState?.binge_today || 0} серий · ${freshState?.watch_minutes || 0}м`;

          const kb = [];
          if (freshOnline && freshState?.current_anime?.title) {
            kb.push([
              {
                text: freshState.is_playing ? "⏸ Пауза" : "▶ Плей",
                callback_data: `${freshState.is_playing ? "pause" : "play"}:${userId}`,
              },
              { text: "⏭ След.", callback_data: `next:${userId}` },
            ]);
          }
          kb.push([
            { text: "🔄 Обновить", callback_data: `status_refresh:${userId}` },
          ]);

          await tg("editMessageText", {
            chat_id: chatId,
            message_id: msgId,
            text: t,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: kb },
          });
        } catch {}
        break;

      case "mnew":
      case "search":
      case "menu":
        if (WEBAPP_URL) {
          await tg("sendMessage", {
            chat_id: chatId,
            text: "🎬 Открывайте:",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🎬 AniPilot",
                    web_app: { url: WEBAPP_URL },
                  },
                ],
              ],
            },
          });
        }
        break;

      case "check": {
        const fresh = await db.getState(userId);
        const on =
          fresh?.is_online &&
          Date.now() - (fresh?.last_heartbeat || 0) < 120000;
        await tg("sendMessage", {
          chat_id: chatId,
          text: on
            ? "🟢 Скрипт онлайн!"
            : "🔴 Скрипт офлайн. Откройте animix.lol",
        });
        break;
      }

      case "stats":
        return Bot.cmdStats(chatId, user);
    }
  },
};

module.exports = Bot;
