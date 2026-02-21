-- ═══════════════════════════════════════════
-- AniPilot — Database Schema
-- Запустить ОДИН раз в Supabase SQL Editor
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    telegram_id   BIGINT UNIQUE NOT NULL,
    token         TEXT UNIQUE,
    username      TEXT DEFAULT '',
    connect_code  TEXT,
    code_expires  BIGINT DEFAULT 0,
    created_at    BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
    notify_crash    BOOLEAN DEFAULT true,
    notify_marathon BOOLEAN DEFAULT true,
    notify_offline  BOOLEAN DEFAULT true,
    notify_digest   BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS state (
    user_id         INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    is_online       BOOLEAN DEFAULT false,
    last_heartbeat  BIGINT DEFAULT 0,
    current_url     TEXT DEFAULT '',
    current_anime   JSONB DEFAULT 'null'::JSONB,
    current_season  INT DEFAULT 0,
    current_episode INT DEFAULT 0,
    video_time      REAL DEFAULT 0,
    video_duration  REAL DEFAULT 0,
    is_playing      BOOLEAN DEFAULT false,
    marathon_on     BOOLEAN DEFAULT false,
    marathon_idx    INT DEFAULT 0,
    marathon_queue  JSONB DEFAULT '[]'::JSONB,
    history         JSONB DEFAULT '[]'::JSONB,
    binge_today     INT DEFAULT 0,
    binge_date      TEXT DEFAULT '',
    watch_minutes   INT DEFAULT 0,
    notified_offline BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS commands (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    payload     JSONB DEFAULT '{}'::JSONB,
    created_at  BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
    executed    BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS notifications (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    sent_at     BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_cmd_pending ON commands(user_id, executed) WHERE executed = false;
CREATE INDEX IF NOT EXISTS idx_notif_spam ON notifications(user_id, type, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_online ON state(last_heartbeat) WHERE is_online = true;
CREATE INDEX IF NOT EXISTS idx_users_code ON users(connect_code) WHERE connect_code IS NOT NULL;