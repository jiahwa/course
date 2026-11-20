import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb, migrate, pendingMigrations } = await import("../src/db/index.ts");
const { readGate, writeGate } = await import("../src/gate.ts");
const { searchChapters, listCourses, recentViews, recordView, getChapter } = await import("../src/query.ts");

// 每个用例一条独立的库，避免用例之间互相污染数据。
function fresh() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "course-test-")), "test.db"));
  migrate(db);
  return db;
}

function seed(db: any) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO courses (slug, title, discipline, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("ai", "人工智能导论", "人工智能", "从感知机到注意力", now, now);
  db.prepare(
    "INSERT INTO chapters (course_id, slug, title, body_md, content_hash, sort_order, words, updated_at) VALUES (1, ?, ?, ?, ?, 1, 100, ?)",
  ).run("attention", "注意力机制", "注意力就是全部所需。查询、键、值三件套决定权重。", "h1", now);
  db.prepare(
    "INSERT INTO chapters (course_id, slug, title, body_md, content_hash, sort_order, words, updated_at) VALUES (1, ?, ?, ?, ?, 2, 80, ?)",
  ).run("transformer", "Transformer 结构", "编码器与解码器堆叠，残差连接保证训练稳定。", "h2", now);
}

test("迁移把基线的表与触发器建齐，且无待应用", () => {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "course-test-")), "test.db"));
  const res = migrate(db);
  assert.equal(res.applied.length, 2, "基线 + uid 两条迁移");
  assert.deepEqual(pendingMigrations(db), []);

  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  for (const t of ["settings", "courses", "chapters", "views", "events", "chapters_fts"]) {
    assert.ok(tables.has(t), `缺表 ${t}`);
  }

  const triggers = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  for (const t of ["chapters_ai", "chapters_ad", "chapters_au"]) {
    assert.ok(triggers.has(t), `缺触发器 ${t}`);
  }
});

test("重复执行迁移不会二次应用", () => {
  const db = fresh();
  const again = migrate(db);
  assert.deepEqual(again.applied, []);
  assert.ok(again.skipped.length >= 1);
});

test("授权位默认关，写入后读得到 on，并留一条事件", () => {
  const db = fresh();

  assert.equal(readGate(db).on, false);
  writeGate(db, true, "test");
  assert.equal(readGate(db).on, true);

  const ev = db.prepare("SELECT kind, ref FROM events ORDER BY id DESC LIMIT 1").get() as {
    kind: string;
    ref: string;
  };
  assert.equal(ev.kind, "gate.on");
  assert.equal(ev.ref, "test");
});

test("插入章节自动进检索副本，三字走全文、两字走子串", () => {
  const db = fresh();
  seed(db);

  assert.equal(listCourses(db).length, 1);
  assert.equal(listCourses(db)[0].chapters, 2);

  assert.equal(searchChapters(db, "注意力").length, 1, "两字应回退 LIKE");
  assert.equal(searchChapters(db, "残差连接").length, 1, "四字走 FTS trigram");
  assert.equal(searchChapters(db, "不存在的词").length, 0);

  const hit = searchChapters(db, "残差连接")[0];
  assert.equal(hit.courseTitle, "人工智能导论");
});

test("浏览记录只累加事实，不生成打卡数据", () => {
  const db = fresh();
  seed(db);

  assert.equal(recentViews(db).length, 0);
  recordView(db, 1, 30);
  recordView(db, 1, 20);
  const [first] = recentViews(db);
  assert.equal(first.opens, 2);
  assert.ok(first.lastOpenedAt);

  const v = db.prepare("SELECT opens, seconds FROM views WHERE chapter_id = 1").get() as {
    opens: number;
    seconds: number;
  };
  assert.equal(v.opens, 2);
  assert.equal(v.seconds, 50);
});

test("章节读取带上一章下一章", () => {
  const db = fresh();
  seed(db);

  const ch = getChapter(db, "ai", "attention");
  assert.ok(ch);
  assert.equal(ch!.next!.slug, "transformer");
  assert.equal(ch!.prev, null);
  assert.equal(getChapter(db, "ai", "nope"), null);
});
