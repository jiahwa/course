// 只读查询与浏览记录。这一层不碰 HTTP，服务端和 bench 都可以复用。
// 检索走 FTS5 trigram；两字以内的中文查询 trigram 命不中，回退 LIKE。

import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "./db/index.ts";

export type CourseRow = {
  id: number;
  slug: string;
  title: string;
  discipline: string;
  summary: string;
  chapters: number;
  shelfId: number | null;
  updatedAt: string | null;
};

export type ShelfRow = {
  id: number;
  uid: string;
  name: string;
  ord: number;
  courses: CourseRow[];
};

export type SearchHit = {
  id: number;
  courseSlug: string;
  courseTitle: string;
  slug: string;
  title: string;
  snippet: string;
};

export type RecentItem = {
  id: number;
  courseSlug: string;
  courseTitle: string;
  slug: string;
  title: string;
  opens: number;
  lastOpenedAt: string;
};

export function listCourses(db: DatabaseSync): CourseRow[] {
  const rows = db
    .prepare(
      `SELECT co.id, co.slug, co.title, co.discipline, co.summary, co.shelf_id,
              (SELECT count(*) FROM chapters ch WHERE ch.course_id = co.id) AS chapters,
              (SELECT max(updated_at) FROM chapters ch WHERE ch.course_id = co.id) AS updated_at
       FROM courses co
       ORDER BY co.sort_order, co.discipline, co.title`,
    )
    .all() as any[];

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    discipline: r.discipline,
    summary: r.summary ?? "",
    chapters: r.chapters,
    shelfId: r.shelf_id ?? null,
    updatedAt: r.updated_at ?? null,
  }));
}

export function listShelves(db: DatabaseSync): ShelfRow[] {
  const shelves = db.prepare("SELECT id, uid, name, ord FROM shelves ORDER BY ord").all() as {
    id: number;
    uid: string;
    name: string;
    ord: number;
  }[];
  const courses = listCourses(db);
  return shelves.map((s) => ({
    id: s.id,
    uid: s.uid,
    name: s.name,
    ord: s.ord,
    courses: courses.filter((c) => c.shelfId === s.id),
  }));
}

// 建一层，放在最上面。层名只是给眼睛看的，不参与任何判断。
export function createShelf(db: DatabaseSync, name?: string, position: "top" | "bottom" = "top") {
  // 往上一层：接在最上面；往下一层：插在最下面（ORD 取 min-1，层号越大越靠上）。
  const edge = position === "bottom"
    ? (db.prepare("SELECT COALESCE(min(ord), 1) AS m FROM shelves").get() as { m: number })
    : (db.prepare("SELECT COALESCE(max(ord), 0) AS m FROM shelves").get() as { m: number });
  const ord = position === "bottom" ? Number(edge.m) - 1 : Number(edge.m) + 1;
  const uid = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const total = (db.prepare("SELECT count(*) AS n FROM shelves").get() as { n: number }).n;
  const finalName = (name ?? "").trim() || `第 ${Number(total) + 1} 层`;
  const info = db
    .prepare("INSERT INTO shelves (uid, name, ord, created_at) VALUES (?, ?, ?, ?)")
    .run(uid, finalName.slice(0, 40), ord, nowIso());
  return { id: Number(info.lastInsertRowid), uid, name: finalName, ord, courses: [] as CourseRow[] };
}

export function renameShelf(db: DatabaseSync, id: number, rawName: string) {
  const name = rawName.trim().slice(0, 40);
  if (!name) return { error: "层名不能为空" as const };
  const row = db.prepare("SELECT id FROM shelves WHERE id = ?").get(id) as { id: number } | undefined;
  if (!row) return { error: "没有这一层" as const, missing: true };
  db.prepare("UPDATE shelves SET name = ? WHERE id = ?").run(name, id);
  return { id, name };
}

export function deleteShelf(db: DatabaseSync, id: number) {
  const rows = db.prepare("SELECT id, ord, name FROM shelves ORDER BY ord").all() as Array<{ id: number; ord: number; name: string }>;
  if (rows.length <= 1) return { error: "这是最后一层，删了就什么都不剩了" as const };
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return { error: "没有这一层" as const, missing: true };
  const books = (db.prepare("SELECT count(*) AS n FROM courses WHERE shelf_id = ?").get(id) as { n: number }).n;
  if (books > 0) return { error: `这一层还有 ${books} 本书，不能删` as const, notEmpty: true };

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM shelves WHERE id = ?").run(id);
    // 删完把 ord 归一成 1..n，避免以后往下长层时 min(ord) 变成负数。
    const rest = db.prepare("SELECT id FROM shelves ORDER BY ord").all() as Array<{ id: number }>;
    db.prepare("UPDATE shelves SET ord = ord - 1000000").run();
    rest.forEach((r, i) => db.prepare("UPDATE shelves SET ord = ? WHERE id = ?").run(i + 1, r.id));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true, id };
}

export function reorderShelf(db: DatabaseSync, id: number, toIndex: number) {
  const rows = db.prepare("SELECT id, ord FROM shelves ORDER BY ord").all() as Array<{ id: number; ord: number }>;
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return { error: "没有这一层" as const, missing: true };
  if (!Number.isInteger(toIndex)) return { error: "位置不对" as const };
  const list = rows.filter((r) => r.id !== id);
  const at = Math.max(0, Math.min(list.length, toIndex));
  list.splice(at, 0, rows[idx]);
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE shelves SET ord = ord - 1000000").run();
    list.forEach((r, i) => db.prepare("UPDATE shelves SET ord = ? WHERE id = ?").run(i + 1, r.id));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true, id, ord: at + 1, total: list.length };
}

// 层内书换序：只动这一层的 sort_order（连续递增，从该层现值的最小值起），
// 别的层不受影响；同层 = 同一个 shelf_id（含 null 那组）。
export function reorderCourse(db: DatabaseSync, id: number, toIndex: number) {
  const row = db.prepare("SELECT id, shelf_id FROM courses WHERE id = ?").get(id) as
    | { id: number; shelf_id: number | null }
    | undefined;
  if (!row) return { error: "没有这本书" as const, missing: true };
  if (!Number.isInteger(toIndex)) return { error: "位置不对" as const };

  const where = row.shelf_id === null ? "shelf_id IS NULL" : "shelf_id = ?";
  const args = row.shelf_id === null ? [] : [row.shelf_id];
  const rows = db
    .prepare(`SELECT id, sort_order FROM courses WHERE ${where} ORDER BY sort_order, discipline, title`)
    .all(...args) as Array<{ id: number; sort_order: number }>;

  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return { error: "没有这本书" as const, missing: true };
  const list = rows.filter((r) => r.id !== id);
  const at = Math.max(0, Math.min(list.length, toIndex));
  if (at === idx) return { ok: true, id, index: idx + 1, total: rows.length, unchanged: true };

  list.splice(at, 0, rows[idx]);
  const base = rows.reduce((m, r) => Math.min(m, r.sort_order), rows[0].sort_order);
  db.exec("BEGIN");
  try {
    list.forEach((r, i) => db.prepare("UPDATE courses SET sort_order = ? WHERE id = ?").run(base + i, r.id));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true, id, index: at + 1, total: list.length };
}

function cut(text: string, term: string, radius = 56): string {
  const flat = text.replace(/\s+/g, " ");
  const idx = flat.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(flat.length, idx + term.length + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

export function searchChapters(db: DatabaseSync, raw: string, limit = 20): SearchHit[] {
  const term = raw.trim();
  if (!term) return [];

  const base = `
    SELECT ch.id, ch.slug, ch.title, ch.body_md, co.slug AS course_slug, co.title AS course_title
    FROM chapters ch JOIN courses co ON co.id = ch.course_id`;

  let rows: any[];
  if (term.length >= 3) {
    // 短语查询：把用户输入包成引号，避免 * ( ) 之类被当成 FTS 语法
    const phrase = `"${term.replace(/"/g, '""')}"`;
    rows = db
      .prepare(`${base} WHERE ch.id IN (SELECT rowid FROM chapters_fts WHERE chapters_fts MATCH ?) LIMIT ?`)
      .all(phrase, limit) as any[];
  } else {
    const like = `%${term.replace(/[%_]/g, " ")}%`;
    rows = db
      .prepare(`${base} WHERE ch.title LIKE ? OR ch.body_md LIKE ? LIMIT ?`)
      .all(like, like, limit) as any[];
  }

  return rows.map((r) => ({
    id: r.id,
    courseSlug: r.course_slug,
    courseTitle: r.course_title,
    slug: r.slug,
    title: r.title,
    snippet: cut(r.body_md, term),
  }));
}

export function recentViews(db: DatabaseSync, limit = 20): RecentItem[] {
  const rows = db
    .prepare(
      `SELECT ch.id, ch.slug, ch.title, co.slug AS course_slug, co.title AS course_title,
              v.opens, v.last_opened_at
       FROM views v
       JOIN chapters ch ON ch.id = v.chapter_id
       JOIN courses co ON co.id = ch.course_id
       ORDER BY v.last_opened_at DESC LIMIT ?`,
    )
    .all(limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    courseSlug: r.course_slug,
    courseTitle: r.course_title,
    slug: r.slug,
    title: r.title,
    opens: r.opens,
    lastOpenedAt: r.last_opened_at,
  }));
}

export function getChapter(db: DatabaseSync, courseSlug: string, slug: string) {
  const row = db
    .prepare(
      `SELECT ch.id, ch.slug, ch.title, ch.body_md, ch.updated_at,
              co.slug AS course_slug, co.title AS course_title
       FROM chapters ch JOIN courses co ON co.id = ch.course_id
       WHERE co.slug = ? AND ch.slug = ?`,
    )
    .get(courseSlug, slug) as any | undefined;

  if (!row) return null;

  // 上一章 / 下一章：同课程内按 sort_order 取相邻，方便连续翻阅
  const prev = db
    .prepare(
      `SELECT slug, title FROM chapters
       WHERE course_id = (SELECT id FROM courses WHERE slug = ?) AND sort_order < (SELECT sort_order FROM chapters WHERE id = ?)
       ORDER BY sort_order DESC LIMIT 1`,
    )
    .get(courseSlug, row.id) as any | undefined;

  const next = db
    .prepare(
      `SELECT slug, title FROM chapters
       WHERE course_id = (SELECT id FROM courses WHERE slug = ?) AND sort_order > (SELECT sort_order FROM chapters WHERE id = ?)
       ORDER BY sort_order ASC LIMIT 1`,
    )
    .get(courseSlug, row.id) as any | undefined;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body_md,
    course: { slug: row.course_slug, title: row.course_title },
    updatedAt: row.updated_at,
    prev: prev ? { slug: prev.slug, title: prev.title } : null,
    next: next ? { slug: next.slug, title: next.title } : null,
  };
}

export function recordView(db: DatabaseSync, chapterId: number, seconds = 0) {
  const exists = db.prepare("SELECT id FROM chapters WHERE id = ?").get(chapterId);
  if (!exists) return null;

  const at = nowIso();
  db.prepare(
    `INSERT INTO views (chapter_id, opens, seconds, first_opened_at, last_opened_at)
     VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(chapter_id) DO UPDATE SET
       opens = views.opens + 1,
       seconds = views.seconds + excluded.seconds,
       last_opened_at = excluded.last_opened_at`,
  ).run(chapterId, Math.max(0, Math.round(seconds)), at, at);

  db.prepare("INSERT INTO events (kind, ref, payload, at) VALUES (?, ?, ?, ?)").run(
    "chapter.view",
    String(chapterId),
    JSON.stringify({ seconds: Math.max(0, Math.round(seconds)) }),
    at,
  );

  return db.prepare("SELECT chapter_id, opens, seconds, last_opened_at FROM views WHERE chapter_id = ?").get(chapterId);
}

export function getCourse(db: DatabaseSync, slug: string) {
  const co = db
    .prepare("SELECT id, slug, title, discipline, summary, source, updated_at FROM courses WHERE slug = ?")
    .get(slug) as any | undefined;
  if (!co) return null;

  const chapters = db
    .prepare(
      `SELECT ch.id, ch.slug, ch.title, ch.sort_order, ch.words,
              (SELECT count(*) FROM views v WHERE v.chapter_id = ch.id) AS visited
       FROM chapters ch WHERE ch.course_id = ? ORDER BY ch.sort_order, ch.title`,
    )
    .all(co.id) as any[];

  return {
    course: {
      slug: co.slug,
      title: co.title,
      discipline: co.discipline,
      summary: co.summary,
      source: co.source,
      updatedAt: co.updated_at,
    },
    chapters: chapters.map((c, i) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      order: i + 1,
      words: c.words,
      visited: c.visited > 0,
    })),
  };
}
