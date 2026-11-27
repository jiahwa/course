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
| 端点 | `server/main.ts` | 静态分发 + 若干小 API；设置页两个触点 `api/readonly`（管写）与 `api/gate`（游离） |
| 授权位 | `src/gate.ts` | 两道开关：`readonly` 管写操作，`bench.gate` 游离；都默认 off，各写自己的事件 |
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
- **远景拖拽**：长按 520ms 直接进拖拽（无选中卡片），拖动时原位留虚线残影、目标位画红色落位槽并标「放到第 N / M 位」、垃圾桶钉在 `.shelf-wrap` 内、书架右缘且桶底与书架底线重合（`measureTrash()` 长按瞬间实测：远景取柱子底 ±16px 内最靠下的隔板底边）；桶是具象的校园绿色翻盖垃圾桶（`.trash-lid` 54×9 绿盖 + 提手、`.trash-body` 50×50 略收口桶身：桶口深槽 + 一道加强环 + 分模线，`.hot` 转砖红、`.blocked` 转灰；不再有「删层」文字），桶下是一小段木台（`.trash-sill` 台面 + `.trash-ground` 横纹台身，与书架隔板同色系），台下用 `.trash-shadow` 画一团影子；桶放页面右侧 `right:44`，与左侧柱子 `left:46` 对称；松手在别层 = `reorder`，在桶里 = 删空层。这两个接口跳过只读模式（`guardWrite(..., true)`），自己摆架不需要开关。
- **远景**：近景只渲染当前层；「退出」两段式——第一次只复位（`armed`），第二次才拉远，**不建层**；远景里 `↑/↓` 切层，越界才建层，且这一端已经有一层空着时不再增长，改在书架黑板点名是哪一层；**书架模式没有弹框**，全部提示都写在书架顶端常驻的黑板 `.shelf-board` 上（含空层提示、越界拦截、导入表单）；板面文案沿用朴素书面句（「上面那一层还空着」「加入书籍」「知道了」；空层只读模式开着写「只读模式开着，加入书籍要先关掉它（设置页）。」），2026-11-25 的「短句口语」整版改写已按用户要求于 2026-11-27 回退，板上不放删除按钮；远景里书只能选中，必须按「进入」才开课。
- **拼音 slug**：`src/pinyin.ts` + `src/pinyin.table.ts`（一次性从 pinyin-pro 生成的 GB2312 6763 字表，运行时零依赖，多音字取默认读音）。国富论→`guofulun`，AI 导论→`ai-dao-lun`。
- **导入**：`src/import.ts` 的 `importChapter` 写 md → 全量 `syncContent` → 回填 `shelf_id`；`ImportError` 带 400/404/409/413。通道只有「粘贴正文」和「本地 md/txt」，不抓网页。
- **写闸**：`guardWrite()` 统一守 `/api/shelf`、`/api/import`、`/api/chapter/save`：回环 + JSON + Origin 白名单 + 只读模式关着。只读模式开时 403 `readonly-on`；换序与三类删除传 `true` 跳过这道闸。
- **验收**：32 条测试全绿；`bench verify` PASS（4 份说明书）；浏览器实测进远景 → 三层可见 → 切空层时黑板提示 → 板上「加入书籍」展开表单 → 从粘贴正文导入一本 → 书落在当前层，HUD 显示「1 章 · 学科 · 更新时间」。
- **空层即是书架**：空层渲染成 `.shelf.ghost`——一块隔板 + 第一本书位置上的「（空）」占位，整块可点；点它在该层右侧贴一张半遮罩的改名卡片，保存走 `POST /api/shelf/rename`（`renameShelf` 只改 name，不动 ord）。
- **说明书**：`30-layout.md` 加「多层与远景」一节；新增 `40-import.md`；`00-charter.md` covers 补 `schema:shelves`、`api:/api/shelves`、`api:/api/shelf`、`api:/api/import`、`ui:layers`、`ui:import`。

**层可以长按拖动、拖进垃圾桶就删（2026-11-25 追加）**：远景里长按层 520ms 直接进拖拽态（不弹任何卡片/确认框），书架右缘、书架底线之上浮出垃圾桶；拖到别层松手 = `POST /api/shelf/reorder`（`fromIdx + round(-dy/rowVis)`），拖进垃圾桶松手 = `POST /api/shelf/delete`——**只删空层**，层里有书返回 400 `not-empty`，前端把桶标灰、写「有书不能删」并给提示；空层删掉后 ord 归一，只剩一层时也拒绝。两个接口都过 `guardWrite`。

已知遗留：层删除只做「并入邻层」，没有「把书挑出来单独搬」的能力；拖动重排是整层换位置，不能只换层名顺序。

## 近景拖书换序（2026-11-26）

一层里几本书也能排序了，顺序和书架看到的完全一致。

- **接口**：`POST /api/course/reorder {id, toIndex}`（`server/main.ts`）→ `src/query.ts` 的 `reorderCourse`。只处理同一 `shelf_id` 的书，按现序抽出再插入 `toIndex`，从该层最小值起连续赋 `sort_order`（事务内完成），别的层不受影响；同一位置返回 `unchanged`。走 `guardWrite(req,res,true)`，跳过只读模式。
- **代码结构**：拖拽核心单文件 `web/src/bookDrag.ts`（`createBookDrag`，纯几何状态机：阈值 8px、插入下标、落位槽相对坐标、`release` 给 `{id, from, to, changed}`），不 import React、不查 DOM、不写样式；观感另放 `web/src/bookDrag.css`；`main.tsx` 只留 `bookDown/bookMove/bookUp` 接线。删掉 CSS 仍能拖，换判定只动 `bookDrag.ts`。
- **前端**：`bookDown/bookMove/bookUp` 三件套。按下时把同层所有书的 `getBoundingClientRect()` 拍快照；移动超过 8px 才算拖动（否则还是点击/双击），目标位 = 指针越过了几本别的书中心；拖动中被拖书 `--bx` 跟手、`.book.dragging .book-3d` 抬起（`rotateY(-14deg) translateZ(34px) scale(1.03)`），`.book-slot` 竖虚线 + 「第 N 位」标签标落点；松手发请求，成功后 `onReload()` 并选中新位置。原位松手不发请求，且 400ms 内吞掉紧随的 click，避免顺手选中别的书。
- **命中区修复（顺带）**：`.book` button 原来是 `rotateY(-26deg)`，父 `.shelf` 的 3D 平面把书左半边挡住——`elementFromPoint` 在书中心返回的是 `shelf`，只有右半条能点。现在 button 本体 `transform-style: flat`，旋转/位移/抬起交给内层 `.book-3d`，四本书中心全部命中。视觉不变。
- **说明书**：`30-layout.md` 加「近景拖书换序」一节，covers 补 `ui:bookdrag`、`api:/api/course/reorder`；截图基线补 `docs/preview/book-drag.png`。

## 站内改章节正文（2026-11-26）

导入进来的书原本只能看，不能改。补的是一条最短路径：只改章节正文，其余不动。

- **接口**：`POST /api/chapter/save {course, slug, body}`（`server/main.ts`）→ `src/import.ts` 的 `saveChapterBody`。过 `guardWrite`（回环 + Origin + JSON + 只读模式关着），`course`/`slug` 走白名单 `^[A-Za-z0-9_-]+$`，正文空 400、超 200k 413，库里查不到这对 slug 404。
- **写盘规则**：路径只由库里的 slug 推出（`content/<course>/<slug>.md`，再夹在 `contentDir` 内），**front matter 整段原样保留**（title / order / uid 不动），只替换正文；写完立刻在进程内 `syncContent`，字数、hash、列表一起更新。uid 保住，浏览记录不断。
- **不做**：不加 `POST /api/sync`，设置页也不放「重扫 md」——外部手改 md 之后仍走终端 `npm run sync`。改书名 / 学科 / 删书这次都不做。
- **前端**：`ChapterView` 正文右上角一个「改正文」（只读模式开着不出），点开把正文灌进 `.chapter-editor`，下面是字数、取消、保存；存完 `reload()` 同一章，编辑态关闭，错误原文贴在 textarea 下方。
- **说明书**：新增 `50-edit.md`；`00-charter.md` covers 补 `api:/api/chapter/save`、`ui:edit`。截图基线补 `docs/preview/chapter-view.png`、`chapter-edit.png`。

## 纪律

一次只改一件事；先 md 后代码；不过 verify 不落地；被否的方案不换名重做。

## 课程页排版双风格（M1 追加）

课程页加了两套排版，可切换，选择存 `localStorage: course.layout`：

- 卡片 `cards`：原样保留，默认态。
- 立体书架 `shelf`：纯 CSS 3D（`perspective: 900px` + `preserve-3d` + `translate3d`），零新增依赖。每本书是一个薄盒（书脊 + 书页厚度面），高度按章节数算。
- 操控：`←/→` 平移（±460）、`↑/↓` 进深（-140…300）、`·` 复位，「进入 / 退出」；键盘 `←→↑↓ / Enter / Esc` 等价；单击选书、双击进入。
- 验收：711×766 视口内书架与 HUD 完整可见；切换往返不丢状态；「进入」正确打开 `/api/course` 对应课程。
- 说明书：新增 `.bench/skills/30-layout.md`（covers `ui:layout`、`ui:shelf`）。

截图基线放在 `docs/preview/`（6 张当前状态图 + README 说明）；迭代中间图不再进仓库。

## 铭牌字体改回正文衬线（2026-11-27）

- 层名铭牌不再用篆体：`web/src/styles.css` 删掉 `@font-face "Seal Script"`，`.layer-name` 不再设 `font-family`（继承正文衬线栈）；`web/src/main.tsx` 删 `SEAL_DIGITS` / `sealNum()`，铭牌直接渲染 `layer.name`，显示回到「第 1 层」原样。
- 字体资源整体移除：`web/public/fonts/`（`JFZSKSealScript.woff2` 837KB + `OFL-JFZSKSealScript.txt`）已删，`dist/` 不再带字体。
- 字号由 31px 收到 27px（`.tower.scaled .layer-name`）：宋体字面比篆体更满，收一档后牌内左右留白正常，远景视觉字号约 12px 仍可读。牌面仍为棕木底 + 黑金边 + `#f2e5cb` 字。

## 类型检查与死代码清理（2026-11-27）

- 根目录补 `tsconfig.json`（strict + `noUnusedLocals`/`noUnusedParameters` + `allowImportingTsExtensions` + `noEmit`），`package.json` 加 `npm run typecheck`（`tsc --noEmit`），devDependency 补 `@types/node`。此前项目只有 Vite 打包、没有类型检查，类型错误会一路带到运行时。
- 修掉的真实缺陷：
  - `Shelf` 的 Esc 分支调用了早已不存在的 `setEmptyLayer(null)`，每次按 Esc 都抛 `ReferenceError`——`setImportLayer(null)` 之后的复位全部不执行。已删这一行。
  - 删掉只写不读的 `delBusy` / `reorderBusy` 两个 state 及其 `set*` 调用（连带去掉只为重置它们存在的 `finally`）。
  - `press.current` 的 13 字段字面量重复三处 → 提取 `LayerPress` 类型与 `emptyPress()` 工厂。
- `bookDrag.ts` 的 `cancel()` 原本无人调用：接到 Esc 上（拖拽中按 Esc 丢掉按下态并清掉 `book-dragging` / 落位槽），不再有孤儿 API。
- 现状：`npm run typecheck` 干净（server / src / web / tests 全覆盖），`npm test` 42 条绿，`bench verify` PASS。

## 黑板文案整体回退（2026-11-27）

- 用户判定 2026-11-25 那版「口语短句、去公文体」的黑板改写阅读体验更差，要求整版撤回。已按滚存截图（`git show HEAD:docs/shots/board-final-near|far|blocked|empty|empty-gate|import.png`）逐字恢复：
  - 近景：副标「一次只放一层」，提示「按「退出」两次拉远看整座塔：第一次复位，第二次才拉远。」，按钮「加入书籍」+ 旧口径小字。
  - 远景：副标「共 N 层 · 本层 M 门课」，提示「长按一层拖动换位，拖进右下角的垃圾桶删掉空层；点左墙的牌子改名。」（改动前原文是「点空层改名」，改名入口 2026-11-26 已移到左墙铭牌，这半句按现状校正）
  - 空层：「第 N 层 还没有书」/「共 N 层」；gate 开「可以选本地 .md / .txt，或者把网页正文粘进来；点层名还能给它改个名字。」+「加入书籍」；gate 关「加入书籍属于维护动作，需要先在设置页打开那道开关。」
  - 越界：「上面那一层还空着」/「下面那一层还空着」+ 层名 +「空着的架子不叠第二个。先往那一层放一本书，再继续长层。」+「知道了」。
  - 导入表单：「加入书籍 · 层名」「写成 md，再 sync 入库。」「从本地文件读入」「md / .txt，读进来就是下面的正文，可以先改再提交。」placeholder「把网页正文粘在这里，会先原样显示，确认无误再点「加入」。」按钮「加入」。
- 未回退：`setNotice` 文案、HUD 提示行（改动前的原文没有留存，保持现状）；功能入口（近景「加入书籍」按钮、铭牌改名、拖书换序）全部保留。
- 验证：`npm run typecheck` 干净、`npm test` 42 绿、`bench verify` PASS；浏览器逐状态核对与旧截图一致。

## 删书与删章（2026-11-27）

- **删整本书（A 方案·拖进桶）**：近景按住书往右下角拖，越出书架落到桶上（桶由 `drag || bookView` 触发渲染，`hot` 变红），松手即移出。`bookDrag.ts` 的 `press` 多收一个可选 `trash` 矩形，`move` 的视图与 `release` 的结果都带 `overTrash`；桶矩形由 `main.tsx` 的 `bucketBox()` 在按下时算好（`.shelf-trash` 定位 right 14 / 宽 64 / 高 62，位置来自 `measureTrash` 返回的 top），核心仍只做几何。落在桶里时不画落位槽、不换序；Esc 取消。
- **删单章（标题右侧按钮）**：`ChapterView` 标题右边「改正文」旁并排「删除」，两段式（第一下变「确认删除」，3 秒不复原则自动回退），执行 `POST /api/chapter/delete`，成功后回书架。不弹框。
- **数据落点**：两条删除都把文件移进 `content/.trash/`（课程目录 `<slug>-<时间戳>/`、单章 `<课程>-<章节>.md-<时间戳>`），库里的行删掉。`sync` 只扫不以 `.` 开头的目录，所以 `.trash` 不会被导回来；要找回就把目录/文件挪回 `content/` 再 `npm run sync`。
- **接口**：`POST /api/course/delete {id}`、`POST /api/chapter/delete {course, slug}`，都走 `guardWrite(req,res,true)`（跳过只读模式，与层删除/换序一致），slug 走 `^[A-Za-z0-9_-]+$`，路径夹在 `contentDir` 内；分别 400/404。
- **验收**：`npm run typecheck` 干净，`npm test` 47 条绿（新增 `tests/m6.test.ts` 三条、`tests/bookdrag.test.ts` 两条），`bench verify` PASS；浏览器实测拖书进桶后书从书架消失、目录落 `content/.trash/`，删章后 md 进 `.trash`、课程保留、章数归零。测试用的临时书与 `.trash` 残留已清理，四本书原序未动。

## 只读模式与删书确认（2026-11-27）

用户拍板：「不走 gate，二次确认，确认内容在黑板上显示」，并要求把「只读模式」从 gate 里剥出来、单独管操作。

- **两个开关**：`src/gate.ts` 拆成 `readonly`（管操作）与 `bench.gate`（游离）。`readSwitch/writeSwitch` 是共用底座，各自写事件 `readonly.on/off`、`gate.on/off`。只读模式默认关，`GET/POST /api/readonly` 走和 `/api/gate` 同一套校验（`switchApi`：回环 / Origin 白名单 / JSON / `on` 必须布尔）。
- **写闸改写**：`guardWrite(req,res,skipGate)` 的第三参改判只读模式——开着返回 403 `{ code:"readonly-on" }`，文案「只读模式开着：请先去设置页关掉它」。受管：`/api/shelf`、`/api/shelf/rename`、`/api/import`、`/api/chapter/save`。不受管（传 `true`）：`/api/shelf/reorder`、`/api/shelf/delete`、`/api/course/reorder`、`/api/course/delete`、`/api/chapter/delete`——删除靠黑板二次确认兜底，不靠开关。
- **前端**：`useGate` 换成 `useSwitch(path)`，App 里只读模式一份（`/api/readonly`），设置页自己再取 gate。`gateOn` 全量改名 `writable`；「改正文」仍随 `writable` 出没，章节页「删除」改为始终显示（删除不走只读模式）。顶栏灯改为「可写才亮」，近景「加入书籍」、铭牌改名在只读模式下只出一条提示。
- **黑板确认卡**：书拖进桶松手不再直接删——`bookUp` 只 `setConfirmDel({id, title})`；黑板新增最高优先分支（次于导入表单）：「要移出《X》吗 / 这一步会删掉这本书」，正文「文件挪到回收目录 content/.trash，能手动找回。」+ 只读模式开着时补「确认的同时会顺手关掉设置页的「只读模式」。」。按钮「我知道了」只 `setConfirmDel(null)`，书原样放下；「确认」走 `deleteConfirmed()`：只读模式开着先 `POST /api/readonly {on:false}`（经 `onReadonlyOff` → `toggle(false)` 同步全局状态），再 `POST /api/course/delete`，成功通知「已移出《X》，放在回收目录里，能手动找回。」。桶上标签随之改成「拖到桶上就问你删不删 / 松手会问你一句」。
- **Esc 收口**（顺带修掉回归里发现的问题）：书架窗口级 Escape 现在一次收掉拖拽、确认卡、改名卡、越界提示、导入表单再复位镜头；改名输入里的 Escape `stopPropagation`，不再一按同时关卡片又拉回近景；课程页 / 章节页加 App 级 Escape 回书架（正编辑正文时归 textarea 自己：Esc 取消编辑、留在章节页）。
- **测试**：新增 `tests/m7.test.ts` 三条（只读模式默认关 / 两开关互不影响 / 反复写只留一行与最新值），全量 50 条绿；`typecheck` 干净、`bench verify` PASS、`npm run build` 通过。
- **浏览器实测**：只读模式开 → 加书提示「只读模式开着，先去设置页关掉它。」、章节页只剩「删除」；拖书进桶 → 黑板确认卡；点「我知道了」书还在、只读模式不变；再拖 → 点「确认」→ 书从书架消失、`content/.trash/` 落 `<slug>-<时间戳>/`、通知正确、`/api/readonly` 变 off；课程页 / 章节页 Esc 返回正常；远景 Esc 回近景后越界提示已清。
