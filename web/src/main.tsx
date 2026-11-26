// 四个页签：课程 / 检索 / 记录 / 设置。定位是多课程查阅库：以浏览和检索为主。
// 前端不碰库、不认识隐藏模块，只认 /api。

import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Tab = "courses" | "search" | "recent" | "settings";
type View = { kind: "list" } | { kind: "course"; slug: string } | { kind: "chapter"; course: string; slug: string };
type Gate = { on: boolean; updatedAt: string | null };
type Course = {
  id: number;
  slug: string;
  title: string;
  discipline: string;
  summary: string;
  chapters: number;
  updatedAt: string | null;
};
type CourseDetail = {
  course: { slug: string; title: string; discipline: string; summary: string; source: string; updatedAt: string };
  chapters: { id: number; slug: string; title: string; order: number; words: number; visited: boolean }[];
};
type Chapter = {
  id: number;
  slug: string;
  title: string;
  body: string;
  course: { slug: string; title: string };
  updatedAt: string;
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
};
type Hit = { id: number; courseSlug: string; courseTitle: string; slug: string; title: string; snippet: string };
type RecentItem = {
  id: number;
  courseSlug: string;
  courseTitle: string;
  slug: string;
  title: string;
  opens: number;
  lastOpenedAt: string;
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "—";

function useGate() {
  const [gate, setGate] = useState<Gate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/gate")
      .then((r) => r.json())
      .then(setGate)
      .catch(() => setError("读不到授权状态"));
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      setGate(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换失败");
    } finally {
      setBusy(false);
    }
  }

  return { gate, busy, error, toggle };
}

function Header({
  tab,
  setTab,
  gate,
  onSearch,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  gate: Gate | null;
  onSearch: (q: string) => void;
}) {
  const on = gate?.on === true;
  const [q, setQ] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) onSearch(q.trim());
  }

  return (
    <header className="top">
      <div className="brand">
        <span className="seal">课</span>
        <span className="wordmark">course</span>
        <span className="tagline">多课程资料库</span>
      </div>

      <nav className="tabs">
        {(
          [
            ["courses", "课程"],
            ["search", "检索"],
            ["recent", "记录"],
            ["settings", "设置"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? "tab on" : "tab"} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        <span className={on ? "lamp on" : "lamp"} title={on ? "迭代模式已授权" : "迭代模式未授权"} />
      </nav>

      <form className="quick" onSubmit={submit}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="全文检索：标题、正文"
          aria-label="全文检索"
        />
      </form>
    </header>
  );
}

/* ---------- 极简 markdown：只支持站点自己写的内容形态 ---------- */

function inline(text: string, keyBase: string) {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    nodes.push(
      tok.startsWith("**") ? (
        <strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>
      ) : (
        <code key={`${keyBase}-${i++}`}>{tok.slice(1, -1)}</code>
      ),
    );
    last = m.index + tok.length;
  }
  nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ text }: { text: string }) {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="prose">
      {blocks.map((b, i) => {
        if (b.startsWith("### ")) return <h3 key={i}>{b.slice(4)}</h3>;
        if (b.startsWith("## ")) return <h2 key={i}>{b.slice(3)}</h2>;
        if (b.startsWith("# ")) return <h2 key={i}>{b.slice(2)}</h2>;
        if (b.startsWith("> "))
          return <blockquote key={i}>{inline(b.replace(/^>\s*/gm, ""), `q${i}`)}</blockquote>;
        if (/^[-*]\s/m.test(b))
          return (
            <ul key={i}>
              {b
                .split("\n")
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>{inline(l.replace(/^[-*]\s*/, ""), `l${i}-${j}`)}</li>
                ))}
            </ul>
          );
        // 中文段落里的硬换行直接并起来，不留空格
        return <p key={i}>{inline(b.replace(/\n/g, ""), `p${i}`)}</p>;
      })}
    </div>
  );
}

/* ---------- 页面 ---------- */

type Layout = "cards" | "shelf";

type ShelfLayer = {
  id: number;
  uid: string;
  name: string;
  ord: number;
  courses: Course[];
};

const storeKey = "course.layout";
const LAYER_ROW = 260;
const FAR_SCALE = 0.46;

function Cards({ items, onOpen }: { items: Course[]; onOpen: (slug: string) => void }) {
  return (
    <div className="cards">
      {items.map((c) => (
        <article key={c.id} className="card">
          <div className="card-top">
            <span className="disc">{c.discipline}</span>
            <span className="meta">
              {c.chapters} 章 · 更新 {day(c.updatedAt)}
            </span>
          </div>
          <h2 className="card-title">{c.title}</h2>
          {c.summary ? <p className="card-sum">{c.summary}</p> : null}
          <div className="card-foot">
            <button className="link" onClick={() => onOpen(c.slug)}>
              进入
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ImportDialog({
  layer,
  layers,
  onClose,
  onDone,
}: {
  layer: ShelfLayer;
  layers: ShelfLayer[];
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterTouched, setChapterTouched] = useState(false);
  const [discipline, setDiscipline] = useState("");
  const [courseSlug, setCourseSlug] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chapterTouched) setChapterTitle(title);
  }, [title, chapterTouched]);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > 200_000) {
      setError("文件超过 20 万字符，先在里面挑一段再导入。");
      return;
    }
    const text = await file.text();
    setBody(text);
    if (!title) setTitle(file.name.replace(/\.(md|markdown|txt)$/i, ""));
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          chapterTitle,
          discipline,
          body,
          courseSlug: courseSlug || null,
          shelfId: layer.id,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(data.error ?? `导入失败（${r.status}）`);
        setBusy(false);
        return;
      }
      await onDone();
    } catch {
      setError("请求没发出去，服务还在跑吗？");
      setBusy(false);
    }
  }

  const allCourses = layers.flatMap((l) => l.courses);

  return (
    <>
      <div className="board-head">
        <span className="board-title">放一本书 · {layer.name}</span>
        <span className="board-sub">{error ?? (busy ? "正在写盘…" : "先落 md，再同步进库。")}</span>
      </div>
      <div className="import-grid board-grid">
        <label className="imp">
          <span>书名</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：国富论" />
        </label>
        <label className="imp">
          <span>学科</span>
          <input value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="经济学（可留空）" />
        </label>
        <label className="imp">
          <span>章节名</span>
          <input
            value={chapterTitle}
            onChange={(e) => {
              setChapterTouched(true);
              setChapterTitle(e.target.value);
            }}
            placeholder="默认与书名相同"
          />
        </label>
        <label className="imp">
          <span>挂到课程</span>
          <select value={courseSlug} onChange={(e) => setCourseSlug(e.target.value)}>
            <option value="">新建一门课程</option>
            {allCourses.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.title}（{c.slug}）
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="imp-file">
        <button type="button" className="board-btn" onClick={() => document.getElementById("imp-file")?.click()}>
          读本地文件
        </button>
        <input id="imp-file" type="file" accept=".md,.markdown,.txt,text/plain" onChange={pickFile} />
        <span className="board-sub">.md / .txt 直接读成正文，改完再放。</span>
      </div>

      <label className="imp wide-input">
        <span>正文</span>
        <textarea
          className="board-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="网页正文粘这儿，看一眼再放进去。"
          rows={6}
        />
      </label>
      <div className="board-actions">
        <span className="board-sub">共 {body.length} 字符</span>
        <button type="button" className="board-btn" onClick={onClose}>
          取消
        </button>
        <button type="button" className="board-btn solid" onClick={submit} disabled={busy || !title.trim() || !body.trim()}>
          放进去
        </button>
      </div>
    </>
  );
}

// 立体书架：近景一层，远景整座塔；纯 CSS 3D，零依赖。
const SEAL_DIGITS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 铭牌用篆体渲染：阿拉伯数字换成汉字小写，避免篆书里混入西文数字 */
function sealNum(name: string) {
  return name
    .replace(/[0-9]/g, (d) => SEAL_DIGITS[Number(d) - 1] ?? d)
    .replace(/\s+/g, "");
}

function Shelf({
  layers,
  gateOn,
  onOpen,
  onReload,
}: {
  layers: ShelfLayer[];
  gateOn: boolean;
  onOpen: (slug: string) => void;
  onReload: () => Promise<void>;
}) {
  const [cam, setCam] = useState({ x: 0, z: 0 });
  const [focus, setFocus] = useState(0);
  const [far, setFar] = useState(false);
  const [armed, setArmed] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [importLayer, setImportLayer] = useState<ShelfLayer | null>(null);
  const [blocked, setBlocked] = useState<"top" | "bottom" | null>(null);
  const [rename, setRename] = useState<{ layer: ShelfLayer; top: number; left: number } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<ShelfLayer | null>(null);
  const [drag, setDrag] = useState<{ id: number; dy: number; overTrash: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ top: number; left: number; width: number; height: number; name: string } | null>(
    null,
  );
  const [drop, setDrop] = useState<{ index: number; top: number; label: string } | null>(null);
  const dropRef = useRef(-1);
  const trashRef = useRef<HTMLDivElement | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [trashTop, setTrashTop] = useState<number | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const press = useRef({
    id: 0,
    x: 0,
    y: 0,
    dy: 0,
    moved: false,
    long: false,
    dragging: false,
    timer: 0,
    top: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
  });
  const suppressClick = useRef(false);
  const overTrashRef = useRef(false);

  const sorted = [...layers].sort((a, b) => a.ord - b.ord);
  const idx = Math.max(0, sorted.findIndex((l) => l.id === activeId));
  const current = sorted[idx] ?? sorted[0];

  useEffect(() => {
    if (activeId !== null) return;
    const withBooks = sorted.find((l) => l.courses.length > 0);
    if (withBooks ?? sorted[0]) setActiveId((withBooks ?? sorted[0]).id);
  }, [activeId, sorted]);

  useEffect(() => {
    setFocus((f) => Math.min(f, Math.max(0, (current?.courses.length ?? 1) - 1)));
  }, [current?.id, current?.courses.length]);

  const move = (dx: number, dz: number) => {
    setArmed(false);
    setCam((c) => ({
      x: Math.min(460, Math.max(-460, c.x + dx)),
      z: Math.min(300, Math.max(-140, c.z + dz)),
    }));
  };

  // 桶不跟视口走：底边钉在书架底线（远景 stage 底 -100）上方，横向贴着书架右侧
  function measureTrash(el: HTMLElement) {
    const wrap = el.closest(".shelf-wrap") as HTMLElement | null;
    const stage = wrap?.querySelector(".shelf-stage") as HTMLElement | null;
    if (!wrap || !stage) return;
    const wr = wrap.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    let line = sr.bottom - (far ? 100 : 14);
    // 书架底线 = 柱子底边那一层的最底隔板：在柱子底附近（±14px）找最靠下的隔板底边
    const stalk = stage.querySelector(".bamboo-stalk") as HTMLElement | null;
    if (far && stalk) {
      const base = stalk.getBoundingClientRect().bottom;
      let near = base;
      stage.querySelectorAll(".board").forEach((b) => {
        const bb = (b as HTMLElement).getBoundingClientRect().bottom;
        if (bb >= base - 6 && bb <= base + 16 && bb > near) near = bb;
      });
      line = near;
    }
    setTrashTop(Math.round(line - wr.top - 62));
  }

  // 长按层 = 选中（可拖动重排）；选中后再按住拖，松手存顺序。
  function layerDown(layer: ShelfLayer, e: React.PointerEvent<HTMLDivElement>) {
    if (!far) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    press.current = {
      id: layer.id,
      x: e.clientX,
      y: e.clientY,
      dy: 0,
      moved: false,
      long: false,
      dragging: false,
      timer: 0,
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      width: r.width,
      height: r.height,
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 某些指针类型不支持捕获，忽略 */
    }
    if (picked?.id === layer.id) {
      measureTrash(el);
      press.current.dragging = true;
      press.current.long = true;
      setGhost({ top: r.top, left: r.left, width: r.width, height: r.height, name: layer.name });
      setDrag({ id: layer.id, dy: 0, overTrash: false });
      return;
    }
    press.current.timer = window.setTimeout(() => {
      const p = press.current;
      if (!p || p.id !== layer.id || p.moved) return;
      p.long = true;
      p.dragging = true;
      suppressClick.current = true;
      measureTrash(el);
      // 长按直接进拖拽，不弹卡片：拖到别的层=换位，拖到垃圾桶=删。
      setPicked(layer);
      setGhost({ top: p.top, left: p.left, width: p.width, height: p.height, name: layer.name });
      setDrag({ id: layer.id, dy: 0, overTrash: false });
    }, 520);
  }

  function layerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = press.current;
    if (!p.id) return;
    if (Math.abs(e.clientX - p.x) > 6 || Math.abs(e.clientY - p.y) > 6) p.moved = true;
    if (!p.dragging) {
      if (p.moved && !p.long) {
        window.clearTimeout(p.timer);
        p.id = 0;
      }
      return;
    }
    p.dy = e.clientY - p.y;
    const tr = trashRef.current?.getBoundingClientRect();
    const overTrash = !!tr && e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom;
    setDrag({ id: p.id, dy: p.dy, overTrash });
    if (overTrash) overTrashRef.current = true;
    else overTrashRef.current = false;
    // 落位槽：被拖层从第 i 位挪到第 j 位，槽线画在第 i - j 行之外
    const rowVis = LAYER_ROW * FAR_SCALE;
    const fromIdx = Math.max(0, sorted.findIndex((l) => l.id === p.id));
    const last = Math.max(0, sorted.length - 1);
    const toIdx = Math.max(0, Math.min(last, fromIdx + Math.round(-p.dy / rowVis)));
    dropRef.current = toIdx;
    setDrop({
      index: toIdx,
      top: p.bottom + (fromIdx - toIdx) * rowVis,
      label: `放到第 ${toIdx + 1} / ${sorted.length} 位`,
    });
  }

  async function layerUp(e?: React.PointerEvent<HTMLDivElement>) {
    const p = press.current;
    window.clearTimeout(p.timer);
    const rowVis = LAYER_ROW * FAR_SCALE;
    const droppedOnTrash =
      overTrashRef.current ||
      (() => {
        const tr = trashRef.current?.getBoundingClientRect();
        if (!tr || !e) return false;
        return e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom;
      })();
    if (p.dragging && p.long && p.id && droppedOnTrash) {
      const layer = sorted.find((l) => l.id === p.id);
      setDrag(null);
      setDrop(null);
      setGhost(null);
      setPicked(null);
      overTrashRef.current = false;
      dropRef.current = -1;
      press.current = { id: 0, x: 0, y: 0, dy: 0, moved: false, long: false, dragging: false, timer: 0, top: 0, bottom: 0, left: 0, width: 0, height: 0 };
      if (layer && layer.courses.length > 0) {
        setNotice(`这层有 ${layer.courses.length} 本书，先清空再删。`);
        return;
      }
      if (layer) await doDelete(layer);
      return;
    }
    if (p.dragging && (Math.abs(p.dy) > 18 || dropRef.current >= 0) && p.id) {
      // 拖的是被长按的那一层，基准是它自己的位置，不是当前激活层。
      const fromIdx = Math.max(0, sorted.findIndex((l) => l.id === p.id));
      const toIndex =
        dropRef.current >= 0
          ? dropRef.current
          : Math.max(0, Math.min(sorted.length - 1, fromIdx + Math.round(-p.dy / rowVis)));
      const id = p.id;
      setDrag(null);
      setDrop(null);
      setGhost(null);
      dropRef.current = -1;
      if (toIndex !== fromIdx) {
        setReorderBusy(true);
        try {
          const r = await fetch("/api/shelf/reorder", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, toIndex }),
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            setNotice(d.error ?? "重排没成");
          } else {
            setPicked(null);
            await onReload();
          }
        } catch {
          setNotice("请求没发出去，服务还在跑吗？");
        } finally {
          setReorderBusy(false);
        }
      } else {
        setPicked(null);
      }
    } else {
      setDrag(null);
      setDrop(null);
      setGhost(null);
      dropRef.current = -1;
    }
    press.current = { id: 0, x: 0, y: 0, dy: 0, moved: false, long: false, dragging: false, timer: 0, top: 0, bottom: 0, left: 0, width: 0, height: 0 };
  }

  async function doDelete(layer: ShelfLayer) {
    setDelBusy(true);
    try {
      const r = await fetch("/api/shelf/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: layer.id }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setNotice(d.error ?? "删层没成");
        return;
      }
      setPicked(null);
      setActiveId(null);
      await onReload();
      setNotice(`删掉了：${layer.name}。`);
    } catch {
      setNotice("请求没发出去，服务还在跑吗？");
    } finally {
      setDelBusy(false);
    }
  }

  function startRename(layer: ShelfLayer, e: React.SyntheticEvent) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!gateOn) {
      setNotice("改名要开迭代模式（设置页）。");
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.min(r.right + 14, window.innerWidth - 244);
    const top = Math.max(12, Math.min(r.top - 8, window.innerHeight - 190));
    setRenameName(layer.name);
    setRename({ layer, top, left });
  }

  async function saveRename() {
    if (!rename) return;
    const name = renameName.trim();
    if (!name) {
      setNotice("层名不能为空。");
      return;
    }
    setRenameBusy(true);
    try {
      const r = await fetch("/api/shelf/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: rename.layer.id, name }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setNotice(d.error ?? "改名没成");
        return;
      }
      setRename(null);
      await onReload();
    } catch {
      setNotice("请求没发出去，服务还在跑吗？");
    } finally {
      setRenameBusy(false);
    }
  }

  async function addLayer(position: "top" | "bottom"): Promise<number | null> {
    try {
      const r = await fetch("/api/shelf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setNotice(d.error ?? "建层失败");
        return null;
      }
      const d = await r.json();
      await onReload();
      return d.id as number;
    } catch {
      setNotice("请求没发出去，服务还在跑吗？");
      return null;
    }
  }

  async function step(delta: 1 | -1) {
    const next = idx + delta;
    if (next >= 0 && next < sorted.length) {
      setActiveId(sorted[next].id);
      setFocus(0);
      return;
    }
    // 越界才长层；但这一边头上还空着一层，就先别长——空的架子不叠第二个。
    const dir = next < 0 ? "bottom" : "top";
    const edge = dir === "bottom" ? sorted[0] : sorted[sorted.length - 1];
    if (edge && edge.courses.length === 0) {
      setBlocked(dir);
      return;
    }
    if (!gateOn) {
      setNotice("长层要开迭代模式（设置页）。");
      return;
    }
    const id = await addLayer(dir);
    if (id !== null) {
      setActiveId(id);
      setFocus(0);
    }
  }

  async function enterFar() {
    setFar(true);
    setCam({ x: 0, z: 0 });
    setFocus(0);
    setNotice(null);
  }

  // 退出是两段式：第一次只复位到书架正面，第二次才拉远看整座塔。
  function exit() {
    if (far) {
      setFar(false);
      setCam({ x: 0, z: 0 });
      setFocus(0);
      setArmed(true);
      return;
    }
    if (!armed) {
      setCam({ x: 0, z: 0 });
      setFocus(0);
      setArmed(true);
      setNotice("回到书架正面了。再按一次「退出」才拉远。");
      return;
    }
    void enterFar();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(120, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        move(-120, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (far) void step(1);
        else move(0, 80);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (far) void step(-1);
        else move(0, -80);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const c = current?.courses[focus];
        if (c) onOpen(c.slug);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setEmptyLayer(null);
        setImportLayer(null);
        setFar(false);
        setCam({ x: 0, z: 0 });
        setArmed(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [far, focus, current?.id, idx, sorted.length, gateOn]);

  const height = (c: Course) => Math.min(240, 150 + c.chapters * 16);
  const now = current?.courses[focus];
  const rows = far ? sorted : current ? [current] : [];
  // 远景：层按「当前层在镜头前、其余向上叠」排布，塔的位置交给 CSS。
  const activeIdx = Math.max(0, sorted.findIndex((s) => s.id === current?.id));
  const dragLayer = drag ? sorted.find((l) => l.id === drag.id) ?? null : null;

  return (
    <div className={"shelf-wrap" + (far ? " far" : "")}>
      {/* 黑板：常驻在书架顶部，替掉原来所有弹框；删除只走垃圾桶，板上不放删除按钮 */}
      <div className={"shelf-board" + (importLayer ? " open" : "")}>
        <div className="board-face">
          {importLayer ? (
            <ImportDialog
              layer={importLayer}
              layers={sorted}
              onClose={() => setImportLayer(null)}
              onDone={async () => {
                setImportLayer(null);
                await onReload();
              }}
            />
          ) : blocked ? (
            <>
              <div className="board-head">
                <span className="board-title">
                  {blocked === "top" ? "上面那层还空着" : "下面那层还空着"}
                </span>
                <span className="board-sub">
                  {blocked === "top" ? sorted[sorted.length - 1]?.name : sorted[0]?.name}
                </span>
              </div>
              <p className="board-line">空层不叠第二个。那层先放一本书，塔才接着长。</p>
              <div className="board-actions">
                <button type="button" className="board-btn" onClick={() => setBlocked(null)}>
                  行
                </button>
              </div>
            </>
          ) : far && current && current.courses.length === 0 ? (
            <>
              <div className="board-head">
                <span className="board-title">{current.name}，空的</span>
                <span className="board-sub">全塔 {sorted.length} 层</span>
              </div>
              <p className="board-line">
                {gateOn
                  ? "本地 .md / .txt 丢进来，或者粘正文；点层名能改名。"
                  : "加书要开迭代模式，设置页里那道开关。"}
              </p>
              <div className="board-actions">
                <button
                  type="button"
                  className="board-btn solid"
                  onClick={() => {
                    if (!gateOn) {
                      setNotice("加书要开迭代模式（设置页）。");
                      return;
                    }
                    setImportLayer(current);
                  }}
                >
                  放一本书
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="board-head">
                <span className="board-title">{far ? `远景 · ${current?.name ?? ""}` : "近景"}</span>
                <span className="board-sub">
                  {far ? `${sorted.length} 层 · 这层 ${current?.courses.length ?? 0} 本` : "只看一层"}
                </span>
              </div>
              <p className="board-line">
                {far
                  ? "长按拖起来：挪到别处是换序，丢进右下角桶里就删（有书删不掉）；空层点一下改名。"
                  : "按两下「退出」拉到远景：第一下复位，第二下才拉远。"}
              </p>
            </>
          )}
        </div>
        <span className="board-tray" />
      </div>

      <div className={far ? "shelf-stage far" : "shelf-stage"}>
        {far ? (
          <div className="bamboo" aria-hidden="true">
            <svg className="bamboo-sprigs" viewBox="-30 0 200 360" aria-hidden="true">
              <defs>
                <linearGradient id="bs-stem" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0" stopColor="#5d7f60" />
                  <stop offset="0.55" stopColor="#7ba077" />
                  <stop offset="1" stopColor="#9dbd95" />
                </linearGradient>
                <linearGradient id="bs-leafA" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#557f60" />
                  <stop offset="0.5" stopColor="#6f9b70" />
                  <stop offset="1" stopColor="#adc99c" />
                </linearGradient>
                <linearGradient id="bs-leafB" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#618a64" />
                  <stop offset="0.55" stopColor="#82ab7c" />
                  <stop offset="1" stopColor="#c0d8ad" />
                </linearGradient>
              </defs>
              <g fill="none" stroke="url(#bs-stem)" strokeLinecap="round">
                <path d="M32 352 Q 14 304 2 260" strokeWidth="2.8" />
                <path d="M2 260 Q -2 236 -6 214" strokeWidth="1.9" />
                <path d="M34 344 Q 56 316 72 288" strokeWidth="2.3" />
                <path d="M34 198 Q 56 172 82 148" strokeWidth="1.7" />
                <path d="M34 198 Q 24 214 18 236" strokeWidth="1.4" />
                <path d="M34 306 Q 50 292 64 272" strokeWidth="1.5" />
              </g>
              <g fill="url(#bs-leafA)" stroke="rgba(58,84,60,0.3)" strokeWidth="0.5">
                <g transform="translate(2,260) rotate(-158)"><path d="M0 0 C 10 -4.5 24 -3.6 35 0 C 24 3.8 10 4.6 0 0" /></g>
                <g transform="translate(2,260) rotate(-120) scale(0.86)"><path d="M0 0 C 10 -4 23 -3.2 33 0 C 23 3.4 10 4.2 0 0" /></g>
                <g transform="translate(2,260) rotate(-92) scale(0.68)"><path d="M0 0 C 9 -3.6 21 -2.9 30 0 C 21 3.1 9 3.8 0 0" /></g>
                <g transform="translate(-6,214) rotate(-168) scale(0.9)"><path d="M0 0 C 10 -4.4 24 -3.5 34 0 C 24 3.7 10 4.5 0 0" /></g>
                <g transform="translate(-6,214) rotate(-134) scale(0.7)"><path d="M0 0 C 9 -3.8 22 -3 31 0 C 22 3.2 9 4 0 0" /></g>
                <g transform="translate(-6,214) rotate(-104) scale(0.55)"><path d="M0 0 C 8 -3.4 20 -2.7 28 0 C 20 2.9 8 3.6 0 0" /></g>
              </g>
              <g fill="url(#bs-leafB)" stroke="rgba(58,84,60,0.28)" strokeWidth="0.5">
                <g transform="translate(72,288) rotate(-58) scale(0.92)"><path d="M0 0 C 10 -4.4 24 -3.5 34 0 C 24 3.7 10 4.5 0 0" /></g>
                <g transform="translate(72,288) rotate(-22) scale(0.8)"><path d="M0 0 C 9 -4 22 -3.2 32 0 C 22 3.4 9 4.1 0 0" /></g>
                <g transform="translate(72,288) rotate(12) scale(0.62)"><path d="M0 0 C 8 -3.6 20 -2.8 29 0 C 20 3 8 3.7 0 0" /></g>
                <g transform="translate(82,148) rotate(-34) scale(0.86)"><path d="M0 0 C 9 -4.2 22 -3.3 32 0 C 22 3.5 9 4.3 0 0" /></g>
                <g transform="translate(82,148) rotate(-2) scale(0.7)"><path d="M0 0 C 9 -3.8 21 -3 30 0 C 21 3.2 9 4 0 0" /></g>
                <g transform="translate(82,148) rotate(28) scale(0.55)"><path d="M0 0 C 8 -3.4 19 -2.7 27 0 C 19 2.9 8 3.6 0 0" /></g>
                <g transform="translate(18,236) rotate(-142) scale(0.62)"><path d="M0 0 C 9 -3.7 21 -3 30 0 C 21 3.1 9 3.9 0 0" /></g>
                <g transform="translate(18,236) rotate(-172) scale(0.5)"><path d="M0 0 C 8 -3.3 19 -2.6 27 0 C 19 2.8 8 3.5 0 0" /></g>
                <g transform="translate(64,272) rotate(-52) scale(0.72)"><path d="M0 0 C 9 -4 22 -3.2 32 0 C 22 3.4 9 4.1 0 0" /></g>
                <g transform="translate(64,272) rotate(-18) scale(0.58)"><path d="M0 0 C 8 -3.7 20 -2.9 29 0 C 20 3.1 8 3.8 0 0" /></g>
                <g transform="translate(64,272) rotate(16) scale(0.45)"><path d="M0 0 C 8 -3.3 18 -2.6 26 0 C 18 2.8 8 3.4 0 0" /></g>
              </g>
              <g stroke="rgba(255,255,255,0.22)" strokeWidth="0.6">
                <path d="M2 260 L 32 249" />
                <path d="M-6 214 L 24 205" />
                <path d="M72 288 L 103 275" />
                <path d="M82 148 L 112 138" />
              </g>
            </svg>
            <div className="bamboo-stalk">
              {sorted.map((layer) => {
                const nodeH = Math.min(LAYER_ROW * FAR_SCALE, Math.max(40, 440 / Math.max(1, sorted.length)));
                return (
                  <div
                    key={layer.id}
                    className={"bamboo-node" + (layer.id === current?.id ? " on" : "")}
                    style={{ height: `${nodeH}px` }}
                  >
                    <div className="bn-shelf">
                      {layer.courses.slice(0, 4).map((c) => (
                        <span
                          key={c.id}
                          className="bn-book"
                          style={{ height: `${9 + Math.min(3, c.chapters) * 3}px` }}
                        />
                      ))}
                      <span className="bn-board" />
                      {layer.courses.length === 0 ? <span className="bn-empty" /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="shelf-anchor">
          <div className={far ? "tower scaled" : "tower"}>
            {rows.map((layer, rowIdx) => {
              const shift = far ? (activeIdx - rowIdx) * LAYER_ROW : 0;
              const books = layer.courses;
              return (
                <div
                  key={layer.id}
                  className={[
                    "layer",
                    far && layer.id === current?.id ? "active" : "",
                    picked?.id === layer.id ? "picked" : "",
                    drag?.id === layer.id ? "dragging" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    transform: `translateY(${shift + (drag?.id === layer.id ? drag.dy / FAR_SCALE : 0)}px)`,
                  }}
                  onPointerDown={(e) => layerDown(layer, e)}
                  onPointerMove={layerMove}
                  onPointerUp={(e) => void layerUp(e)}
                  onPointerCancel={() => void layerUp()}
                  onClickCapture={(e) => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                >
                  <span className="layer-name">{sealNum(layer.name)}</span>
                  <span className="shelf-side" />
                  {books.length === 0 ? (
                    <div
                      className="shelf ghost"
                      role="button"
                      tabIndex={0}
                      title={gateOn ? "点一下改层名" : "改层名要先在设置页打开迭代模式"}
                      onClick={(e) => startRename(layer, e)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          startRename(layer, e);
                        }
                      }}
                    >
                      <span className="book-ghost">（空）</span>
                      <span className="board" />
                    </div>
                  ) : (
                    <div className="shelf" style={far ? undefined : { transform: `translate3d(${cam.x}px, 0px, ${cam.z}px)` }}>
                      {books.map((c, i) => (
                        <button
                          key={c.id}
                          type="button"
                          className={i === focus ? "book on" : "book"}
                          style={{ "--h": `${height(c)}px` } as React.CSSProperties}
                          onClick={() => setFocus(i)}
                          onDoubleClick={() => {
                            if (!far) onOpen(c.slug);
                          }}
                          title={far ? c.title : `${c.title}（双击进入）`}
                        >
                          <span className="book-spine">
                            <em className="book-title">{c.title}</em>
                            <i className="book-disc">{c.discipline}</i>
                          </span>
                          <span className="book-side" />
                        </button>
                      ))}
                      <span className="board" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <span className="stage-vignette" />
      </div>

      <div className="shelf-hud">
        <div className="hud-now">
          <span className="hud-label">{far ? `远景 · ${current?.name ?? ""}` : "选中"}</span>
          <span className="hud-title">{now ? now.title : far ? `${current?.name ?? ""}（空）` : "—"}</span>
          <span className="hud-sub">
            {now
              ? `${now.chapters} 章 · ${now.discipline} · 更新 ${day(now.updatedAt)}`
              : far
                ? `${sorted.length} 层 · 这层 ${current?.courses.length ?? 0} 本`
                : ""}
          </span>
        </div>

        <div className="hud-keys">
          <div className="pad" role="group" aria-label="视角">
            <span />
            <button type="button" onClick={() => (far ? void step(1) : move(0, 80))} title={far ? "上一层" : "前进"}>
              ↑
            </button>
            <span />
            <button type="button" onClick={() => move(120, 0)} title="往左（←）">
              ←
            </button>
            <button
              type="button"
              onClick={() => {
                setCam({ x: 0, z: 0 });
                setFocus(0);
              }}
              title="复位（Esc）"
            >
              ·
            </button>
            <button type="button" onClick={() => move(-120, 0)} title="往右（→）">
              →
            </button>
            <span />
            <button type="button" onClick={() => (far ? void step(-1) : move(0, -80))} title={far ? "下一层" : "后退"}>
              ↓
            </button>
            <span />
          </div>
          <div className="pad-act">
            <button type="button" className="act on" onClick={() => now && onOpen(now.slug)} disabled={!now}>
              进入
            </button>
            <button type="button" className="act" onClick={exit}>
              {far ? "回近景" : "退出"}
            </button>
          </div>
        </div>
      </div>
      <p className="hud-hint">
        {far ? "↑↓ 换层。书点不进去，选中后按「进入」。" : "方向键转视角，Enter 进入，Esc 复位。"}
      </p>
      {notice ? (
        <p className="hud-notice" onClick={() => setNotice(null)}>
          {notice}（点此关闭）
        </p>
      ) : null}

      {drag ? (
        <>
          {ghost ? (
            <div
              className="layer-echo"
              style={{ top: ghost.top, left: ghost.left, width: ghost.width, height: ghost.height }}
            >
              <span className="echo-name">{ghost.name}</span>
            </div>
          ) : null}
          {drop && ghost && !drag.overTrash ? (
            <div className="drop-slot" style={{ top: drop.top, left: ghost.left, width: ghost.width }}>
              <span className="drop-label">{drop.label}</span>
            </div>
          ) : null}
          <div
            ref={trashRef}
            className={
              drag.overTrash
                ? dragLayer && dragLayer.courses.length > 0
                  ? "shelf-trash blocked"
                  : "shelf-trash hot"
                : "shelf-trash"
            }
            style={trashTop == null ? undefined : { top: `${trashTop}px` }}
          >
            <span className="trash-label">
              {!drag.overTrash
                ? "拖到桶上就删这层"
                : dragLayer && dragLayer.courses.length > 0
                  ? "这层里还有书，删不掉"
                  : "松手就删这层"}
            </span>
            <span className="trash-shadow" />
            <span className="trash-sill" />
            <span className="trash-ground" />
            <span className="trash-lid" />
            <span className="trash-body" />
          </div>
        </>
      ) : null}

      {rename ? (
        <div className="layer-mask" onClick={() => setRename(null)}>
          <div
            className="rename-card"
            style={{ top: `${rename.top}px`, left: `${rename.left}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="rename-label">改层名</p>
            <input
              className="rename-input"
              value={renameName}
              autoFocus
              maxLength={40}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveRename();
                if (e.key === "Escape") setRename(null);
              }}
            />
            <div className="rename-actions">
              <button type="button" className="xp-btn" onClick={() => setRename(null)}>
                取消
              </button>
              <button type="button" className="xp-btn primary" disabled={renameBusy} onClick={() => void saveRename()}>
                {renameBusy ? "存…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}

function Courses({ onOpen, gateOn }: { onOpen: (slug: string) => void; gateOn: boolean }) {
  const [layers, setLayers] = useState<ShelfLayer[] | null>(null);
  const [layout, setLayout] = useState<Layout>(() =>
    localStorage.getItem(storeKey) === "shelf" ? "shelf" : "cards",
  );

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/shelves");
      if (r.ok) {
        const d = await r.json();
        setLayers(d.items as ShelfLayer[]);
        return;
      }
      // 老库没有层也要能看：退回单一虚拟层
      const c = await fetch("/api/courses");
      const d = await c.json();
      setLayers([
        { id: 0, uid: "s0", name: "全部", ord: 1, courses: (d.items ?? []).map((x: Course) => ({ ...x, shelfId: 0 })) },
      ]);
    } catch {
      setLayers([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    localStorage.setItem(storeKey, layout);
  }, [layout]);

  const allCourses = (layers ?? []).flatMap((l) => l.courses);

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">课程</p>
          <h1 className="headline">书架</h1>
        </div>
        <div className="layout-switch" role="group" aria-label="排版风格">
          <button type="button" className={layout === "cards" ? "on" : ""} onClick={() => setLayout("cards")}>
            卡片
          </button>
          <button type="button" className={layout === "shelf" ? "on" : ""} onClick={() => setLayout("shelf")}>
            立体书架
          </button>
        </div>
      </div>
      <p className="lede">多课程并列，按需查阅。内容在库，md 只是编辑源。</p>

      {layers === null ? (
        <p className="hint">读取中…</p>
      ) : allCourses.length === 0 ? (
        <div className="empty">
          <div className="empty-line" />
          <div className="empty-line short" />
          <span className="empty-note">
            还没有课程。把板书放进 <code>content/</code>，跑 <code>npm run sync</code> 入库后这里才会出现。
          </span>
        </div>
      ) : layout === "cards" ? (
        <Cards items={allCourses} onOpen={onOpen} />
      ) : (
        <Shelf layers={layers} gateOn={gateOn} onOpen={onOpen} onReload={reload} />
      )}
    </section>
  );
}

function CourseView({
  slug,
  onOpen,
  onBack,
}: {
  slug: string;
  onOpen: (chapterSlug: string) => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<CourseDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`/api/course?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("404"))))
      .then(setData)
      .catch(() => setMissing(true));
  }, [slug]);

  if (missing) return <p className="hint">查无此课。</p>;
  if (!data) return <p className="hint">读取中…</p>;

  return (
    <section className="page">
      <div className="crumb">
        <button className="link" onClick={onBack}>
          书架
        </button>
        <span className="slash">/</span>
        <span>{data.course.title}</span>
      </div>

      <p className="eyebrow">{data.course.discipline}</p>
      <h1 className="headline">{data.course.title}</h1>
      {data.course.summary ? <p className="lede">{data.course.summary}</p> : null}

      <ol className="toc">
        {data.chapters.map((c) => (
          <li key={c.id} className="toc-item">
            <button className="toc-btn" onClick={() => onOpen(c.slug)}>
              <span className="toc-no">{String(c.order).padStart(2, "0")}</span>
              <span className="toc-title">{c.title}</span>
              <span className="toc-meta">
                {c.visited ? "已读 · " : ""}
                {c.words} 字
              </span>
            </button>
          </li>
        ))}
      </ol>

      {data.course.source ? <p className="foot">来源：{data.course.source}</p> : null}
    </section>
  );
}

function ChapterView({
  course,
  slug,
  onBack,
  onOpen,
}: {
  course: string;
  slug: string;
  onBack: () => void;
  onOpen: (chapterSlug: string) => void;
}) {
  const [data, setData] = useState<Chapter | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setData(null);
    setMissing(false);
    fetch(`/api/chapter?course=${encodeURIComponent(course)}&slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("404"))))
      .then((c: Chapter) => {
        setData(c);
        // 打开即记一条浏览，不阻塞阅读
        fetch("/api/view", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chapterId: c.id }),
        }).catch(() => {});
      })
      .catch(() => setMissing(true));
  }, [course, slug]);

  if (missing) return <p className="hint">查无此章。</p>;
  if (!data) return <p className="hint">读取中…</p>;

  return (
    <section className="page">
      <div className="crumb">
        <button className="link" onClick={onBack}>
          书架
        </button>
        <span className="slash">/</span>
        <span>{data.course.title}</span>
      </div>

      <article className="chapter">
        <h1 className="chapter-title">{data.title}</h1>
        <p className="chapter-meta">
          更新 {day(data.updatedAt)} · {data.body.replace(/\s+/g, "").length} 字
        </p>
        <Markdown text={data.body} />
      </article>

      <div className="pager">
        {data.prev ? (
          <button className="pager-btn" onClick={() => onOpen(data.prev!.slug)}>
            <span className="pager-dir">上一章</span>
            <span className="pager-name">{data.prev.title}</span>
          </button>
        ) : (
          <span />
        )}
        {data.next ? (
          <button className="pager-btn next" onClick={() => onOpen(data.next!.slug)}>
            <span className="pager-dir">下一章</span>
            <span className="pager-name">{data.next.title}</span>
          </button>
        ) : (
          <span />
        )}
      </div>
    </section>
  );
}

function Search({
  initial,
  onOpenChapter,
}: {
  initial: string;
  onOpenChapter: (course: string, slug: string) => void;
}) {
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setItems(null);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((d) => setItems(d.items))
        .catch(() => setItems([]))
        .finally(() => setBusy(false));
    }, 260);
    return () => clearTimeout(timer);
  }, [q]);

  function marked(text: string, term: string) {
    if (!term) return text;
    const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((p, i) =>
      p.toLowerCase() === term.toLowerCase() ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>,
    );
  }

  return (
    <section className="page">
      <p className="eyebrow">检索</p>
      <h1 className="headline">内容检索</h1>
      <p className="lede">全文检索标题与正文。</p>
      {/* <p>AI 语义检索是 TODO，先不假装有。</p> */}

      <div className="searchbox">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入关键词，至少两字" />
        <span className="count">{busy ? "检索中" : items ? `${items.length} 条` : ""}</span>
      </div>

      {items === null ? (
        <p className="hint">输入关键词开始。两字查询走子串匹配，三字以上走全文索引。</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="empty-note">没有命中。换个词，或确认内容已经 sync 入库。</span>
        </div>
      ) : (
        <ul className="results">
          {items.map((h) => (
            <li key={h.id} className="hit">
              <button className="hit-link" onClick={() => onOpenChapter(h.courseSlug, h.slug)}>
                <div className="hit-head">
                  <span className="disc">{h.courseTitle}</span>
                  <span className="hit-title">{h.title}</span>
                </div>
                <p className="hit-snip">{marked(h.snippet, q.trim())}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Recent({ onOpenChapter }: { onOpenChapter: (course: string, slug: string) => void }) {
  const [items, setItems] = useState<RecentItem[] | null>(null);

  useEffect(() => {
    fetch("/api/recent")
      .then((r) => r.json())
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  }, []);

  return (
    <section className="page">
      <p className="eyebrow">记录</p>
      <h1 className="headline">最近浏览</h1>
      {/* <p className="lede">只记事实：哪一章、开过几次、最后一次什么时候。不做打卡，不排名。</p> */}

      {items === null ? (
        <p className="hint">读取中…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="empty-note">还没有浏览记录。打开任一章节后自动落一条。</span>
        </div>
      ) : (
        <ul className="records">
          {items.map((v) => (
            <li key={v.id} className="record">
              <button className="rec-btn" onClick={() => onOpenChapter(v.courseSlug, v.slug)}>
                <span className="rec-title">{v.title}</span>
                <span className="rec-course">{v.courseTitle}</span>
                <span className="rec-meta">
                  {v.opens} 次 · {day(v.lastOpenedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Settings() {
  const { gate, busy, error, toggle } = useGate();
  const on = gate?.on === true;

  return (
    <section className="page">
      <p className="eyebrow">设置</p>
      <h1 className="headline">AI设置</h1>
      <p className="lede">授权开关设置，不代表任何执行能力。</p>

      <div className="switch-row">
        <div>
          <div className="switch-title">AI 学习文档迭代模式</div>
          <div className="switch-sub">
            {gate === null
              ? "读取中…"
              : on
                ? "已授权。执行仍须在终端持 token 并跑 verify。"
                : "未授权。任何迭代动作都会被拒绝。"}
          </div>
        </div>
        <button className={on ? "switch on" : "switch"} disabled={busy || gate === null} onClick={() => toggle(!on)} aria-pressed={on}>
          <span className="knob" />
        </button>
      </div>

      {error ? <p className="err">{error}</p> : null}
      <p className="foot">授权时间：{gate?.updatedAt ? new Date(gate.updatedAt).toLocaleString("zh-CN") : "—"}</p>
    </section>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("courses");
  const [view, setView] = useState<View>({ kind: "list" });
  const [query, setQuery] = useState("");
  const { gate } = useGate();

  function goCourses() {
    setTab("courses");
    setView({ kind: "list" });
  }

  function openSearch(q: string) {
    setQuery(q);
    setTab("search");
  }

  function openChapter(course: string, slug: string) {
    setTab("courses");
    setView({ kind: "chapter", course, slug });
  }

  function switchTab(t: Tab) {
    if (t === "courses") setView({ kind: "list" });
    setTab(t);
  }

  return (
    <div className="shell">
      <Header tab={tab} setTab={switchTab} gate={gate} onSearch={openSearch} />
      <main>
        {tab === "courses" ? (
          view.kind === "course" ? (
            <CourseView
              slug={view.slug}
              onBack={goCourses}
              onOpen={(chapterSlug) => setView({ kind: "chapter", course: view.slug, slug: chapterSlug })}
            />
          ) : view.kind === "chapter" ? (
            <ChapterView
              course={view.course}
              slug={view.slug}
              onBack={goCourses}
              onOpen={(s) => setView({ kind: "chapter", course: view.course, slug: s })}
            />
          ) : (
            <Courses onOpen={(slug) => setView({ kind: "course", slug })} gateOn={gate?.on ?? false} />
          )
        ) : tab === "search" ? (
          <Search initial={query} onOpenChapter={openChapter} />
        ) : tab === "recent" ? (
          <Recent onOpenChapter={openChapter} />
        ) : (
          <Settings />
        )}
      </main>
      <footer className="foot-note">M1 · 内容管道</footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
