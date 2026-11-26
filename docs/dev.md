# DEV · 路线与进度

这份文件是开发台账：每一步只做一件事，做完记一笔，能回退。不是待办清单。

## 定位（一次定死，避免反复）

多课程资料库：多课程并列、快速查阅、全文检索、浏览记录、（TODO）AI 语义检索。

**不做**：复习排程、间隔重复、每日任务、连续天数、打卡、排行榜。
判据：只服务「今天该学什么」的功能一律不进；只服务「我想翻到某一处」的才进。

## 验收基线（M0）

```
node .bench/bench.ts verify                     # 6 条断言，PASS / 退出码 0
curl -s :8790/api/health                        # ok:true, sqlite 3.51.3
curl -s :8790/api/courses                       # 3 门课（演示数据）
curl -sG --data-urlencode 'q=共识' :8790/api/search   # 命中「共识算法」，带片段
curl -s :8790/api/recent                        # 2 条浏览记录
npm test                                        # 6 条用例全过
```

## 基线重置（2026-11-20，第二次，记一笔）

方向从「自我学习进步（复习流）」改为「多课程查阅库」，工程名由 `rixin` 改为 `course`。库内无正式数据，因此**直接重写 0001 基线**，而不是叠一个 0002 去删表：

| 变化 | 原 | 现 | 原因 |
| --- | --- | --- | --- |
| 删 `cards` / `reviews` | 有 | 无 | 复习排程不是站点职责 |
| `progress` → `views` | 状态机 unread/reading/done | `opens / seconds / last / first` | 只要浏览事实，不要学习状态机 |
| 加 `courses.source` | — | 有 | 记录课程来源，便于回指 |
| 加 `chapters.words` | — | 有 | 列表页显示体量，不用于复习 |
| 检索副本 | trigram | trigram（不变） | 中文子串可用 |

这次重置的代价是「迁移不许改历史」这条纪律被自己破了一次。破例只在库无数据、且方向性变更时允许，记在案；有正式数据之后不再重演。

## M0 骨架 · 已完成

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| 库与迁移 | `db/migrations/0001_init.sql` | node:sqlite；6 张表 + FTS5 trigram + 3 个同步触发器 |
| 查询层 | `src/query.ts` | 课程、检索、浏览记录、章节；不碰 HTTP |
| 端点 | `server/main.ts` | 7 个 API，迭代模块只有 `api/gate` 一个触点 |
| 授权位 | `src/gate.ts` | 默认 off，写 `gate.on/off` 事件 |
| 站点壳 | `web/` | 四页签：课程 / 检索 / 记录 / 设置 |
| 自检 | `.bench/bench.ts` | list / verify / state / token；plan/apply/revert 报未实现 |
| 规格书 | `.bench/skills/00-charter.md` | 定位判据 + 三条不变量 + 改动门槛 |

已知取舍：

- `node:sqlite` 启动有 `ExperimentalWarning`，隔离在 `src/db/index.ts`；
- 检索两字以内回退 LIKE，中文不分词是既定选择，不引分词器；
- 演示数据 3 门课 7 章，验完方向即可清（命令见 README）。

## M1 内容管道 · 已完成（2026-11-20）

| 交付 | 位置 | 说明 |
| --- | --- | --- |
| md 解析与 sync | `src/sync.ts`、`npm run sync` | front matter 只认 `key: value`；upsert only，孤儿只报不删 |
| 课程详情 | `src/query.ts` 的 `getCourse`、`/api/course` | 章节列表带字数与是否读过 |
| 课程内页 | `web` 的 `CourseView` | 面包屑 + 目录，点进章节 |
| 章节阅读 | `web` 的 `ChapterView` + 极简 markdown | 段落 / h2 / 列表 / 引用 / 行内代码；上一章下一章 |
| 浏览落记 | `ChapterView` 打开即 POST `/api/view` | 不阻塞阅读 |
| 说明书 | `.bench/skills/20-content-sync.md` | md 形态、只增不删、验收三条 |

验收：

```
npm run sync        第一次 新增 3/7，第二次 全未变
npm test            11 passed
node .bench/bench.ts verify   PASS
curl /api/course?slug=ai-intro   3 章，字数 163/148/135
```

### 身份修订（同日，M1 补）

原实现用 `(课程, 文件名)` 当身份，改名会变成「新建 + 孤儿」。改为 uid：

- `0002_uid.sql`：`courses.uid` / `chapters.uid` + 唯一索引，历史行回填一次；
- `src/sync.ts` **只认 uid**，路径不参与身份判断：md 有 uid 就认，没有就新建并分配；只在 md 缺 uid 时补写一次；
- 实测（临时副本）：章节改名 + 换课程 + 课程目录改名三件事同时做，id 与 uid 不变，浏览记录 5 次 240 秒原样保留；
- 同 uid 两个文件 → 冲突报出、不写入。

已知取舍：

- 章节正文渲染是手写的极简 markdown，只覆盖本站会写的形态；引第三方渲染器的收益不足以抵一个依赖；
- 图片、公式、脚注都不支持，需要时先给方案再引；
- 一次 sync 不处理改名（改 slug 会变成「新建 + 孤儿」），需要时手工清旧行。

## 下一步

**M2 迭代模式（1 天）**：bench 的 plan / apply / snapshot / verify（含 covers 覆盖检查）/ revert 落地。验收：gate off 时 apply 拒绝；改章未更新 md 判失败并回滚；补 md 后通过；revert 回改前。

**M3 语义检索（TODO）**：先定边界——不做向量库、不引 embedding 服务；只留 `/api/ask` 的位置与 skills 说明，实现前先出方案。

## 书架远景与导入（M3，2026-11-25）

在双排版上又加了两层：书架塔 + 加书。

- **迁移 `0003_shelves.sql`**：`shelves(id, uid, name, ord UNIQUE, created_at)`，`courses.shelf_id` 外键；插入初始三层，现有课程落第 1 层。
- **层**：`GET /api/shelves` 一次返回所有层与层内的课；`POST /api/shelf {name?, position:"top"|"bottom"}` 建层，top 取 max(ord)+1、bottom 取 min(ord)-1。
- **竹竿**：远景左侧的分节柱，`bamboo-node` 数量跟层数走，每节内是该层的迷你书架（书脊数=课程数，空层画虚线框），当前层 `.on` 清晰、其余 `blur(1.1px)` 半透明；`pointer-events:none`，纯展示；主干周围另生几根 SVG 小竹（`.bamboo-sprigs`，5 根细枝 + 4 组竹叶，压在主干下层），旧三片 `.bamboo-leaf` 已删。
- **远景拖拽**：长按 520ms 直接进拖拽（无选中卡片），拖动时原位留虚线残影、目标位画红色落位槽并标「放到第 N / M 位」、垃圾桶钉在 `.shelf-wrap` 内、书架右缘且桶底与书架底线重合（`measureTrash()` 长按瞬间实测：远景取柱子底 ±16px 内最靠下的隔板底边）；桶是具象的校园绿色翻盖垃圾桶（`.trash-lid` 54×9 绿盖 + 提手、`.trash-body` 50×50 略收口桶身：桶口深槽 + 一道加强环 + 分模线，`.hot` 转砖红、`.blocked` 转灰；不再有「删层」文字），桶下是一小段木台（`.trash-sill` 台面 + `.trash-ground` 横纹台身，与书架隔板同色系），台下用 `.trash-shadow` 画一团影子；桶放页面右侧 `right:44`，与左侧柱子 `left:46` 对称；松手在别层 = `reorder`，在桶里 = 删空层。这两个接口跳过 gate（`guardWrite(..., true)`），自己摆架不需要迭代开关。
- **远景**：近景只渲染当前层；「退出」两段式——第一次只复位（`armed`），第二次才拉远，**不建层**；远景里 `↑/↓` 切层，越界才建层，且这一端已经有一层空着时不再增长，改在书架黑板点名是哪一层；**书架模式没有弹框**，全部提示都写在书架顶端常驻的黑板 `.shelf-board` 上（含空层提示、越界拦截、导入表单）；板面文案走口语短句（「上面那层还空着」「放一本书」「行」），不用公文体，板上不放删除按钮；远景里书只能选中，必须按「进入」才开课。
- **拼音 slug**：`src/pinyin.ts` + `src/pinyin.table.ts`（一次性从 pinyin-pro 生成的 GB2312 6763 字表，运行时零依赖，多音字取默认读音）。国富论→`guofulun`，AI 导论→`ai-dao-lun`。
- **导入**：`src/import.ts` 的 `importChapter` 写 md → 全量 `syncContent` → 回填 `shelf_id`；`ImportError` 带 400/404/409/413。通道只有「粘贴正文」和「本地 md/txt」，不抓网页。
- **写闸**：`guardWrite()` 统一守 `/api/shelf` 与 `/api/import`：回环 + JSON + Origin 白名单 + `bench.gate` 开。gate off 时 403 `gate-off`。
- **验收**：32 条测试全绿；`bench verify` PASS（4 份说明书）；浏览器实测进远景 → 三层可见 → 切空层时黑板提示 → 板上「加入书籍」展开表单 → 从粘贴正文导入一本 → 书落在当前层，HUD 显示「1 章 · 学科 · 更新时间」。
- **空层即是书架**：空层渲染成 `.shelf.ghost`——一块隔板 + 第一本书位置上的「（空）」占位，整块可点；点它在该层右侧贴一张半遮罩的改名卡片，保存走 `POST /api/shelf/rename`（`renameShelf` 只改 name，不动 ord）。
- **说明书**：`30-layout.md` 加「多层与远景」一节；新增 `40-import.md`；`00-charter.md` covers 补 `schema:shelves`、`api:/api/shelves`、`api:/api/shelf`、`api:/api/import`、`ui:layers`、`ui:import`。

**层可以长按拖动、拖进垃圾桶就删（2026-11-25 追加）**：远景里长按层 520ms 直接进拖拽态（不弹任何卡片/确认框），书架右缘、书架底线之上浮出垃圾桶；拖到别层松手 = `POST /api/shelf/reorder`（`fromIdx + round(-dy/rowVis)`），拖进垃圾桶松手 = `POST /api/shelf/delete`——**只删空层**，层里有书返回 400 `not-empty`，前端把桶标灰、写「有书不能删」并给提示；空层删掉后 ord 归一，只剩一层时也拒绝。两个接口都过 `guardWrite`。

已知遗留：层删除只做「并入邻层」，没有「把书挑出来单独搬」的能力；拖动重排是整层换位置，不能只换层名顺序。

## 纪律

一次只改一件事；先 md 后代码；不过 verify 不落地；被否的方案不换名重做。

## 课程页排版双风格（M1 追加）

课程页加了两套排版，可切换，选择存 `localStorage: course.layout`：

- 卡片 `cards`：原样保留，默认态。
- 立体书架 `shelf`：纯 CSS 3D（`perspective: 900px` + `preserve-3d` + `translate3d`），零新增依赖。每本书是一个薄盒（书脊 + 书页厚度面），高度按章节数算。
- 操控：`←/→` 平移（±460）、`↑/↓` 进深（-140…300）、`·` 复位，「进入 / 退出」；键盘 `←→↑↓ / Enter / Esc` 等价；单击选书、双击进入。
- 验收：711×766 视口内书架与 HUD 完整可见；切换往返不丢状态；「进入」正确打开 `/api/course` 对应课程。
- 说明书：新增 `.bench/skills/30-layout.md`（covers `ui:layout`、`ui:shelf`）。
