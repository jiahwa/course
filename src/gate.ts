// 迭代模式的授权位。它只表示「此刻允许 AI 按 skills 动手」，不提供任何执行能力。
// 真实执行在 .bench 侧，还要过 token 与 verify 两道。

import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "./db/index.ts";

const KEY = "bench.gate";

export type GateState = { on: boolean; updatedAt: string | null };

export function readGate(db: DatabaseSync): GateState {
  const row = db.prepare("SELECT value, updated_at FROM settings WHERE key = ?").get(KEY) as
    | { value: string; updated_at: string }
    | undefined;
  return { on: row?.value === "on", updatedAt: row?.updated_at ?? null };
}

export function writeGate(db: DatabaseSync, on: boolean, actor = "web"): GateState {
  const at = nowIso();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(KEY, on ? "on" : "off", at);

  db.prepare("INSERT INTO events (kind, ref, payload, at) VALUES (?, ?, ?, ?)").run(
    on ? "gate.on" : "gate.off",
    actor,
    JSON.stringify({ actor }),
    at,
  );

  return { on, updatedAt: at };
}
