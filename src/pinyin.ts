// 标题 → slug。拉丁字母数字原样保留，汉字查内置表转拼音（无声调，多音字取默认读音）。
// 表是生成出来的数据，运行时零依赖。

import { PINYIN_TABLE } from "./pinyin.table.ts";

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const LAT = /[A-Za-z0-9]/;

export function slugify(input: string): string {
  const parts: string[] = [];
  let lat = "";
  let han = "";

  const pushLat = () => {
    if (lat) {
      parts.push(lat.toLowerCase());
      lat = "";
    }
  };
  const pushHan = () => {
    if (han) {
      parts.push(han);
      han = "";
    }
  };

  for (const ch of input.normalize("NFKC")) {
    if (LAT.test(ch)) {
      pushHan();
      lat += ch;
    } else if (HAN.test(ch)) {
      pushLat();
      han += PINYIN_TABLE[ch] ?? "";
    } else {
      pushLat();
      pushHan();
    }
  }
  pushLat();
  pushHan();

  return parts
    .join("-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

// 拼音表覆盖不到的生僻字会让 slug 变空，这时退回时间戳，保证永远有一个可用 slug。
export function fallbackSlug(prefix = "entry"): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
