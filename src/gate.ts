// 设置页的两道开关，语义分开：
// 1) 只读模式（readonly）：和「操作」绑在一起——开着就只许看，加书/改正文/改层名都拦住。
// 2) AI 学习文档迭代模式（bench.gate）：游离态，不指向任何功能，留给二期接 AI 时用。
// 删除不走只读模式：删除靠黑板上的二次确认兜底，见 server/main.ts 的 skipGate 路由。

import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "./db/index.ts";

const GATE_KEY = "bench.gate";
const READONLY_KEY = "readonly";

export type GateState = { on: boolean; updatedAt: string | null };

function readSwitch(db: DatabaseSync, key: string): GateState {
  const row = db.prepare("SELECT value, updated_at FROM settings WHERE key = ?").get(key) as
    | { value: string; updated_at: string }
    | undefined;
  return { on: row?.value === "on", updatedAt: row?.updated_at ?? null };
}

function writeSwitch(db: DatabaseSync, key: string, on: boolean, actor: string, kinds: [string, string]): GateState {
  const at = nowIso();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, on ? "on" : "off", at);

  db.prepare("INSERT INTO events (kind, ref, payload, at) VALUES (?, ?, ?, ?)").run(
    on ? kinds[0] : kinds[1],
    actor,
    JSON.stringify({ actor }),
    at,
  );

  return { on, updatedAt: at };
}

export function readGate(db: DatabaseSync): GateState {
  return readSwitch(db, GATE_KEY);
}

export function writeGate(db: DatabaseSync, on: boolean, actor = "web"): GateState {
  return writeSwitch(db, GATE_KEY, on, actor, ["gate.on", "gate.off"]);
}

export function readReadonly(db: DatabaseSync): GateState {
  return readSwitch(db, READONLY_KEY);
}

export function writeReadonly(db: DatabaseSync, on: boolean, actor = "web"): GateState {
  return writeSwitch(db, READONLY_KEY, on, actor, ["readonly.on", "readonly.off"]);
}
