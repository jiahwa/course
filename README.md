# course · 多课程资料库

多课程并列管理，按需查阅：全文检索、浏览记录、（TODO）AI 语义检索。
**不是学习流**：没有复习排程、没有每日任务、没有连续天数。

```
浏览器 ──► server (node:http :8790) ──► course.db (node:sqlite, 内置)
                                          ▲
                                          │ sync
                                    content/*.md（编辑源）

终端 ──► .bench（隐藏迭代模块，无路由、无界面入口）
```

## 为什么这样切

- **内容在库**：`chapters` 存全文与 content_hash，`chapters_fts` 是检索副本。读取路径永远走库。
- **md 只是编辑源**：改内容改 md，git 能 diff，AI 能改，出错能回退；`sync` 把 md 推进库。
- **状态只在库**：浏览记录、授权位，文件里一个字都不存。
- **隐藏模块不出界面**：`.bench/` 不进前端、不加路由。界面上只有一道授权开关。

## 技术栈

| 层 | 选型 | 备注 |
| --- | --- | --- |
| 运行时 | Node ≥ 22.18，原生跑 `.ts` | 不引入编译器 |
| 数据 | `node:sqlite`（内置，SQLite 3.51.3） | 实验特性，隔离在 `src/db/index.ts` |
| 服务 | `node:http`，手写路由 | 端点数得过来 |
| 前端 | React 19 + Vite 7 | 唯一构建处，产物落 `dist/` |
| 迁移 | 自写，`db/migrations/*.sql` | 只许新增，改历史文件 hash 会对不上 |
| 检索 | FTS5 `trigram` | 三字以上 MATCH，两字以内回退 LIKE |
| 语义检索 | TODO | 先不写假实现 |

依赖只有 5 个：`react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`typescript`。

## 命令

```bash
npm start                     # 起服务 :8790（要求已 build 过前端）
npm run build                 # 构建前端到 dist/
npm run web:dev               # 前端开发 5173，/api 代理到 8790
node .bench/bench.ts verify   # 迭代自检
node .bench/bench.ts list     # 看说明书
node .bench/bench.ts state    # 看授权位
npm test                      # node:test
```

## API

| 端点 | 作用 |
| --- | --- |
| `GET /api/health` | 库、SQLite 版本、迁移状态 |
| `GET /api/courses` | 课程列表（含章节数、最近更新） |
| `GET /api/search?q=` | 全文检索，返回片段 |
| `GET /api/recent` | 浏览记录，按最后打开倒序 |
| `GET /api/course?slug=` | 课程详情：章节列表、字数、是否读过 |
| `GET /api/chapter?course=&slug=` | 章节正文 + 上/下一章 |
| `POST /api/view` | 记一次浏览，只累加次数与时间 |
| `GET/POST /api/gate` | 唯一的授权开关；POST 仅回环、JSON、Origin 白名单 |

## 那道闸

设置页只有一个开关「AI 学习文档迭代模式」，默认关。它只是**声明**：表示此刻允许 AI 按 skills 动手。真正的执行在终端，还要求 `.bench/token` 匹配，并且 verify 全绿。开关本身不提供任何能力。

## 目录

| 路径 | 职责 |
| --- | --- |
| `server/main.ts` | 静态分发 + 上述 7 个端点 |
| `src/query.ts` | 只读查询与浏览记录，不碰 HTTP |
| `src/db/index.ts` | 唯一的库入口：打开、迁移、待应用检查 |
| `src/gate.ts` | 授权位读写与事件记录 |
| `db/migrations/` | 结构变更，只增不改 |
| `.bench/skills/30-layout.md` | 课程页两套排版（卡片 / 立体书架）的规格 |
| `web/` | 四个页签：课程 / 检索 / 记录 / 设置 |
| `content/` | md 编辑源，M1 接入 sync |
| `.bench/skills/` | 站点规格书，`00-charter.md` 是章程 |

## 内容怎么加

每门课、每一章在创建时会由 `npm run sync` 分配一个 `uid`，写进 md 的 front matter；**它之后永不修改**，改名、挪目录、换课程都不换身份。

```yaml
---
title: 注意力机制
order: 1
uid: hB03637BA1A67
---
```

sync 只认 uid：有就更新、没有就是新建。所以改正文要**保留** front matter；想复制出一篇新章，改文件名并删掉 uid 行。


```bash
# 1. 在 content/<课程>/ 下写 _course.md 与章节 md
# 2. 入库
npm run sync
# 第二次跑必须全「未变」，否则说明 hash 在抖
```

md 的写法见 `.bench/skills/20-content-sync.md`。

## 当前状态

M0 骨架 + M1 内容管道：3 门示例课 7 章（人工智能导论 / 分布式系统 / 微观经济学），课程页可进课程、章节可读可翻，检索与浏览记录接真数据。
示例内容在 `content/` 里，删掉对应目录再 `npm run sync` 即可从库里移除（sync 只报孤儿不自动删，先确认再清）。

## 请示入口

改站之前先读 `.bench/skills/`；改完站必须回头改说明书，没写说明书的改动不算完成。

## 课程页排版

课程页有两套排版，右上角切换，选择记在 `localStorage` 的 `course.layout`：

- **卡片**（默认）：每门课一张卡，纵向列表。
- **立体书架**：纯 CSS 3D（`perspective` + `translate3d`，零依赖），一排书脊立在隔板上。

书架下方是操控盘：`← →` 平移、`↑ ↓` 前后进深、中间 `·` 复位、右侧「进入 / 退出」。键盘 `←→↑↓` 推视角，`Enter` 进入，`Esc` 复位；点书选中，双击进入。规格见 `.bench/skills/30-layout.md`。
