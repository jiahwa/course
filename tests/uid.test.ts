import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb, migrate } = await import("../src/db/index.ts");
const { syncContent } = await import("../src/sync.ts");
const { recordView } = await import("../src/query.ts");

function fresh() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "course-uid-")), "test.db"));
  migrate(db);
  return db;
}

function root() {
  return mkdtempSync(join(tmpdir(), "course-uid-content-"));
}

function writeCourse(
  dir: string,
  slug: string,
  meta: string,
  chapters: [string, string, string][],
  uid?: string,
) {
  const d = join(dir, slug);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "_course.md"), `---\n${meta}${uid ? `\nuid: ${uid}` : ""}\n---\n`, "utf8");
  chapters.forEach(([s, title, body], i) => {
    writeFileSync(join(d, `${s}.md`), `---\ntitle: ${title}\norder: ${i + 1}\n---\n\n${body}\n`, "utf8");
  });
}

function chapterRow(db: any, uid: string) {
  return db.prepare("SELECT id, uid, slug, course_id FROM chapters WHERE uid = ?").get(uid) as any;
}

test("新建章节自动写入 uid，第二次 sync 不再改文件", () => {
  const db = fresh();
  const dir = root();
  writeCourse(dir, "ai", "title: 人工智能\ndiscipline: AI", [
    ["attention", "注意力", "内容。"],
    ["transformer", "Transformer", "内容。"],
  ]);

  const s1 = syncContent(db, dir);
  assert.equal(s1.chapters.created, 2);
  assert.equal(s1.wroteUid.length, 3, "课程 + 两章各补一次");

  const raw = readFileSync(join(dir, "ai", "attention.md"), "utf8");
  assert.match(raw, /uid: h[a-z0-9]{12}/);

  const s2 = syncContent(db, dir);
  assert.equal(s2.wroteUid.length, 0);
  assert.equal(s2.chapters.unchanged, 2);
});

test("章节改名：id、uid、浏览记录都不变", () => {
  const db = fresh();
  const dir = root();
  writeCourse(dir, "ai", "title: 人工智能\ndiscipline: AI", [["attention", "注意力", "内容。"]]);
  syncContent(db, dir);

  const before = db.prepare("SELECT id, uid FROM chapters WHERE slug = 'attention'").get() as any;
  recordView(db, before.id, 45);
  recordView(db, before.id, 15);

  renameSync(join(dir, "ai", "attention.md"), join(dir, "ai", "attention-v2.md"));
  const s = syncContent(db, dir);

  assert.equal(s.chapters.created, 0, "改名不应新建");
  assert.equal(s.chapters.updated, 1);
  assert.deepEqual(s.orphans, [], "改名后不应留孤儿");

  const after = chapterRow(db, before.uid);
  assert.equal(after.id, before.id);
  assert.equal(after.slug, "attention-v2");

  const view = db.prepare("SELECT opens, seconds FROM views WHERE chapter_id = ?").get(before.id) as any;
  assert.equal(view.opens, 2);
  assert.equal(view.seconds, 60);
});

test("章节换课程：id 与 uid 不变，course_id 变", () => {
  const db = fresh();
  const dir = root();
  writeCourse(dir, "ai", "title: 人工智能\ndiscipline: AI", [["attention", "注意力", "内容。"]]);
  writeCourse(dir, "dist", "title: 分布式\ndiscipline: CS", [["consensus", "共识", "内容。"]]);
  syncContent(db, dir);

  const before = db.prepare("SELECT id, uid FROM chapters WHERE slug = 'attention'").get() as any;
  renameSync(join(dir, "ai", "attention.md"), join(dir, "dist", "attention.md"));
  const s = syncContent(db, dir);

  assert.equal(s.chapters.created, 0);
  assert.equal(s.chapters.updated, 1);

  const after = chapterRow(db, before.uid);
  assert.equal(after.id, before.id);
  const course = db.prepare("SELECT slug FROM courses WHERE id = ?").get(after.course_id) as any;
  assert.equal(course.slug, "dist");
});

test("课程目录改名：课程与章节身份都不变", () => {
  const db = fresh();
  const dir = root();
  writeCourse(dir, "ai", "title: 人工智能\ndiscipline: AI", [["attention", "注意力", "内容。"]]);
  syncContent(db, dir);

  const c = db.prepare("SELECT uid FROM courses").get() as any;
  const h = db.prepare("SELECT uid, id FROM chapters").get() as any;

  renameSync(join(dir, "ai"), join(dir, "ai-foundations"));
  syncContent(db, dir);

  const c2 = db.prepare("SELECT uid, slug FROM courses").get() as any;
  assert.equal(c2.uid, c.uid);
  assert.equal(c2.slug, "ai-foundations");

  const h2 = chapterRow(db, h.uid);
  assert.equal(h2.id, h.id);
});

test("同一 uid 出现在两个文件：报冲突，不新增也不静默覆盖", () => {
  const db = fresh();
  const dir = root();
  writeCourse(dir, "ai", "title: 人工智能\ndiscipline: AI", [["attention", "注意力", "内容。"]]);
  syncContent(db, dir);

  const src = join(dir, "ai", "attention.md");
  const uid = (readFileSync(src, "utf8").match(/uid: (\S+)/) ?? [])[1];
  copyFileSync(src, join(dir, "ai", "duplicate.md"));

  const s = syncContent(db, dir);
  assert.equal(s.conflicts.length, 1);
  assert.equal(s.chapters.created, 0);

  const count = db.prepare("SELECT count(*) AS c FROM chapters").get() as any;
  assert.equal(count.c, 1);

  const rows = db.prepare("SELECT count(*) AS c FROM chapters WHERE uid = ?").get(uid) as any;
  assert.equal(rows.c, 1);
});

test("删掉 uid 并改文件名：新开一章，旧行成孤儿（只认 uid）", () => {
  const db = fresh();
  const dir = root();
  writeCourse(dir, "ai", "title: 人工智能\ndiscipline: AI", [["attention", "注意力", "内容。"]]);
  syncContent(db, dir);

  const before = db.prepare("SELECT id, uid FROM chapters").get() as any;
  const src = join(dir, "ai", "attention.md");
  const stripped = readFileSync(src, "utf8").replace(/^uid: .*\n/m, "");
  writeFileSync(join(dir, "ai", "attention-copy.md"), stripped, "utf8");
  rmSync(src);

  const s = syncContent(db, dir);
  assert.equal(s.chapters.created, 1, "没有 uid 就是新建");
  assert.deepEqual(s.orphans, ["ai/attention"]);

  const rows = db.prepare("SELECT id, uid FROM chapters ORDER BY id").all() as any[];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, before.id, "旧行原样保留，只报孤儿");
  assert.notEqual(rows[1].uid, before.uid);
});

test("删掉 uid 但文件名不变：报冲突，不新增也不覆盖", () => {
  const db = fresh();
  const dir = root();
  writeCourse(dir, "ai", "title: 人工智能\ndiscipline: AI", [["attention", "注意力", "内容。"]]);
  syncContent(db, dir);

  const file = join(dir, "ai", "attention.md");
  writeFileSync(file, readFileSync(file, "utf8").replace(/^uid: .*\n/m, ""), "utf8");

  const s = syncContent(db, dir);
  assert.equal(s.chapters.created, 0);
  assert.equal(s.conflicts.length, 1);
  const count = db.prepare("SELECT count(*) AS c FROM chapters").get() as any;
  assert.equal(count.c, 1);
});

test("md 的 uid 在库里查不到：不静默顶替，报冲突", () => {
  const db = fresh();
  const dir = root();
  writeCourse(dir, "ai", "title: 人工智能\ndiscipline: AI", [["attention", "注意力", "内容。"]]);
  syncContent(db, dir);

  const file = join(dir, "ai", "attention.md");
  writeFileSync(file, readFileSync(file, "utf8").replace(/^uid: .*\n/m, "uid: hdeadbeefcafe\n"), "utf8");

  const s = syncContent(db, dir);
  assert.equal(s.chapters.created, 0);
  assert.equal(s.conflicts.length, 1);
  const count = db.prepare("SELECT count(*) AS c FROM chapters").get() as any;
  assert.equal(count.c, 1);
});
