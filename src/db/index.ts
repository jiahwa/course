// 全站唯一的库入口：打开、迁移、导出连接。
// node:sqlite 仍是实验特性，这个文件是唯一的隔离层，将来换驱动只改这里。

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DB_PATH = process.env.COURSE_DB ?? join(ROOT, "db", "course.db");
const MIGRATIONS_DIR = join(ROOT, "db", "migrations");

let shared: DatabaseSync | null = null;

export function openDb(path = DB_PATH): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function getDb(): DatabaseSync {
  if (!shared) {
    shared = openDb();
    migrate(shared);
  }
  return shared;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// 迁移只允许新增文件，不允许改历史文件——改了就 hash 对不上，直接失败。
export function migrate(db: DatabaseSync): { applied: string[]; skipped: string[] } {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex").slice(0, 16);
    const row = db.prepare("SELECT hash FROM schema_migrations WHERE id = ?").get(file) as
      | { hash: string }
      | undefined;

    if (row) {
      if (row.hash !== hash) {
        throw new Error(`迁移 ${file} 已应用但内容被改动（hash ${row.hash} → ${hash}）。改结构请新增迁移文件。`);
      }
      skipped.push(file);
      continue;
    }

    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (id, hash, applied_at) VALUES (?, ?, ?)").run(
      file,
      hash,
      nowIso(),
    );
    applied.push(file);
  }

  return { applied, skipped };
}

export function pendingMigrations(db: DatabaseSync): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const done = db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[];
  const ids = new Set(done.map((r) => r.id));
  return files.filter((f) => !ids.has(f));
}
