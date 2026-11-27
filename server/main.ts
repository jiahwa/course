// 站点服务：静态分发 + 只读为主的小 API。所有读写都从这里走，前端不碰库。
// 设置页两个触点：/api/readonly（只读模式，管写操作）与 /api/gate（AI 迭代模式，游离，二期用）。

import { createServer } from "node:http";
import { existsSync, statSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, DB_PATH, pendingMigrations } from "../src/db/index.ts";
import { readGate, writeGate, readReadonly, writeReadonly } from "../src/gate.ts";
import {
  searchChapters,
  recentViews,
  listCourses,
  listShelves,
  createShelf,
  renameShelf,
  deleteShelf,
  reorderShelf,
  reorderCourse,
  recordView,
  getChapter,
  getCourse,
} from "../src/query.ts";
import {
  importChapter,
  saveChapterBody,
  deleteCourse,
  deleteChapter,
  listTrash,
  restoreTrashCourse,
  ImportError,
} from "../src/import.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const CONTENT = join(ROOT, "content");
const PORT = Number(process.env.COURSE_PORT ?? 8790);
const HOST = "127.0.0.1";
const TOKEN_PATH = join(ROOT, ".bench", "token");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const db = getDb();
const appliedCount = (db.prepare("SELECT count(*) AS c FROM schema_migrations").get() as { c: number }).c;
const pending = pendingMigrations(db);

function ensureToken() {
  if (existsSync(TOKEN_PATH)) return;
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  const token = randomBytes(24).toString("hex");
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  console.log(`[course] bench token 已生成，只在此处出现这一次：\n  ${token}\n  （存于 .bench/token，执行 .bench 动作时要求匹配）`);
}

function isLoopback(req: any): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function json(res: any, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(pathname: string, res: any) {
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(DIST, rel);
  if (filePath.startsWith(DIST) && existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(readFileSync(filePath));
    return true;
  }
  const index = join(DIST, "index.html");
  if (existsSync(index)) {
    res.writeHead(200, { "content-type": MIME[".html"] });
    res.end(readFileSync(index));
    return true;
  }
  res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
  res.end("前端还没构建：先跑 npm run build，或 npm run web:dev 走开发端口。");
  return false;
}

// 设置页的开关端点：GET 读状态，POST 只收 { on: boolean }。两道开关共用这一套校验。
async function switchApi(
  req: any,
  res: any,
  read: () => { on: boolean; updatedAt: string | null },
  write: (on: boolean, actor?: string) => { on: boolean; updatedAt: string | null },
  label: string,
): Promise<void> {
  if (req.method === "GET") {
    json(res, 200, read());
    return;
  }
  if (req.method === "POST") {
    if (!isLoopback(req)) {
      json(res, 403, { error: "仅允许本机调用" });
      return;
    }
    const origin = req.headers.origin;
    const allowed = [
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ];
    if (origin && !allowed.includes(origin)) {
      json(res, 403, { error: "来源不被允许" });
      return;
    }
    if (req.headers["content-type"] !== "application/json") {
      json(res, 415, { error: "要求 application/json" });
      return;
    }
    const body = await readBody(req);
    if (typeof body.on !== "boolean") {
      json(res, 400, { error: "on 必须是布尔值" });
      return;
    }
    const state = write(body.on, "web");
    console.log(`[course] ${label} -> ${state.on ? "on" : "off"} (web)`);
    json(res, 200, state);
    return;
  }
  json(res, 405, { error: "method not allowed" });
}

// 所有写操作共用：本机回环 + JSON + 只读模式关着。
// skipGate 表示「这条路由不受只读模式约束」——换序与三类删除走这条：删除靠黑板二次确认，不靠开关。
function guardWrite(req: any, res: any, skipGate = false): boolean {
  if (!isLoopback(req)) {
    json(res, 403, { error: "仅允许本机调用" });
    return false;
  }
  const origin = req.headers.origin as string | undefined;
  const allowed = [
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ];
  if (origin && !allowed.includes(origin)) {
    json(res, 403, { error: "来源不被允许" });
    return false;
  }
  if (req.headers["content-type"] !== "application/json") {
    json(res, 415, { error: "要求 application/json" });
    return false;
  }
  if (skipGate) return true;
  if (readReadonly(db).on) {
    json(res, 403, { error: "只读模式开着：请先去设置页关掉它", code: "readonly-on" });
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  try {
    if (pathname === "/api/health" && req.method === "GET") {
      const v = db.prepare("select sqlite_version() as v").get() as { v: string };
      return json(res, 200, {
        ok: true,
        db: DB_PATH,
        sqlite: v.v,
        migrations: { applied: appliedCount },
        pending,
        node: process.version,
      });
    }

    if (pathname === "/api/courses" && req.method === "GET") {
      return json(res, 200, { items: listCourses(db) });
    }

    if (pathname === "/api/recent" && req.method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);
      return json(res, 200, { items: recentViews(db, limit) });
    }

    if (pathname === "/api/search" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      return json(res, 200, { q, items: searchChapters(db, q) });
    }

    if (pathname === "/api/course" && req.method === "GET") {
      const slug = url.searchParams.get("slug") ?? "";
      const item = getCourse(db, slug);
      if (!item) return json(res, 404, { error: "查无此课" });
      return json(res, 200, item);
    }

    if (pathname === "/api/chapter" && req.method === "GET") {
      const course = url.searchParams.get("course") ?? "";
      const slug = url.searchParams.get("slug") ?? "";
      const item = getChapter(db, course, slug);
      if (!item) return json(res, 404, { error: "查无此章" });
      return json(res, 200, item);
    }

    if (pathname === "/api/view" && req.method === "POST") {
      if (!isLoopback(req)) return json(res, 403, { error: "仅允许本机调用" });
      const body = await readBody(req);
      const id = Number(body.chapterId);
      if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "chapterId 不合法" });
      const state = recordView(db, id, Number(body.seconds ?? 0));
      if (!state) return json(res, 404, { error: "查无此章" });
      return json(res, 200, state);
    }

    if (pathname === "/api/shelves" && req.method === "GET") {
      return json(res, 200, { items: listShelves(db) });
    }

    if (pathname === "/api/shelf" && req.method === "POST") {
      if (!guardWrite(req, res)) return;
      const body = await readBody(req);
      const position = body.position === "bottom" ? "bottom" : "top";
      const shelf = createShelf(db, body.name, position);
      console.log(`[course] 新建层 ${shelf.ord}「${shelf.name}」`);
      return json(res, 201, shelf);
    }

    if (pathname === "/api/shelf/rename" && req.method === "POST") {
      if (!guardWrite(req, res)) return;
      const body = await readBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "id 不对" });
      if (typeof body.name !== "string") return json(res, 400, { error: "name 不对" });
      const out = renameShelf(db, id, body.name);
      if ("missing" in out) return json(res, 404, { error: out.error });
      if ("error" in out) return json(res, 400, { error: out.error });
      console.log(`[course] 层改名 ${id} →「${out.name}」`);
      return json(res, 200, out);
    }

    if (pathname === "/api/shelf/delete" && req.method === "POST") {
      if (!guardWrite(req, res, true)) return;
      const body = await readBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "id 不对" });
      const out = deleteShelf(db, id);
      if ("missing" in out) return json(res, 404, { error: out.error });
      if ("error" in out) return json(res, 400, { error: out.error, code: "not-empty" });
      console.log(`[course] 删层 ${id}`);
      return json(res, 200, out);
    }

    if (pathname === "/api/shelf/reorder" && req.method === "POST") {
      if (!guardWrite(req, res, true)) return;
      const body = await readBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "id 不对" });
      const out = reorderShelf(db, id, Number(body.toIndex));
      if ("missing" in out) return json(res, 404, { error: out.error });
      if ("error" in out) return json(res, 400, { error: out.error });
      console.log(`[course] 重排层 ${id} → 第 ${out.ord} / ${out.total} 位`);
      return json(res, 200, out);
    }

    if (pathname === "/api/course/reorder" && req.method === "POST") {
      if (!guardWrite(req, res, true)) return;
      const body = await readBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json(res, 400, { error: "id 不对" });
      const out = reorderCourse(db, id, Number(body.toIndex));
      if ("missing" in out) return json(res, 404, { error: out.error });
      if ("error" in out) return json(res, 400, { error: out.error });
      console.log(`[course] 换书序 ${id} → 第 ${out.index} / ${out.total} 本`);
      return json(res, 200, out);
    }

    if (pathname === "/api/chapter/save" && req.method === "POST") {
      if (!guardWrite(req, res)) return;
      const body = await readBody(req);
      try {
        const result = saveChapterBody(db, CONTENT, body);
        console.log(`[course] 改正文 ${result.course}/${result.slug}（${result.words} 字）`);
        return json(res, 200, result);
      } catch (err) {
        if (err instanceof ImportError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    if (pathname === "/api/course/delete" && req.method === "POST") {
      if (!guardWrite(req, res, true)) return;
      const body = await readBody(req);
      try {
        const out = deleteCourse(db, CONTENT, body.id);
        console.log(`[course] 移出书架《${out.title}》(${out.slug}) → ${out.trash ?? "（无 md）"}`);
        return json(res, 200, out);
      } catch (err) {
        if (err instanceof ImportError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    if (pathname === "/api/chapter/delete" && req.method === "POST") {
      if (!guardWrite(req, res, true)) return;
      const body = await readBody(req);
      try {
        const out = deleteChapter(db, CONTENT, body);
        console.log(`[course] 删章 ${out.course}/${out.slug} → ${out.trash ?? "（无 md）"}`);
        return json(res, 200, out);
      } catch (err) {
        if (err instanceof ImportError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    if (pathname === "/api/trash" && req.method === "GET") {
      return json(res, 200, { items: listTrash(CONTENT) });
    }

    if (pathname === "/api/trash/restore" && req.method === "POST") {
      // 还原是写操作，受只读模式管——它会把文件搬回 content 并入库。
      if (!guardWrite(req, res)) return;
      const body = await readBody(req);
      try {
        const out = restoreTrashCourse(db, CONTENT, body.name);
        console.log(`[course] 还原《${out.title}》(${out.slug}) → 第 ${out.index} 本`);
        return json(res, 200, out);
      } catch (err) {
        if (err instanceof ImportError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    if (pathname === "/api/import" && req.method === "POST") {
      if (!guardWrite(req, res)) return;
      const body = await readBody(req);
      try {
        const result = importChapter(db, CONTENT, {
          title: body.title,
          chapterTitle: body.chapterTitle,
          body: body.body,
          discipline: body.discipline,
          courseSlug: body.courseSlug ?? null,
          shelfId: Number.isInteger(body.shelfId) ? body.shelfId : null,
        });
        console.log(`[course] 导入 ${result.courseSlug}/${result.chapterSlug}（${result.mode}）`);
        return json(res, 201, result);
      } catch (err) {
        if (err instanceof ImportError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    if (pathname === "/api/gate") {
      return switchApi(req, res, () => readGate(db), (on, actor) => writeGate(db, on, actor), "gate");
    }

    if (pathname === "/api/readonly") {
      return switchApi(req, res, () => readReadonly(db), (on, actor) => writeReadonly(db, on, actor), "readonly");
    }

    if (pathname.startsWith("/api/")) return json(res, 404, { error: "no such api" });

    if (req.method === "GET") return serveStatic(pathname, res);
    return json(res, 405, { error: "method not allowed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[course] 500 ${pathname} ${message}`);
    json(res, 500, { error: message });
  }
});

ensureToken();
server.listen(PORT, HOST, () => {
  console.log(`[course] 服务已起：http://${HOST}:${PORT}`);
  console.log(`[course] 库：${DB_PATH}`);
  console.log(`[course] 迁移：已应用 ${appliedCount} 条，待应用 ${pending.length} 条`);
});
