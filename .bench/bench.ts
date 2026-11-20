// 迭代模块的入口。M0 只提供 list / verify / state / token；
// plan / apply / revert 在 M2 落地，现在明确报未实现，不做假动作。

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, DB_PATH, pendingMigrations } from "../src/db/index.ts";
import { readGate } from "../src/gate.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(HERE, "skills");
const TOKEN_PATH = join(HERE, "token");

type Check = { name: string; run: () => string | void };

function readSkills(): { file: string; name: string; covers: string[]; lastApplied: string | null }[] {
  return readdirSync(SKILLS)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const text = readFileSync(join(SKILLS, f), "utf8");
      const fm = text.match(/^---\n([\s\S]*?)\n---/);
      const body = fm?.[1] ?? "";
      const name = (body.match(/^name:\s*(.+)$/m) ?? [])[1]?.trim() ?? "";
      const lastApplied = (body.match(/^last-applied:\s*(.+)$/m) ?? [])[1]?.trim() ?? null;
      const rawCovers = (body.match(/^covers:\s*\[(.+)\]$/m) ?? [])[1] ?? "";
      const covers = rawCovers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return { file: f, name, covers, lastApplied };
    });
}

const REQUIRED_TABLES = [
  "settings",
  "courses",
  "chapters",
  "views",
  "events",
  "chapters_fts",
];

const REQUIRED_TRIGGERS = ["chapters_ai", "chapters_ad", "chapters_au"];

function verify(): number {
  const db = getDb();
  const checks: Check[] = [];

  checks.push({
    name: "库可打开且迁移无待应用",
    run() {
      const pending = pendingMigrations(db);
      if (pending.length) throw new Error(`还有未应用的迁移：${pending.join(", ")}`);
      return `库 ${DB_PATH}`;
    },
  });

  checks.push({
    name: "基线表齐全",
    run() {
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as {
        name: string;
      }[];
      const names = new Set(rows.map((r) => r.name));
      const missing = REQUIRED_TABLES.filter((t) => !names.has(t));
      if (missing.length) throw new Error(`缺表：${missing.join(", ")}`);
    },
  });

  checks.push({
    name: "检索副本触发器齐全",
    run() {
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as {
        name: string;
      }[];
      const names = new Set(rows.map((r) => r.name));
      const missing = REQUIRED_TRIGGERS.filter((t) => !names.has(t));
      if (missing.length) throw new Error(`缺触发器：${missing.join(", ")}`);
    },
  });

  checks.push({
    name: "检索副本与正表行数一致",
    run() {
      const a = db.prepare("SELECT count(*) AS c FROM chapters").get() as { c: number };
      const b = db.prepare("SELECT count(*) AS c FROM chapters_fts").get() as { c: number };
      if (a.c !== b.c) throw new Error(`chapters ${a.c} 行，fts ${b.c} 行，不同步`);
      return `${a.c} 行`;
    },
  });

  checks.push({
    name: "授权位取值合法",
    run() {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("bench.gate") as
        | { value: string }
        | undefined;
      if (!row) return "off（未设置）";
      if (row.value !== "on" && row.value !== "off") throw new Error(`gate 值不合法：${row.value}`);
      return row.value;
    },
  });

  checks.push({
    name: "说明书可解析且登记了覆盖范围",
    run() {
      const skills = readSkills();
      if (!skills.length) throw new Error("skills 目录为空");
      const bad = skills.filter((s) => !s.name || s.covers.length === 0);
      if (bad.length) throw new Error(`缺少 name 或 covers：${bad.map((b) => b.file).join(", ")}`);
      return `${skills.length} 份`;
    },
  });

  let failed = 0;
  for (const c of checks) {
    try {
      const detail = c.run();
      console.log(`  ✓ ${c.name}${detail ? ` — ${detail}` : ""}`);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${c.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(failed === 0 ? "\nPASS" : `\nFAIL (${failed} 条)`);
  return failed === 0 ? 0 : 1;
}

function cmdList() {
  const skills = readSkills();
  console.log(`${skills.length} 份说明书（.bench/skills）\n`);
  for (const s of skills) {
    console.log(`  ${s.file}`);
    console.log(`    name: ${s.name}`);
    console.log(`    last-applied: ${s.lastApplied ?? "—"}`);
    console.log(`    covers: ${s.covers.join(", ")}`);
  }
}

function cmdState() {
  const db = getDb();
  const g = readGate(db);
  console.log(`gate: ${g.on ? "on" : "off"}   (${g.updatedAt ?? "从未设置"})`);
  console.log(`db:   ${DB_PATH}`);
  console.log(`token: ${existsSync(TOKEN_PATH) ? "已存在（.bench/token）" : "尚未生成，起一次服务会生成"}`);
}

function cmdToken() {
  if (!existsSync(TOKEN_PATH)) {
    console.log("token 还没生成：先起一次 npm start。");
    return 1;
  }
  console.log(readFileSync(TOKEN_PATH, "utf8").trim());
  return 0;
}

function cmdNotYet(name: string) {
  console.error(`${name} 尚未实现：M0 只做地基，plan / apply / revert 在 M2 落地。`);
  return 2;
}

const [, , cmd = "list", sub] = process.argv;

switch (cmd) {
  case "list":
    cmdList();
    break;
  case "verify":
    process.exit(verify());
    break;
  case "state":
    cmdState();
    break;
  case "token":
    process.exit(cmdToken());
    break;
  case "plan":
  case "apply":
  case "revert":
    process.exit(cmdNotYet(cmd + (sub ? ` ${sub}` : "")));
    break;
  default:
    console.log("用法：node .bench/bench.ts [list|verify|state|token]");
    console.log("  plan / apply / revert 在 M2 前不可用。");
}
