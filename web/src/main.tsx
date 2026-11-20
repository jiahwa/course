// 四个页签：课程 / 检索 / 记录 / 设置。定位是多课程查阅库：以浏览和检索为主。
// 前端不碰库、不认识隐藏模块，只认 /api。

import { useEffect, useState } from "react";
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

function Courses({ onOpen }: { onOpen: (slug: string) => void }) {
  const [items, setItems] = useState<Course[] | null>(null);

  useEffect(() => {
    fetch("/api/courses")
      .then((r) => r.json())
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  }, []);

  return (
    <section className="page">
      <p className="eyebrow">课程</p>
      <h1 className="headline">书架</h1>
      <p className="lede">多课程并列，按需查阅。内容在库，md 只是编辑源。</p>

      {items === null ? (
        <p className="hint">读取中…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="empty-line" />
          <div className="empty-line short" />
          <span className="empty-note">
            还没有课程。把板书放进 <code>content/</code>，跑 <code>npm run sync</code> 入库后这里才会出现。
          </span>
        </div>
      ) : (
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
      <h1 className="headline">查得到才算存下</h1>
      <p className="lede">全文检索标题与正文，中文子串可用。AI 语义检索是 TODO，先不假装有。</p>

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
      <h1 className="headline">翻过的地方</h1>
      <p className="lede">只记事实：哪一章、开过几次、最后一次什么时候。不做打卡，不排名。</p>

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
      <h1 className="headline">一道闸</h1>
      <p className="lede">全站只有这一个开关与迭代相关。它表示此刻允许 AI 按 skills 动手改站，不代表任何执行能力。</p>

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
            <Courses onOpen={(slug) => setView({ kind: "course", slug })} />
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
