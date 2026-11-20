-- course 基线库结构（0001）
-- 定位：多课程查阅库。不是学习流，没有复习排程、没有连续天数。
-- 内容在库：chapters 存全文，chapters_fts 是检索副本。md 只是编辑源。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 站点开关与杂项配置（gate 落在这里，不在文件里）
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 课程：多课程并列。discipline 用于按学科分组，不枚举，靠数据约束
CREATE TABLE courses (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  discipline  TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_courses_discipline ON courses(discipline, sort_order);

-- 章节：body_md 是完整正文，不是指针。content_hash 用于和 md 源对账
CREATE TABLE chapters (
  id           INTEGER PRIMARY KEY,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body_md      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  words        INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  UNIQUE (course_id, slug)
);

CREATE INDEX idx_chapters_course ON chapters(course_id, sort_order);

-- 浏览记录：一章一行，只记事实，不做评分、不做打卡
CREATE TABLE views (
  chapter_id      INTEGER PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  opens           INTEGER NOT NULL DEFAULT 1,
  seconds         INTEGER NOT NULL DEFAULT 0,
  first_opened_at TEXT NOT NULL,
  last_opened_at  TEXT NOT NULL
);

CREATE INDEX idx_views_last ON views(last_opened_at DESC);

-- 行为日志：追加写，只记事件不记正文
CREATE TABLE events (
  id      INTEGER PRIMARY KEY,
  kind    TEXT NOT NULL,
  ref     TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  at      TEXT NOT NULL
);

CREATE INDEX idx_events_kind ON events(kind, at);

-- 检索副本：trigram 对中文子串有效，两字以内的查询在应用层回退到 LIKE
CREATE VIRTUAL TABLE chapters_fts USING fts5(
  title,
  body_md,
  content='chapters',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER chapters_ai AFTER INSERT ON chapters BEGIN
  INSERT INTO chapters_fts(rowid, title, body_md) VALUES (new.id, new.title, new.body_md);
END;

CREATE TRIGGER chapters_ad AFTER DELETE ON chapters BEGIN
  INSERT INTO chapters_fts(chapters_fts, rowid, title, body_md)
  VALUES ('delete', old.id, old.title, old.body_md);
END;

CREATE TRIGGER chapters_au AFTER UPDATE ON chapters BEGIN
  INSERT INTO chapters_fts(chapters_fts, rowid, title, body_md)
  VALUES ('delete', old.id, old.title, old.body_md);
  INSERT INTO chapters_fts(rowid, title, body_md) VALUES (new.id, new.title, new.body_md);
END;
