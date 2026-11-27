import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb, migrate } = await import("../src/db/index.ts");
const { syncContent } = await import("../src/sync.ts");
const { saveChapterBody, ImportError } = await import("../src/import.ts");

function setup() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "course-save-")), "test.db"));
  migrate(db);
  const root = mkdtempSync(join(tmpdir(), "course-save-content-"));
  const dir = join(root, "ai");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "_course.md"), "---\ntitle: 人工智能\ndiscipline: AI\nsummary: 入门\norder: 1\n---\n", "utf8");
  writeFileSync(
    join(dir, "attention.md"),
    "---\ntitle: 注意力\norder: 1\n---\n\n注意力是加权求和。\n",
    "utf8",
  );
  syncContent(db, root);
  return { db, root };
}

test("改正文：front matter 与 uid 原样保留，库立即跟着变", () => {
  const { db, root } = setup();
  const file = join(root, "ai", "attention.md");
  const before = readFileSync(file, "utf8");
  const beforeUid = before.match(/^uid:\s*(.+)$/m)?.[1];
  assert.equal(typeof beforeUid, "string");

  const out = saveChapterBody(db, root, { course: "ai", slug: "attention", body: "改过的正文。\n\n第二段。" });

  assert.equal(out.words, 10);

  const after = readFileSync(file, "utf8");
  assert.equal(after.match(/^uid:\s*(.+)$/m)?.[1], beforeUid);
  assert.equal(after.includes("title: 注意力"), true);
  assert.equal(after.includes("order: 1"), true);
  assert.equal(after.includes("---\n\n改过的正文。"), true);

  const row = db.prepare("SELECT body_md, words FROM chapters WHERE slug = 'attention'").get() as {
    body_md: string;
    words: number;
  };
  assert.equal(row.body_md, "改过的正文。\n\n第二段。");
  assert.equal(row.words, 10);
});

test("改正文：空正文、非法 slug、查无此章各自报对错的错", () => {
  const { db, root } = setup();

  assert.throws(
    () => saveChapterBody(db, root, { course: "ai", slug: "attention", body: "   " }),
    (e: unknown) => e instanceof ImportError && e.status === 400,
  );
  assert.throws(
    () => saveChapterBody(db, root, { course: "ai", slug: "../etc/passwd", body: "x" }),
    (e: unknown) => e instanceof ImportError && e.status === 400,
  );
  assert.throws(
    () => saveChapterBody(db, root, { course: "ai", slug: "nope", body: "x" }),
    (e: unknown) => e instanceof ImportError && e.status === 404,
  );
});
