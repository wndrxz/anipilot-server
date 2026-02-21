const express = require("express");
const router = express.Router();
const db = require("./db");
const auth = require("./auth");
const notify = require("./notify");
const ai = require("./ai");
const search = require("./search");
const lazyCron = require("./cron");

// Lazy cron on every request (throttled inside)
router.use((req, res, next) => {
  lazyCron().catch(() => {});
  next();
});

/* ═══════════════════════════════════
   UserScript API (JWT auth)
   ═══════════════════════════════════ */

// Auth: code → token
router.post("/auth/verify", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "No code" });

    const user = await db.findByCode(code.toUpperCase().replace(/\s/g, ""));
    if (!user)
      return res.status(404).json({ error: "Invalid or expired code" });

    const token = auth.signToken(user.id, user.telegram_id);
    await db.setToken(user.id, token);

    await notify.tg("sendMessage", {
      chat_id: user.telegram_id,
      text: "✅ *Скрипт привязан!*\nAniPilot подключён к Telegram.",
      parse_mode: "Markdown",
    });

    res.json({
      ok: true,
      token,
      telegramId: user.telegram_id,
      username: user.username,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Heartbeat + state sync
router.post("/heartbeat", auth.userAuth, async (req, res) => {
  try {
    const { state: s } = req.body;
    const upd = {
      is_online: true,
      last_heartbeat: Date.now(),
      notified_offline: false,
    };

    if (s) {
      if (s.url != null) upd.current_url = s.url;
      if (s.anime != null) upd.current_anime = s.anime;
      if (s.season != null) upd.current_season = s.season;
      if (s.episode != null) upd.current_episode = s.episode;
      if (s.videoTime != null) upd.video_time = s.videoTime;
      if (s.videoDuration != null) upd.video_duration = s.videoDuration;
      if (s.playing != null) upd.is_playing = s.playing;
      if (s.marathonOn != null) upd.marathon_on = s.marathonOn;
      if (s.marathonIdx != null) upd.marathon_idx = s.marathonIdx;
      if (s.marathonQueue != null) upd.marathon_queue = s.marathonQueue;
      if (s.history != null)
        upd.history = Array.isArray(s.history) ? s.history : [];
      if (s.binge != null) upd.binge_today = s.binge;
      if (s.bingeDate != null) upd.binge_date = s.bingeDate;
      if (s.watchMinutes != null) upd.watch_minutes = s.watchMinutes;
    }

    await db.upsertState(req.user.id, upd);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get pending commands (polling)
router.get("/commands", auth.userAuth, async (req, res) => {
  try {
    res.json({ commands: await db.getPending(req.user.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mark command done
router.post("/commands/:id/done", auth.userAuth, async (req, res) => {
  try {
    await db.markDone(parseInt(req.params.id), req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Event (crash, complete, etc.)
router.post("/event", auth.userAuth, async (req, res) => {
  try {
    const { type, payload } = req.body;
    if (!type) return res.status(400).json({ error: "No type" });
    await notify.send(req.user.id, type, payload || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Script going offline
router.post("/offline", auth.userAuth, async (req, res) => {
  try {
    await db.upsertState(req.user.id, { is_online: false });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Recommendations (UserScript JWT auth)
router.post("/recommend", auth.userAuth, async (req, res) => {
  try {
    const { history } = req.body;

    let hist = history;
    if (!hist || hist.length < 2) {
      // Fallback: get from state
      const state = await db.getState(req.user.id);
      const h = state?.history || [];
      if (h.length < 2)
        return res.status(400).json({ error: "Need 2+ watched anime" });
      hist = h
        .slice(0, 10)
        .map((x) => ({ title: x.title, genres: x.genres || "" }));
    }

    const recs = await ai.recommend(hist.slice(0, 10));
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

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════
   Mini App API (initData auth)
   ═══════════════════════════════════ */

// Get state
router.get("/webapp/state", auth.miniAuth, async (req, res) => {
  try {
    const state = await db.getState(req.user.id);
    const scriptOnline =
      state?.is_online && Date.now() - (state?.last_heartbeat || 0) < 120000;
    res.json({
      ok: true,
      state: { ...state, scriptOnline },
      user: { id: req.user.id, username: req.user.username },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI search
router.post("/webapp/search", auth.miniAuth, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "No query" });

    const aiRes = await ai.ask(query);
    if (!aiRes.found) {
      return res.json({
        ok: true,
        found: false,
        suggestions: aiRes.suggestions,
      });
    }

    const queries = [
      ...(aiRes.search_queries || []),
      aiRes.title_ru,
      aiRes.title_en,
      query,
    ].filter(Boolean);
    const results = await search.search(queries);

    results.forEach((r) => {
      if (aiRes.confidence >= 85) r.aiCf = aiRes.confidence;
      if (aiRes.desc) r.desc = aiRes.desc;
    });

    res.json({
      ok: true,
      found: true,
      ai: {
        title: aiRes.title_ru || aiRes.title_en,
        confidence: aiRes.confidence,
        desc: aiRes.desc,
      },
      results,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send command to script
router.post("/webapp/command", auth.miniAuth, async (req, res) => {
  try {
    const { type, payload } = req.body;
    if (!type) return res.status(400).json({ error: "No type" });

    await db.addCommand(req.user.id, type, payload || {});
    const state = await db.getState(req.user.id);
    const scriptOnline =
      state?.is_online && Date.now() - (state?.last_heartbeat || 0) < 120000;
    res.json({ ok: true, scriptOnline });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marathon management
router.post("/webapp/marathon", auth.miniAuth, async (req, res) => {
  try {
    const { action, payload } = req.body;
    const state = await db.getState(req.user.id);

    switch (action) {
      case "add": {
        const q = state?.marathon_queue || [];
        if (q.find((x) => x.id === payload?.id)) {
          return res.json({ ok: true, msg: "exists" });
        }
        q.push(payload);
        await db.upsertState(req.user.id, { marathon_queue: q });
        await db.addCommand(req.user.id, "marathon_sync", { queue: q });
        break;
      }
      case "remove": {
        const q = (state?.marathon_queue || []).filter(
          (x) => x.id !== payload?.id,
        );
        await db.upsertState(req.user.id, { marathon_queue: q });
        await db.addCommand(req.user.id, "marathon_sync", { queue: q });
        break;
      }
      case "reorder":
        await db.upsertState(req.user.id, {
          marathon_queue: payload?.queue || [],
        });
        await db.addCommand(req.user.id, "marathon_sync", {
          queue: payload?.queue || [],
        });
        break;
      case "start":
        await db.addCommand(req.user.id, "marathon_start", {});
        break;
      case "stop":
        await db.addCommand(req.user.id, "marathon_stop", {});
        break;
      case "next":
        await db.addCommand(req.user.id, "marathon_next", {});
        break;
      case "clear":
        await db.upsertState(req.user.id, {
          marathon_queue: [],
          marathon_on: false,
          marathon_idx: 0,
        });
        await db.addCommand(req.user.id, "marathon_clear", {});
        break;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Notification settings — get
router.get("/webapp/settings", auth.miniAuth, async (req, res) => {
  try {
    const u = req.user;
    res.json({
      ok: true,
      connected: !!u.token,
      settings: {
        notify_crash: u.notify_crash,
        notify_marathon: u.notify_marathon,
        notify_offline: u.notify_offline,
        notify_digest: u.notify_digest,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Notification settings — save
router.post("/webapp/settings", auth.miniAuth, async (req, res) => {
  try {
    const allow = [
      "notify_crash",
      "notify_marathon",
      "notify_offline",
      "notify_digest",
    ];
    const upd = {};
    for (const k of allow) {
      if (req.body[k] !== undefined) upd[k] = !!req.body[k];
    }
    if (Object.keys(upd).length) {
      await db.updateSettings(req.user.id, upd);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Recommendations (Mini App)
router.post("/webapp/recommend", auth.miniAuth, async (req, res) => {
  try {
    let hist = req.body.history;

    if (!hist || hist.length < 2) {
      // Fallback: get from saved state
      const state = await db.getState(req.user.id);
      const h = state?.history || [];
      if (h.length < 2) {
        return res
          .status(400)
          .json({ error: "Need watch history (min 2 anime)" });
      }
      hist = h
        .slice(0, 10)
        .map((x) => ({ title: x.title, genres: x.genres || "" }));
    }

    const recs = await ai.recommend(hist.slice(0, 10));
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

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Random anime
router.get("/webapp/random", auth.miniAuth, async (req, res) => {
  try {
    res.json({ ok: true, result: await search.random() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
