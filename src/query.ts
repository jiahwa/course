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
  updatedAt: string | null;
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
      `SELECT co.id, co.slug, co.title, co.discipline, co.summary,
              (SELECT count(*) FROM chapters ch WHERE ch.course_id = co.id) AS chapters,
              (SELECT max(updated_at) FROM chapters ch WHERE ch.course_id = co.id) AS updated_at
       FROM courses co
       ORDER BY co.discipline, co.sort_order, co.title`,
    )
    .all() as any[];

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    discipline: r.discipline,
    summary: r.summary ?? "",
    chapters: r.chapters,
    updatedAt: r.updated_at ?? null,
  }));
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
