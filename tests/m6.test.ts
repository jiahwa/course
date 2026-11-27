import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb, migrate } = await import("../src/db/index.ts");
const { syncContent } = await import("../src/sync.ts");
const { listCourses } = await import("../src/query.ts");
const { deleteCourse, deleteChapter, ImportError } = await import("../src/import.ts");

function setup() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "course-del-")), "test.db"));
  migrate(db);
  const root = mkdtempSync(join(tmpdir(), "course-del-content-"));
  ["a", "b"].forEach((slug, i) => {
    const dir = join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "_course.md"),
      `---\ntitle: ${slug === "a" ? "甲课" : "乙课"}\ndiscipline: 测验\nsummary: 一句话\norder: ${i + 1}\n---\n`,
      "utf8",
    );
    writeFileSync(join(dir, "one.md"), `---\ntitle: 第一章\norder: 1\n---\n\n正文。\n`, "utf8");
    writeFileSync(join(dir, "two.md"), `---\ntitle: 第二章\norder: 2\n---\n\n正文二。\n`, "utf8");
  });
  syncContent(db, root);
  return { db, root };
}

test("删书：目录进 .trash、库里课程与章节都清掉、别的书不受影响", () => {
  const { db, root } = setup();
  const idA = listCourses(db).find((c) => c.slug === "a")!.id;

  const out = deleteCourse(db, root, idA);
  assert.equal(out.ok, true);
  assert.equal(out.title, "甲课");
  assert.ok(out.trash && out.trash.startsWith(".trash/a-"));

  assert.equal(existsSync(join(root, "a")), false);
  assert.ok(existsSync(join(root, out.trash!)));
  assert.deepEqual(
    listCourses(db).map((c) => c.slug),
    ["b"],
  );
  assert.equal(
    (db.prepare("SELECT count(*) AS n FROM chapters WHERE course_id = ?").get(idA) as { n: number }).n,
    0,
  );

  // .trash 不被 sync 扫回：再同步一次，书不会复活
  syncContent(db, root);
  assert.deepEqual(
    listCourses(db).map((c) => c.slug),
    ["b"],
  );
  assert.ok(readdirSync(join(root, ".trash")).length >= 1);
});

test("删章：只移走这一章的 md，课程还在别章不动", () => {
  const { db, root } = setup();
  const out = deleteChapter(db, root, { course: "a", slug: "two" });
  assert.equal(out.ok, true);
  assert.equal(out.title, "第二章");
  assert.ok(out.trash && out.trash.startsWith(".trash/a-two.md-"));

  assert.equal(existsSync(join(root, "a", "two.md")), false);
  assert.ok(existsSync(join(root, "a", "one.md")));
  assert.ok(existsSync(join(root, "a", "_course.md")));
  assert.ok(existsSync(join(root, out.trash!)));

  const course = listCourses(db).find((c) => c.slug === "a")!;
  assert.equal(course.chapters, 1);
  assert.equal(
    (db.prepare("SELECT count(*) AS n FROM chapters WHERE course_id = ?").get(course.id) as { n: number }).n,
    1,
  );
});

test("删书/删章：错参数与查无内容按 400/404 抛", () => {
  const { db } = setup();
  assert.throws(() => deleteCourse(db, "x", "abc"), (e) => e instanceof ImportError && e.status === 400);
  assert.throws(() => deleteCourse(db, "x", 999), (e) => e instanceof ImportError && e.status === 404);
  assert.throws(
    () => deleteChapter(db, "x", { course: "a", slug: "../etc" }),
    (e) => e instanceof ImportError && e.status === 400,
  );
  assert.throws(
    () => deleteChapter(db, "x", { course: "a", slug: "nope" }),
    (e) => e instanceof ImportError && e.status === 404,
  );
});
