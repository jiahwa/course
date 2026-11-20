import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb, migrate } = await import("../src/db/index.ts");
const { syncContent, parseFront, hashOf } = await import("../src/sync.ts");

function fresh() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "course-sync-")), "test.db"));
  migrate(db);
  return db;
}

function contentDir() {
  return mkdtempSync(join(tmpdir(), "course-content-"));
}

function writeCourse(root: string, slug: string, meta: string, chapters: [string, string, string][]) {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "_course.md"), `---\n${meta}\n---\n`, "utf8");
  chapters.forEach(([s, title, body], i) => {
    writeFileSync(join(dir, `${s}.md`), `---\ntitle: ${title}\norder: ${i + 1}\n---\n\n${body}\n`, "utf8");
  });
}

test("front matter 解析出元信息与正文，正文不含分隔线", () => {
  const { data, body } = parseFront("---\ntitle: 注意力\norder: 1\n---\n\n正文第一段\n\n## 小标题\n");
  assert.equal(data.title, "注意力");
  assert.equal(data.order, "1");
  assert.equal(body.startsWith("正文第一段"), true);
  assert.equal(body.includes("---"), false);
});

test("sync 建课建章，再跑一次全未变", () => {
  const db = fresh();
  const root = contentDir();
  writeCourse(
    root,
    "ai",
    "title: 人工智能\ndiscipline: AI\nsummary: 入门\norder: 1",
    [
      ["attention", "注意力", "注意力是加权求和。"],
      ["transformer", "Transformer", "残差连接让深网可训。"],
    ],
  );

  const first = syncContent(db, root);
  assert.equal(first.courses.created, 1);
  assert.equal(first.chapters.created, 2);

  const second = syncContent(db, root);
  assert.equal(second.courses.created, 0);
  assert.equal(second.courses.unchanged, 1);
  assert.equal(second.chapters.created, 0);
  assert.equal(second.chapters.unchanged, 2);

  const ch = db.prepare("SELECT title, body_md, words FROM chapters WHERE slug = 'attention'").get() as {
    title: string;
    body_md: string;
    words: number;
  };
  assert.equal(ch.title, "注意力");
  assert.equal(ch.words, "注意力是加权求和。".length);
});

test("正文变化只更新那一章，hash 随之改变", () => {
  const db = fresh();
  const root = contentDir();
  writeCourse(root, "ai", "title: 人工智能\ndiscipline: AI", [["attention", "注意力", "旧内容。"]]);
  syncContent(db, root);

  const before = db.prepare("SELECT content_hash FROM chapters WHERE slug = 'attention'").get() as {
    content_hash: string;
  };

  // 改正文要保留 front matter 里的 uid，否则按新章处理（身份只认 uid）
  const uid = (readFileSync(join(root, "ai", "attention.md"), "utf8").match(/uid: (\S+)/) ?? [])[1];
  writeFileSync(join(root, "ai", "attention.md"), `---\ntitle: 注意力\norder: 1\nuid: ${uid}\n---\n\n新内容。\n`, "utf8");
  const s = syncContent(db, root);
  assert.equal(s.chapters.updated, 1);

  const after = db.prepare("SELECT content_hash, body_md FROM chapters WHERE slug = 'attention'").get() as {
    content_hash: string;
    body_md: string;
  };
  assert.notEqual(before.content_hash, after.content_hash);
  assert.equal(after.content_hash, hashOf("新内容。"));
  assert.equal(after.body_md, "新内容。");
});

test("md 删掉一章只报告孤儿，不删库", () => {
  const db = fresh();
  const root = contentDir();
  writeCourse(root, "ai", "title: 人工智能\ndiscipline: AI", [
    ["attention", "注意力", "内容。"],
    ["transformer", "Transformer", "内容。"],
  ]);
  syncContent(db, root);

  rmSync(join(root, "ai", "transformer.md"));
  const s = syncContent(db, root);
  assert.deepEqual(s.orphans, ["ai/transformer"]);
  const count = db.prepare("SELECT count(*) AS c FROM chapters").get() as { c: number };
  assert.equal(count.c, 2, "孤儿不自动删除");
});

test("缺 _course.md 的目录被跳过，不产生半截课程", () => {
  const db = fresh();
  const root = contentDir();
  mkdirSync(join(root, "loose"), { recursive: true });
  writeFileSync(join(root, "loose", "x.md"), "正文", "utf8");

  const s = syncContent(db, root);
  assert.equal(s.courses.created, 0);
  assert.equal(s.skipped.length, 1);
  const courses = db.prepare("SELECT count(*) AS c FROM courses").get() as { c: number };
  assert.equal(courses.c, 0);
});
