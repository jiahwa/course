import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb, migrate } = await import("../src/db/index.ts");
const { syncContent } = await import("../src/sync.ts");
const { listCourses, reorderCourse } = await import("../src/query.ts");

function setup() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "course-book-")), "test.db"));
  migrate(db);
  const root = mkdtempSync(join(tmpdir(), "course-book-content-"));
  [
    ["a", "甲课"],
    ["b", "乙课"],
    ["c", "丙课"],
  ].forEach(([slug, title], i) => {
    const dir = join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "_course.md"), `---\ntitle: ${title}\ndiscipline: 测验\nsummary: 一句话\norder: ${i + 1}\n---\n`, "utf8");
    writeFileSync(join(dir, "one.md"), `---\ntitle: 第一章\norder: 1\n---\n\n正文。\n`, "utf8");
  });
  syncContent(db, root);
  return { db, root };
}

test("换书序：层内顺序按 toIndex 落库，别的层不动", () => {
  const { db } = setup();
  const order = () => listCourses(db).map((c) => c.slug);
  assert.deepEqual(order(), ["a", "b", "c"]);

  const idA = listCourses(db).find((c) => c.slug === "a")!.id;
  assert.equal(reorderCourse(db, idA, 2).index, 3);
  assert.deepEqual(order(), ["b", "c", "a"]);

  const idC = listCourses(db).find((c) => c.slug === "c")!.id;
  reorderCourse(db, idC, 0);
  assert.deepEqual(order(), ["c", "b", "a"]);

  // 原位不动：不改任何 sort_order
  const idB = listCourses(db).find((c) => c.slug === "b")!.id;
  const before = order();
  assert.deepEqual(reorderCourse(db, idB, 1), { ok: true, id: idB, index: 2, total: 3, unchanged: true });
  assert.deepEqual(order(), before);
});

test("换书序：不存在的书 404，位置不是整数 400", () => {
  const { db } = setup();
  assert.equal("missing" in reorderCourse(db, 999, 0), true);
  assert.equal("error" in reorderCourse(db, 999, 0), true);
  const id = listCourses(db)[0].id;
  assert.equal("error" in reorderCourse(db, id, 1.5), true);
});

test("换书序：只改顺序，书还是那三本", () => {
  const { db } = setup();
  const before = listCourses(db).map((c) => `${c.slug}:${c.id}:${c.chapters}`).sort();
  const id = listCourses(db)[0].id;
  reorderCourse(db, id, 2);
  const after = listCourses(db).map((c) => `${c.slug}:${c.id}:${c.chapters}`).sort();
  assert.deepEqual(after, before);
  assert.equal(listCourses(db).length, 3);
});
