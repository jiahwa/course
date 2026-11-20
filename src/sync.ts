// 内容管道：content/<课程>/<章节>.md → 库。
//
// 身份规则（本文件的全部要点）：课程与章节各有一个 uid，在创建那一刻写进 md 的
// front matter，之后永不修改。slug、标题、所属课程都只是可变属性——改名、挪目录、
// 换课程，认的都是 uid，所以 id 不变、浏览记录不断。
//
// 只认 uid，不看路径：md 里没有 uid 就是一次新建，由 sync 分配一个并写回文件。
// 路径不参与身份判断，所以删掉 uid 行 = 主动放弃旧身份、重新开一条。
//
// sync 只在「md 里还没有 uid」时补写一次 uid，之后不再改文件。库里没有被任何 md
// 认领的 uid 只报孤儿，不删除，避免一次 sync 误删内容。

import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb, nowIso } from "./db/index.ts";

type Front = { data: Record<string, string>; body: string };

export function parseFront(text: string): Front {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text.trim() };

  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { data, body: text.slice(m[0].length).trim() };
}

export function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// 粗略字数：去掉空白后的字符数。中文按字、英文按字符，不做分词，够用于列表展示。
function countWords(body: string): number {
  return body.replace(/\s+/g, "").length;
}

function newUid(prefix: "c" | "h"): string {
  return `${prefix}${randomBytes(6).toString("hex")}`;
}

// 只做一处最小插入：把 uid 加进 front matter 末尾，正文与其余字段保持原样。
export function injectUid(raw: string, uid: string): string {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  if (!m) return `---\nuid: ${uid}\n---\n\n${raw}`;
  const header = m[1].replace(/\r/g, "");
  return `---\n${header}\nuid: ${uid}\n---\n` + raw.slice(m[0].length);
}

export type SyncStats = {
  courses: { created: number; updated: number; unchanged: number };
  chapters: { created: number; updated: number; unchanged: number };
  skipped: string[];
  orphans: string[];
  conflicts: string[];
  wroteUid: string[];
};

type CourseRow = {
  id: number;
  uid: string | null;
  slug: string;
  title: string;
  discipline: string;
  summary: string;
  source: string;
  sort_order: number;
};

type ChapterRow = {
  id: number;
  uid: string | null;
  course_id: number;
  slug: string;
  title: string;
  content_hash: string;
  sort_order: number;
};

export function syncContent(db: DatabaseSync, contentDir: string): SyncStats {
  const stats: SyncStats = {
    courses: { created: 0, updated: 0, unchanged: 0 },
    chapters: { created: 0, updated: 0, unchanged: 0 },
    skipped: [],
    orphans: [],
    conflicts: [],
    wroteUid: [],
  };

  if (!existsSync(contentDir)) return stats;

  const now = nowIso();
  const seenChapterUids = new Map<string, string>();

  const dirs = readdirSync(contentDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  for (const dir of dirs) {
    const courseFile = join(contentDir, dir, "_course.md");
    if (!existsSync(courseFile)) {
      stats.skipped.push(`${dir}/（缺 _course.md）`);
      continue;
    }

    const rawCourse = readFileSync(courseFile, "utf8");
    const c = parseFront(rawCourse);
    const title = c.data.title?.trim();
    if (!title) {
      stats.skipped.push(`${dir}/（_course.md 缺 title）`);
      continue;
    }

    const discipline = c.data.discipline ?? "未分类";
    const summary = c.data.summary ?? "";
    const source = c.data.source ?? "";
    const sortOrder = Number(c.data.order ?? 0) || 0;

    // 认身份只看 uid：写了就按它认，没写就是新建（下面分配一个新 uid）。
    const mdUid = c.data.uid?.trim() ?? "";
    const targetUid = mdUid || newUid("c");
    const courseRow = db.prepare("SELECT * FROM courses WHERE uid = ?").get(targetUid) as CourseRow | undefined;

    let courseId: number;

    if (courseRow) {
      courseId = courseRow.id;
      const changed =
        courseRow.slug !== dir ||
        courseRow.title !== title ||
        courseRow.discipline !== discipline ||
        courseRow.summary !== summary ||
        courseRow.source !== source ||
        courseRow.sort_order !== sortOrder;

      if (changed) {
        try {
          db.prepare(
            `UPDATE courses SET uid = ?, slug = ?, title = ?, discipline = ?, summary = ?, source = ?, sort_order = ?, updated_at = ?
             WHERE id = ?`,
          ).run(targetUid, dir, title, discipline, summary, source, sortOrder, now, courseId);
          stats.courses.updated += 1;
        } catch (e) {
          stats.conflicts.push(`${dir}/（slug 或 uid 与其它课程冲突，未更新）`);
          continue;
        }
      } else {
        stats.courses.unchanged += 1;
      }
    } else {
      try {
        const r = db
          .prepare(
            `INSERT INTO courses (uid, slug, title, discipline, summary, source, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(targetUid, dir, title, discipline, summary, source, sortOrder, now, now);
        courseId = Number(r.lastInsertRowid);
        stats.courses.created += 1;
      } catch (e) {
        const holder = db.prepare("SELECT uid FROM courses WHERE slug = ?").get(dir) as { uid: string } | undefined;
        stats.conflicts.push(
          `${dir}/（未写入：库里这个目录已被 uid ${holder?.uid ?? "?"} 占用——把该 uid 写回 _course.md 即可恢复，或换目录名另开一门）`,
        );
        continue;
      }
    }

    if (!mdUid) {
      const next = injectUid(rawCourse, targetUid);
      writeFileSync(courseFile, next, "utf8");
      stats.wroteUid.push(`${dir}/_course.md`);
    }

    const files = readdirSync(join(contentDir, dir), { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith(".md") && f.name !== "_course.md")
      .map((f) => f.name)
      .sort();

    for (const file of files) {
      const slug = file.replace(/\.md$/, "");
      const path = `${dir}/${slug}`;
      const filePath = join(contentDir, dir, file);
      const raw = readFileSync(filePath, "utf8");
      const { data, body } = parseFront(raw);
      const chapterTitle = data.title?.trim() || slug;
      const order = Number(data.order ?? 0) || 0;
      const hash = hashOf(body);
      const words = countWords(body);

      const mdUid = data.uid?.trim() ?? "";
      const targetUid = mdUid || newUid("h");

      if (seenChapterUids.has(targetUid)) {
        stats.conflicts.push(`${path}（uid ${targetUid} 已被 ${seenChapterUids.get(targetUid)} 占用）`);
        continue;
      }
      seenChapterUids.set(targetUid, path);

      const row = db.prepare("SELECT * FROM chapters WHERE uid = ?").get(targetUid) as ChapterRow | undefined;

      if (row) {
        const changed =
          row.course_id !== courseId ||
          row.slug !== slug ||
          row.title !== chapterTitle ||
          row.content_hash !== hash ||
          row.sort_order !== order;

        if (changed) {
          db.prepare(
            `UPDATE chapters SET uid = ?, course_id = ?, slug = ?, title = ?, body_md = ?, content_hash = ?, sort_order = ?, words = ?, updated_at = ?
             WHERE id = ?`,
          ).run(targetUid, courseId, slug, chapterTitle, body, hash, order, words, now, row.id);
          stats.chapters.updated += 1;
        } else {
          stats.chapters.unchanged += 1;
        }
      } else {
        try {
          db.prepare(
            `INSERT INTO chapters (uid, course_id, slug, title, body_md, content_hash, sort_order, words, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(targetUid, courseId, slug, chapterTitle, body, hash, order, words, now);
          stats.chapters.created += 1;
        } catch (e) {
          const holder = db
            .prepare("SELECT uid FROM chapters WHERE course_id = ? AND slug = ?")
            .get(courseId, slug) as { uid: string } | undefined;
          stats.conflicts.push(
            `${path}（未写入：库里这个路径已被 uid ${holder?.uid ?? "?"} 占用——把该 uid 写回 md 的 uid 行即可恢复，或改文件名另开一章）`,
          );
          continue;
        }
      }

      if (!mdUid) {
        writeFileSync(filePath, injectUid(raw, targetUid), "utf8");
        stats.wroteUid.push(`${path}.md`);
      }
    }

    // _course.md 分隔线之后不放正文；写了也不入库，只报一条跳过。
    if (c.body.trim()) stats.skipped.push(`${dir}/_course.md（正文部分不会入库）`);
  }

  const all = db
    .prepare(
      `SELECT ch.uid AS uid, co.slug AS c, ch.slug AS s FROM chapters ch JOIN courses co ON co.id = ch.course_id`,
    )
    .all() as { uid: string; c: string; s: string }[];
  stats.orphans = all.filter((r) => !seenChapterUids.has(r.uid)).map((r) => `${r.c}/${r.s}`);

  return stats;
}

function main() {
  const args = process.argv.slice(2);
  const contentDir = args.find((a) => !a.startsWith("--")) ?? join(import.meta.dirname, "..", "content");
  const db = getDb();
  const stats = syncContent(db, contentDir);

  console.log(`[sync] 课程：新增 ${stats.courses.created}，更新 ${stats.courses.updated}，未变 ${stats.courses.unchanged}`);
  console.log(`[sync] 章节：新增 ${stats.chapters.created}，更新 ${stats.chapters.updated}，未变 ${stats.chapters.unchanged}`);
  console.log(`[sync] 身份：已为 ${stats.wroteUid.length} 个文件补写 uid（创建时定，之后只认它）`);

  if (stats.skipped.length) {
    console.log(`[sync] 跳过 ${stats.skipped.length} 项：`);
    for (const s of stats.skipped) console.log(`  - ${s}`);
  }

  if (stats.conflicts.length) {
    console.log(`[sync] 冲突 ${stats.conflicts.length} 条（未写入）：`);
    for (const s of stats.conflicts) console.log(`  - ${s}`);
  }

  if (stats.orphans.length) {
    console.log(`[sync] 库中 ${stats.orphans.length} 章没有被任何 md 认领（未删除）：`);
    for (const o of stats.orphans) console.log(`  - ${o}`);
  }
}

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (isMain) main();
