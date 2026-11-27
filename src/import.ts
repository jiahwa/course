// 导入：把一段文本落成一章 md，然后立刻 sync 入库。
// 唯一入口仍是 md——导入只是替你写文件，不直接写库。

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { slugify, fallbackSlug } from "./pinyin.ts";
import { syncContent } from "./sync.ts";

export class ImportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type ImportInput = {
  title?: string;
  chapterTitle?: string;
  body?: string;
  discipline?: string;
  courseSlug?: string | null;
  shelfId?: number | null;
};

const MAX_BODY = 200_000;

function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
}

function uniqueChapterSlug(dir: string, base: string): string {
  if (!existsSync(join(dir, `${base}.md`))) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existsSync(join(dir, `${candidate}.md`))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function nextOrder(db: DatabaseSync, table: "chapters" | "courses", courseId?: number): number {
  const row =
    table === "chapters"
      ? (db
          .prepare("SELECT COALESCE(max(sort_order), 0) AS m FROM chapters WHERE course_id = ?")
          .get(courseId!) as { m: number })
      : (db.prepare("SELECT COALESCE(max(sort_order), 0) AS m FROM courses").get() as { m: number });
  return Number(row.m) + 1;
}

export function importChapter(db: DatabaseSync, contentDir: string, input: ImportInput) {
  const title = clean(input.title).slice(0, 120);
  const chapterTitle = clean(input.chapterTitle).slice(0, 120) || title;
  const body = clean(input.body);
  const discipline = clean(input.discipline).slice(0, 60) || "未分类";

  if (!title) throw new ImportError(400, "书名不能为空");
  if (!chapterTitle) throw new ImportError(400, "章节名不能为空");
  if (!body) throw new ImportError(400, "正文不能为空");
  if (body.length > MAX_BODY) throw new ImportError(413, `正文超过 ${MAX_BODY} 字符上限`);

  const mode = input.courseSlug ? "attach" : "new";
  let courseSlug: string;
  let courseDir: string;
  let attachTo: number | null = null;

  if (mode === "attach") {
    courseSlug = String(input.courseSlug);
    const row = db.prepare("SELECT id, slug, title FROM courses WHERE slug = ?").get(courseSlug) as
      | { id: number; slug: string; title: string }
      | undefined;
    if (!row) throw new ImportError(404, "目标课程不存在");
    attachTo = row.id;
    courseDir = join(contentDir, courseSlug);
    if (!existsSync(join(courseDir, "_course.md"))) {
      throw new ImportError(409, `课程 ${courseSlug} 没有 _course.md，先补编辑源再导入`);
    }
  } else {
    courseSlug = slugify(title) || fallbackSlug("book");
    courseDir = join(contentDir, courseSlug);
    if (existsSync(courseDir)) throw new ImportError(409, `已存在同名课程：${courseSlug}`);
    mkdirSync(courseDir, { recursive: true });
  }

  const chapterBase = slugify(chapterTitle) || fallbackSlug("chapter");
  const chapterSlug = uniqueChapterSlug(courseDir, chapterBase);
  const order = attachTo ? nextOrder(db, "chapters", attachTo) : 1;

  // 章节文件
  writeFileSync(
    join(courseDir, `${chapterSlug}.md`),
    `---\ntitle: ${chapterTitle}\norder: ${order}\n---\n\n${body}\n`,
    "utf8",
  );

  // 新课程才有 _course.md
  if (mode === "new") {
    writeFileSync(
      join(courseDir, "_course.md"),
      `---\ntitle: ${title}\ndiscipline: ${discipline}\nsummary: ${body.slice(0, 60).replace(/\n/g, " ")}\norder: ${nextOrder(db, "courses")}\n---\n`,
      "utf8",
    );
  }

  const stats = syncContent(db, contentDir);

  const course = db.prepare("SELECT id FROM courses WHERE slug = ?").get(courseSlug) as { id: number } | undefined;
  if (!course) throw new ImportError(500, `sync 之后找不到课程 ${courseSlug}`);
  const chapter = db
    .prepare("SELECT id, slug FROM chapters WHERE course_id = ? AND slug = ?")
    .get(course.id, chapterSlug) as { id: number; slug: string } | undefined;
  if (!chapter) throw new ImportError(500, `sync 之后找不到章节 ${courseSlug}/${chapterSlug}`);

  // 新课程归到当前层
  if (mode === "new") {
    const shelfId = Number.isInteger(input.shelfId) ? Number(input.shelfId) : null;
    const shelf = shelfId
      ? (db.prepare("SELECT id FROM shelves WHERE id = ?").get(shelfId) as { id: number } | undefined)
      : undefined;
    db.prepare("UPDATE courses SET shelf_id = ?, updated_at = ? WHERE id = ?").run(
      shelf?.id ?? null,
      new Date().toISOString(),
      course.id,
    );
  }

  return {
    mode,
    courseSlug,
    chapterSlug: chapter.slug,
    title,
    chapterTitle,
    createdChapters: stats.chapters.created,
  };
}

// 改章节正文：md 仍是唯一编辑源——读原文件、原样保留 front matter（uid/title/order 都不动）
// 只换正文，写回后立刻 sync。路径由库里的 slug 推出，再夹在 contentDir 内。
export function saveChapterBody(
  db: DatabaseSync,
  contentDir: string,
  input: { course?: unknown; slug?: unknown; body?: unknown },
) {
  const courseSlug = clean(input.course);
  const chapterSlug = clean(input.slug);
  const body = clean(input.body);

  if (!courseSlug || !chapterSlug) throw new ImportError(400, "缺少课程或章节");
  if (!/^[A-Za-z0-9_-]+$/.test(courseSlug) || !/^[A-Za-z0-9_-]+$/.test(chapterSlug)) {
    throw new ImportError(400, "slug 不合法");
  }
  if (!body) throw new ImportError(400, "正文不能为空");
  if (body.length > MAX_BODY) throw new ImportError(413, `正文超过 ${MAX_BODY} 字符上限`);

  const row = db
    .prepare(
      `SELECT ch.id, ch.title FROM chapters ch JOIN courses co ON co.id = ch.course_id
       WHERE co.slug = ? AND ch.slug = ?`,
    )
    .get(courseSlug, chapterSlug) as { id: number; title: string } | undefined;
  if (!row) throw new ImportError(404, "查无此章");

  const file = resolve(contentDir, courseSlug, `${chapterSlug}.md`);
  const root = resolve(contentDir);
  if (!file.startsWith(root + sep)) throw new ImportError(400, "路径不合法");
  if (!existsSync(file)) throw new ImportError(404, "这章的 md 不在（先用 npm run sync 重建编辑源）");

  const raw = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const front = raw.match(/^---\n[\s\S]*?\n---\n/);
  const head = front ? front[0] : "---\n---\n";
  writeFileSync(file, `${head}\n${body}\n`, "utf8");

  syncContent(db, contentDir);

  const words = body.replace(/\s+/g, "").length;
  return { course: courseSlug, slug: chapterSlug, title: row.title, words };
}

// 删除走「移进 content/.trash」：文件留着能捡回来，库里的行删掉。
// sync 只扫不以 "." 开头的目录，所以 .trash 不会被重新导回来。
const TRASH = ".trash";

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", " ").replace(" ", "-").slice(0, 15);
}

// 回收站里的每条都带一份 meta.json：还原时靠它认回 slug、标题和原层。
export type TrashMeta = {
  kind: "course" | "chapter";
  slug: string;
  title: string;
  courseSlug?: string;
  shelfId?: number | null;
  chapters?: number;
  deletedAt: string;
};

function moveIntoTrash(contentDir: string, from: string, name: string, meta: TrashMeta): string | null {
  if (!existsSync(from)) return null;
  const dir = resolve(contentDir, TRASH);
  mkdirSync(dir, { recursive: true });
  const base = `${name}-${stamp()}`;
  const to = resolve(dir, base);
  renameSync(from, to);
  const metaPath = meta.kind === "course" ? join(to, "meta.json") : `${to}.meta.json`;
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return `${TRASH}/${base}`;
}

/** 整本书（一门课）移出书架：目录移进 .trash，章节/课程行删掉。 */
export function deleteCourse(db: DatabaseSync, contentDir: string, rawId: unknown) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) throw new ImportError(400, "id 不对");

  const row = db.prepare("SELECT id, slug, title FROM courses WHERE id = ?").get(id) as
    | { id: number; slug: string; title: string }
    | undefined;
  if (!row) throw new ImportError(404, "查无此书");

  if (!/^[A-Za-z0-9_-]+$/.test(row.slug)) throw new ImportError(400, "slug 不合法");
  const root = resolve(contentDir);
  const dir = resolve(contentDir, row.slug);
  if (!dir.startsWith(root + sep)) throw new ImportError(400, "路径不合法");

  const count = db.prepare("SELECT COUNT(*) AS c FROM chapters WHERE course_id = ?").get(id) as { c: number };
   const shelf = db.prepare("SELECT shelf_id FROM courses WHERE id = ?").get(id) as { shelf_id: number | null };
   const trash = moveIntoTrash(contentDir, dir, row.slug, {
     kind: "course",
     slug: row.slug,
     title: row.title,
     shelfId: shelf.shelf_id,
     chapters: Number(count.c),
     deletedAt: new Date().toISOString(),
   });

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM chapters WHERE course_id = ?").run(id);
    db.prepare("DELETE FROM courses WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { ok: true as const, id, slug: row.slug, title: row.title, trash };
}

/** 单章移进 .trash：只删这一章的 md 与章节行，课程不动。 */
export function deleteChapter(
  db: DatabaseSync,
  contentDir: string,
  input: { course?: unknown; slug?: unknown },
) {
  const courseSlug = clean(input.course);
  const chapterSlug = clean(input.slug);
  if (!courseSlug || !chapterSlug) throw new ImportError(400, "缺少课程或章节");
  if (!/^[A-Za-z0-9_-]+$/.test(courseSlug) || !/^[A-Za-z0-9_-]+$/.test(chapterSlug)) {
    throw new ImportError(400, "slug 不合法");
  }

  const row = db
    .prepare(
      `SELECT ch.id, ch.title FROM chapters ch JOIN courses co ON co.id = ch.course_id
       WHERE co.slug = ? AND ch.slug = ?`,
    )
    .get(courseSlug, chapterSlug) as { id: number; title: string } | undefined;
  if (!row) throw new ImportError(404, "查无此章");

  const root = resolve(contentDir);
  const file = resolve(contentDir, courseSlug, `${chapterSlug}.md`);
  if (!file.startsWith(root + sep)) throw new ImportError(400, "路径不合法");

  const trash = moveIntoTrash(contentDir, file, `${courseSlug}-${chapterSlug}.md`, {
    kind: "chapter",
    slug: chapterSlug,
    title: row.title,
    courseSlug,
    deletedAt: new Date().toISOString(),
  });

  db.prepare("DELETE FROM chapters WHERE id = ?").run(row.id);
  syncContent(db, contentDir);

  return { ok: true as const, course: courseSlug, slug: chapterSlug, title: row.title, trash };
}

/** 回收站里的条目（按删除时间倒序）。只有整本书能被还原到书架，单章条目不列给界面。 */
export type TrashEntry = TrashMeta & { name: string; chapters: number };

function readMeta(contentDir: string, base: string): TrashMeta | null {
  const p = resolve(contentDir, TRASH, `${base}.meta.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as TrashMeta;
  } catch {
    return null;
  }
}

// 老条目（meta 之前删的）兜底：目录名去掉 -YYYYMMDD-HHMMSS，再读 _course.md 的 title。
function guessSlug(base: string): string {
  return base.replace(/-\d{8}-\d{6}$/, "");
}

export function listTrash(contentDir: string): TrashEntry[] {
  const dir = resolve(contentDir, TRASH);
  if (!existsSync(dir)) return [];
  const out: TrashEntry[] = [];

  for (const name of readdirSync(dir)) {
    if (name.endsWith(".meta.json") || name === "meta.json") continue;
    const abs = resolve(dir, name);
    if (statSync(abs).isDirectory()) {
      let meta: TrashMeta | null = null;
      try {
        meta = JSON.parse(readFileSync(join(abs, "meta.json"), "utf8")) as TrashMeta;
      } catch {
        meta = null;
      }
      if (!meta) {
        const md = join(abs, "_course.md");
        const title = existsSync(md)
          ? (readFileSync(md, "utf8").match(/^title:\s*(.*)$/m)?.[1]?.trim() ?? "")
          : "";
        meta = {
          kind: "course",
          slug: guessSlug(name),
          title: title || guessSlug(name),
          deletedAt: "",
        };
      }
      if (meta.kind !== "course") continue;
      const chaptersInDir = readdirSync(abs).filter((f) => f.endsWith(".md") && f !== "_course.md").length;
      out.push({ ...meta, name, chapters: meta.chapters ?? chaptersInDir });
      continue;
    }
    if (name.endsWith(".md")) {
      const meta = readMeta(contentDir, name);
      if (!meta) continue;
      out.push({ ...meta, name, chapters: 1 });
    }
  }

  return out.sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
}

/** 把整本书从回收站放回第一层，排在最后一本后面。 */
export function restoreTrashCourse(
  db: DatabaseSync,
  contentDir: string,
  rawName: unknown,
): { title: string; slug: string; shelfId: number | null; index: number } {
  const name = clean(rawName);
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith(".")) {
    throw new ImportError(400, "条目名不合法");
  }

  const trashDir = resolve(contentDir, TRASH);
  const from = resolve(trashDir, name);
  if (!from.startsWith(trashDir + sep) || !existsSync(from) || !statSync(from).isDirectory()) {
    throw new ImportError(404, "回收站里没有这一条");
  }

  let meta: TrashMeta | null = null;
  try {
    meta = JSON.parse(readFileSync(join(from, "meta.json"), "utf8")) as TrashMeta;
  } catch {
    meta = null;
  }
  if (meta && meta.kind !== "course") throw new ImportError(400, "这条不是整本书，不能放到书架");

  const slug = meta?.slug ?? guessSlug(name);
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) throw new ImportError(400, "slug 不合法");

  const root = resolve(contentDir);
  const to = resolve(root, slug);
  if (existsSync(to)) throw new ImportError(409, "content 里已经有同名的书，先把它移开再还原");

  renameSync(from, to);
  // meta.json 是回收站的账本，不属于内容目录；还原成功就删掉
  const metaPath = join(to, "meta.json");
  if (existsSync(metaPath)) rmSync(metaPath, { force: true });

  syncContent(db, contentDir);

  const row = db.prepare("SELECT id, title FROM courses WHERE slug = ?").get(slug) as
    | { id: number; title: string }
    | undefined;
  if (!row) throw new ImportError(500, `sync 之后找不到课程 ${slug}`);

  // “第一层”= ord 最小的那层；层里排最后一本。
  const first = db.prepare("SELECT id FROM shelves ORDER BY ord ASC LIMIT 1").get() as { id: number } | undefined;
  const shelfId = first?.id ?? null;
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses WHERE shelf_id IS ?")
    .get(shelfId) as { m: number };
  const order = Number(maxOrder.m) + 1;
  db.prepare("UPDATE courses SET shelf_id = ?, sort_order = ?, updated_at = ? WHERE id = ?").run(
    shelfId,
    order,
    new Date().toISOString(),
    row.id,
  );

  const index = db
    .prepare("SELECT COUNT(*) AS c FROM courses WHERE shelf_id IS ? AND sort_order <= ?")
    .get(shelfId, order) as { c: number };

  return { title: row.title, slug, shelfId, index: Number(index.c) };
}
