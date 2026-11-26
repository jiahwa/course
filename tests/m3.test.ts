import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb, migrate } = await import("../src/db/index.ts");
const { syncContent } = await import("../src/sync.ts");
const { listShelves, createShelf, renameShelf, deleteShelf, reorderShelf } = await import("../src/query.ts");
const { importChapter, ImportError } = await import("../src/import.ts");
const { slugify } = await import("../src/pinyin.ts");

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "course-m3-"));
  const db = openDb(join(dir, "test.db"));
  migrate(db);
  return db;
}

function baseContent() {
  const dir = mkdtempSync(join(tmpdir(), "course-m3-content-"));
  mkdirSync(join(dir, "ai-intro"), { recursive: true });
  writeFileSync(join(dir, "ai-intro", "_course.md"), "---\ntitle: 人工智能导论\ndiscipline: 人工智能\norder: 1\n---\n", "utf8");
  writeFileSync(join(dir, "ai-intro", "attention.md"), "---\ntitle: 注意力机制\norder: 1\n---\n\n正文。\n", "utf8");
  return dir;
}

test("中文标题落成拼音 slug", () => {
  assert.equal(slugify("国富论"), "guofulun");
  assert.equal(slugify("《资本论》"), "zibenlun");
  assert.equal(slugify("Attention Is All You Need"), "attention-is-all-you-need");
  assert.equal(slugify("AI 导论"), "ai-daolun");
});

test("初始三层，现有课程落在第 1 层", () => {
  const db = fresh();
  const dir = baseContent();
  syncContent(db, dir);

  const shelves = listShelves(db);
  assert.equal(shelves.length, 3);
  assert.deepEqual(shelves.map((s) => s.ord), [1, 2, 3]);

  // sync 建课程时没有 shelf_id，手动归层（导入路径会做，这里直接改）
  const course = db.prepare("SELECT id FROM courses").get() as { id: number };
  db.prepare("UPDATE courses SET shelf_id = 1 WHERE id = ?").run(course.id);

  const after = listShelves(db);
  assert.equal(after[0].courses.length, 1);
  assert.equal(after[1].courses.length, 0);
});

test("导入为新课程：落 md、入库、归到指定层", () => {
  const db = fresh();
  const dir = baseContent();
  syncContent(db, dir);

  const res = importChapter(db, dir, {
    title: "国富论",
    chapterTitle: "分工的起源",
    discipline: "经济学",
    body: "分工是劳动生产力增进的最大原因。",
    shelfId: 2,
  });

  assert.equal(res.mode, "new");
  assert.equal(res.courseSlug, "guofulun");
  assert.equal(res.chapterSlug, "fengongdeqiyuan");

  // 三件东西都该有：目录、课程 md、章节 md
  assert.ok(existsSync(join(dir, "guofulun", "_course.md")));
  const chapterMd = readFileSync(join(dir, "guofulun", "fengongdeqiyuan.md"), "utf8");
  assert.match(chapterMd, /title: 分工的起源/);
  assert.match(chapterMd, /分工是劳动生产力增进的最大原因。/);

  const course = db.prepare("SELECT id, title, discipline, shelf_id FROM courses WHERE slug = 'guofulun'").get() as any;
  assert.equal(course.title, "国富论");
  assert.equal(course.discipline, "经济学");
  assert.equal(course.shelf_id, 2);

  // uid 由 sync 补写，md 里应该有
  assert.match(readFileSync(join(dir, "guofulun", "_course.md"), "utf8"), /uid: c/);
});

test("导入到现有课程：只加一章，不新建课程", () => {
  const db = fresh();
  const dir = baseContent();
  syncContent(db, dir);

  const before = (db.prepare("SELECT count(*) AS c FROM courses").get() as any).c;
  const res = importChapter(db, dir, {
    title: "随便写的书名",
    chapterTitle: "自注意力",
    body: "自注意力把序列里的每个位置与其它位置直接相连。",
    courseSlug: "ai-intro",
  });

  assert.equal(res.mode, "attach");
  assert.equal(res.courseSlug, "ai-intro");
  assert.equal((db.prepare("SELECT count(*) AS c FROM courses").get() as any).c, before);
  assert.equal((db.prepare("SELECT count(*) AS c FROM chapters").get() as any).c, 2);
});

test("同名课程重复导入被挡住，不覆盖", () => {
  const db = fresh();
  const dir = baseContent();
  syncContent(db, dir);
  importChapter(db, dir, { title: "国富论", chapterTitle: "第一章", body: "甲" });
  assert.throws(
    () => importChapter(db, dir, { title: "国富论", chapterTitle: "第二章", body: "乙" }),
    (e: any) => e instanceof ImportError && e.status === 409,
  );
});

test("空正文与空书名被拒绝", () => {
  const db = fresh();
  const dir = baseContent();
  assert.throws(() => importChapter(db, dir, { title: "", chapterTitle: "x", body: "y" }), ImportError);
  assert.throws(() => importChapter(db, dir, { title: "书", chapterTitle: "章", body: "   " }), ImportError);
});

test("建层追加到最上面，层名可自定义", () => {
  const db = fresh();
  const s = createShelf(db, "诗词");
  assert.equal(s.ord, 4);
  assert.equal(s.name, "诗词");
  const shelves = listShelves(db);
  assert.equal(shelves.length, 4);
  assert.equal(shelves[3].name, "诗词");
  assert.equal(shelves[3].courses.length, 0);
});

test("向下一层插到最下面，改层名改的是名字不是 ord", () => {
  const db = fresh();
  const bottom = createShelf(db, "", "bottom");
  assert.equal(bottom.ord, 0);
  assert.equal(listShelves(db).length, 4);
  const shelves = listShelves(db);
  assert.equal(shelves[0].id, bottom.id);
  const out = renameShelf(db, bottom.id, "  新名字  ");
  assert.deepEqual(out, { id: bottom.id, name: "新名字" });
  const after = listShelves(db);
  assert.equal(after[0].name, "新名字");
  assert.equal(after[0].ord, 0);
});

test("改层名拒绝空名与不存在的层", () => {
  const db = fresh();
  const out = renameShelf(db, 1, "   ");
  assert.ok("error" in out);
  const missing = renameShelf(db, 999, "x");
  assert.ok("missing" in missing);
});

test("层里有书就拒绝删，书原样留着", () => {
  const db = fresh();
  const dir = baseContent();
  syncContent(db, dir);
  importChapter(db, dir, { title: "临时书", chapterTitle: "第一章", body: "甲", shelfId: 2 });
  const second = listShelves(db).find((s) => s.ord === 2)!;
  const out = deleteShelf(db, second.id);
  assert.ok("notEmpty" in out, "有书的层必须拒绝");
  const after = listShelves(db);
  assert.equal(after.length, 3);
  assert.ok(after.find((s) => s.id === second.id)!.courses.some((c) => c.title === "临时书"));
});

test("删空层后 ord 归一", () => {
  const db = fresh();
  const middle = listShelves(db).find((s) => s.ord === 2)!;
  const out = deleteShelf(db, middle.id);
  assert.ok("ok" in out);
  const after = listShelves(db);
  assert.equal(after.length, 2);
  assert.deepEqual(after.map((s) => s.ord), [1, 2]);
});

test("最后一层不许删", () => {
  const db = fresh();
  const shelves = listShelves(db);
  for (const s of shelves.slice(1)) {
    const out = deleteShelf(db, s.id);
    assert.ok("ok" in out);
  }
  const out = deleteShelf(db, shelves[0].id);
  assert.ok("error" in out);
  assert.equal(listShelves(db).length, 1);
});

test("重排把层挪到指定位置并归一 ord", () => {
  const db = fresh();
  const before = listShelves(db);
  const top = before[2];
  const out = reorderShelf(db, top.id, 0);
  assert.ok("ok" in out);
  const after = listShelves(db);
  assert.equal(after[0].id, top.id);
  assert.deepEqual(after.map((s) => s.ord), [1, 2, 3]);
  const missing = reorderShelf(db, 999, 1);
  assert.ok("missing" in missing);
});
