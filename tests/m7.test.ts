// 设置页的两道开关：只读模式管写操作，AI 迭代模式游离。两者各存各的，互不干扰。

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb, migrate } = await import("../src/db/index.ts");
const { readGate, writeGate, readReadonly, writeReadonly } = await import("../src/gate.ts");

function fresh() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "course-test-")), "test.db"));
  migrate(db);
  return db;
}

test("只读模式默认关着，开了就是 on 并留一条事件", () => {
  const db = fresh();

  assert.equal(readReadonly(db).on, false, "库是新的，默认关");
  assert.equal(readReadonly(db).updatedAt, null);

  const on = writeReadonly(db, true, "test");
  assert.equal(on.on, true);
  assert.equal(readReadonly(db).on, true);
  assert.equal(readReadonly(db).updatedAt, on.updatedAt);

  const ev = db
    .prepare("SELECT kind, ref FROM events WHERE kind LIKE 'readonly.%' ORDER BY id DESC LIMIT 1")
    .get() as { kind: string; ref: string };
  assert.equal(ev.kind, "readonly.on");
  assert.equal(ev.ref, "test");
});

test("只读模式和 AI 迭代模式各管各的，改一个不动另一个", () => {
  const db = fresh();

  writeGate(db, true, "test");
  assert.equal(readReadonly(db).on, false, "开 AI 迭代模式不该顺手打开只读");

  writeReadonly(db, true, "test");
  assert.equal(readGate(db).on, true, "关只读不该动 AI 迭代模式");

  writeReadonly(db, false, "test");
  assert.equal(readGate(db).on, true);
  assert.equal(readReadonly(db).on, false);
});

test("同一道开关反复写只留最新状态", () => {
  const db = fresh();

  writeReadonly(db, true, "test");
  writeReadonly(db, true, "test");
  writeReadonly(db, false, "test");

  assert.equal(readReadonly(db).on, false);
  const rows = db.prepare("SELECT value FROM settings WHERE key = 'readonly'").all() as { value: string }[];
  assert.equal(rows.length, 1, "settings 里只有一行，不是每次写都插一条");
  assert.equal(rows[0].value, "off");
});
