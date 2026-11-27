// 回收站：删书留 meta、列表认 meta 与老目录、还原回第 1 层最后一本。

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb, migrate } = await import("../src/db/index.ts");
const { importChapter, deleteCourse, listTrash, restoreTrashCourse } = await import("../src/import.ts");

function fresh() {
  const root = mkdtempSync(join(tmpdir(), "course-trash-"));
  const contentDir = join(root, "content");
  mkdirSync(contentDir, { recursive: true });
  const db = openDb(join(root, "test.db"));
  migrate(db);
  return { db, contentDir };
}

function seedBook(db: any, contentDir: string, title: string, chapters: string[] = ["第一章"]) {
  return importChapter(db, contentDir, {
    mode: "new",
    title,
    discipline: "测验",
    chapterTitle: chapters[0],
    body: `${title} 的正文`,
    shelfId: null,
  } as any);
}

test("删书时写出 meta，列表能读到书名、章数与删除时间", () => {
  const { db, contentDir } = fresh();
  const made = seedBook(db, contentDir, "甲书");
  const del = deleteCourse(db, contentDir, db.prepare("SELECT id FROM courses WHERE slug = ?").get(made.courseSlug).id);

  assert.ok(typeof del.trash === "string" && del.trash.length > 0, "删除要返回回收站路径");
  const parts = (del.trash as string).split("/");
  const metaPath = join(contentDir, ".trash", parts[parts.length - 1], "meta.json");
  assert.ok(existsSync(metaPath), "整本书的 meta.json 要落盘");

  const items = listTrash(contentDir);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "甲书");
  assert.equal(items[0].kind, "course");
  assert.equal(items[0].chapters, 1);
  assert.ok(items[0].deletedAt, "meta 里有删除时间");
});

test("老目录没有 meta 也能列出：靠目录名推 slug、读 _course.md 的 title", () => {
  const { contentDir } = fresh();
  const legacy = join(contentDir, ".trash", "lao-shu-20261120-101010");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "_course.md"), "---\ntitle: 老书\n---\n\n## 一节\n\n正文\n");

  const items = listTrash(contentDir);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "老书");
  assert.equal(items[0].slug, "lao-shu");
  assert.equal(items[0].deletedAt, "", "没有 meta 就没有删除时间");
});

test("还原落到第 1 层最后一本，meta 被清掉，重名给 409", () => {
  const { db, contentDir } = fresh();

  // 第 1 层先有两本，拿住它们的最大顺序
  // 迁移自带三层，第 1 层就是 ord 最小的那条
  const a = seedBook(db, contentDir, "乙书");
  const b = seedBook(db, contentDir, "丙书");
  const ids = db.prepare("SELECT id FROM courses ORDER BY id").all() as { id: number }[];
  db.prepare("UPDATE courses SET shelf_id = 1, sort_order = 1 WHERE id = ?").run(ids[0].id);
  db.prepare("UPDATE courses SET shelf_id = 1, sort_order = 2 WHERE id = ?").run(ids[1].id);

  const made = seedBook(db, contentDir, "要还原的书");
  const cid = (db.prepare("SELECT id FROM courses WHERE slug = ?").get(made.courseSlug) as { id: number }).id;
  const del = deleteCourse(db, contentDir, cid);
  const name = (del.trash as string).split("/")[1];
  assert.equal(listTrash(contentDir)[0].name, name);

  const back = restoreTrashCourse(db, contentDir, name);
  assert.equal(back.title, "要还原的书");
  assert.equal(back.shelfId, 1, "固定回第 1 层");
  assert.equal(back.index, 3, "排在第 1 层最后一本后面");
  assert.equal(existsSync(join(contentDir, back.slug, "meta.json")), false, "meta 不该被搬回内容");

  const row = db.prepare("SELECT shelf_id, sort_order FROM courses WHERE slug = ?").get(back.slug) as any;
  assert.equal(row.shelf_id, 1);
  assert.equal(row.sort_order, 3);

  assert.equal(listTrash(contentDir).length, 0, "还原后回收站里不该还有它");

  const again = listTrash(contentDir);
  assert.equal(again.length, 0);
  // 同一个 slug 已在 content 里 → 再还原同名应拒绝
  assert.throws(() => restoreTrashCourse(db, contentDir, name), /已是已经存在|冲突|存在/);
  void a;
  void b;
});

test("还原拒绝越界名字：不认 ../、不认隐藏文件", () => {
  const { db, contentDir } = fresh();
  assert.throws(() => restoreTrashCourse(db, contentDir, "../db/course.db"));
  assert.throws(() => restoreTrashCourse(db, contentDir, ".hidden"));
});
