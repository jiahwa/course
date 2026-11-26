// 生成 src/pinyin.table.ts 的一次性脚本。生成后运行时零依赖。
//
// 用法：
//   1) mkdir -p /tmp/py && cd /tmp/py && npm i pinyin-pro
//   2) python3 把 GB2312 汉字写到 /tmp/chars.txt（见 README 或 git 历史里的命令）
//   3) 回到工程根目录：node scripts/gen-pinyin.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pinyin } = require("/tmp/py/node_modules/pinyin-pro");

const chars = [...new Set(readFileSync("/tmp/chars.txt", "utf8").trim().split(""))];
const entries = chars
  .map((c) => {
    const py = (pinyin(c, { toneType: "none", type: "string" }) || "").replace(/[^a-z]/g, "");
    return py ? [c, py] : null;
  })
  .filter(Boolean);

const body = [];
for (let i = 0; i < entries.length; i += 8) {
  body.push("  " + entries.slice(i, i + 8).map(([c, p]) => `"${c}":"${p}"`).join(", ") + ",");
}

writeFileSync(
  "src/pinyin.table.ts",
  `// 自动生成：GB2312 ${entries.length} 个汉字 → 无声调拼音（多音字取默认读音）。\n// 生成方式见 scripts/gen-pinyin.mjs；生成后运行时零依赖，只查表。\nexport const PINYIN_TABLE: Record<string, string> = {\n${body.join("\n")}\n};\n`,
);
console.log(`写入 src/pinyin.table.ts：${entries.length} 条`);
