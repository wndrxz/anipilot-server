const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY, // service_role → обходит RLS
);

const DB = {
  /* ── Init ── */
  async init() {
    const { error } = await supabase.from("users").select("id").limit(1);
    if (error) throw new Error(`DB: ${error.message}`);
    console.log("[DB] ✓ Supabase connected");
  },

  /* ── Users ── */
  async getUserByTg(tgId) {
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", tgId)
      .maybeSingle();
    return data;
  },

  async getUserByToken(token) {
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    return data;
  },

  async getUserById(id) {
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data;
  },

  async getOrCreateUser(tgId, username) {
    let user = await DB.getUserByTg(tgId);
    if (user) return user;

    const { data, error } = await supabase
      .from("users")
      .insert({ telegram_id: tgId, username: username || "" })
      .select()
      .single();
    if (error) throw error;

    // Создать строку state
    await supabase
      .from("state")
      .insert({ user_id: data.id })
      .catch(() => {});
    return data;
  },

  async setConnectCode(userId, code, expires) {
    await supabase
      .from("users")
      .update({ connect_code: code, code_expires: expires })
      .eq("id", userId);
  },

  async findByCode(code) {
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("connect_code", code)
      .gt("code_expires", Date.now())
      .maybeSingle();
    return data;
  },

  async setToken(userId, token) {
    await supabase
      .from("users")
      .update({ token, connect_code: null, code_expires: 0 })
      .eq("id", userId);
  },

  async updateSettings(userId, fields) {
    await supabase.from("users").update(fields).eq("id", userId);
  },

  /* ── State ── */
  async getState(userId) {
    const { data } = await supabase
      .from("state")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    return data;
  },

  async upsertState(userId, patch) {
    const { error } = await supabase
      .from("state")
      .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
    if (error) console.error("[DB] upsertState:", error.message);
  },

  /* ── Commands ── */
  async addCommand(userId, type, payload = {}) {
    const { data } = await supabase
      .from("commands")
      .insert({ user_id: userId, type, payload })
      .select("id")
      .single();
    return data;
  },

  async getPending(userId) {
    const { data } = await supabase
      .from("commands")
      .select("*")
      .eq("user_id", userId)
      .eq("executed", false)
      .order("created_at")
      .limit(10);
    return data || [];
  },

  async markDone(cmdId, userId) {
    await supabase
      .from("commands")
      .delete() // удаляем, не просто помечаем
      .eq("id", cmdId)
      .eq("user_id", userId);
  },

  async cleanOldCommands() {
    await supabase
      .from("commands")
      .delete()
      .lt("created_at", Date.now() - 3600000);
  },

  /* ── Notifications (антиспам) ── */
  async canNotify(userId, type, cooldownMs = 300000) {
    const { data } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", type)
      .gt("sent_at", Date.now() - cooldownMs)
      .limit(1);
    return !data || data.length === 0;
  },

  async logNotification(userId, type) {
    await supabase.from("notifications").insert({ user_id: userId, type });
  },

  async cleanOldNotifications() {
    await supabase
      .from("notifications")
      .delete()
      .lt("sent_at", Date.now() - 86400000);
  },

  /* ── Offline detection ── */
  async getStaleOnline(thresholdMs = 600000) {
    const { data } = await supabase
      .from("state")
      .select("user_id, current_anime")
      .eq("is_online", true)
      .eq("notified_offline", false)
      .lt("last_heartbeat", Date.now() - thresholdMs);
    return data || [];
  },
};

module.exports = DB;
