// 导入：把一段文本落成一章 md，然后立刻 sync 入库。
// 唯一入口仍是 md——导入只是替你写文件，不直接写库。

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
