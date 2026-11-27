---
name: import
covers: [api:/api/shelves, api:/api/shelf, api:/api/shelf/rename, api:/api/shelf/delete, api:/api/shelf/reorder, api:/api/import, ui:import, ui:layers, schema:shelves, content:md, script:sync]
last-applied: 2026-11-25
---

# 40 · 层与导入

书架能「往上长层」，也能「往层里加书」。两件事都是**写操作**，所以都要过同一道闸。

## 一道闸：guardWrite

`server/main.ts` 的 `guardWrite(req, res)` 统一守 `POST /api/shelf` 和 `POST /api/import`，四条缺一不可：

1. 回环地址（只服务本机）。
2. `content-type: application/json`。
3. `Origin` 在白名单（`http://127.0.0.1:8790`、`http://localhost:8790`、`http://127.0.0.1:5173`）。
4. `settings['readonly'] = off`（只读模式关着）。

第 4 条不满足时返回 `403 { code:"readonly-on" }`，文案是「只读模式开着：请先去设置页关掉它」。开关只在设置页，界面之外没有别的入口；`.bench/` 不加任何路由。`bench.gate` 是游离开关，不参与任何写操作判断。

## 层（shelves）

表：`shelves(id, uid UNIQUE, name, ord UNIQUE, created_at)`，`courses.shelf_id` 外键，`idx_courses_shelf`。

- 初始三层由迁移 `0003_shelves.sql` 插入（`s001/s002/s003`，ord 1/2/3），现有课程都落在第 1 层。
- ord 越大越靠上，前端按 ord 升序排列，第一项在最下面。
- `createShelf(db, name?, position?)`：
  - `position:"top"`（默认）→ `ord = max(ord) + 1`，接在最上面；
  - `position:"bottom"` → `ord = min(ord) - 1`，插在最下面；
  - 名字留空时自动叫「第 N 层」，N 是当前层数 + 1（名字只是标签，不参与排序）。
- `POST /api/shelf/delete {id}`：前端靠「拖进垃圾桶松手」触发，**不弹确认框**；**只删空层**。层里有课 → 400 `{code:"not-empty", error:"这一层还有 N 本书，不能删"}`，不合并、不搬书。空层删掉后同一个事务里把剩下的 `ord` 归一成 1..n；整塔只剩一层时也返回 400。
- `POST /api/shelf/reorder {id, toIndex}`：`toIndex` 是 0-based，0 = 最下面。实现是「整表临时 `ord - 1000000` → 按新顺序重新赋 1..n」，全程一个事务，绕开 `ord UNIQUE` 的约束。响应 `{ok, id, ord, total}`。
- `POST /api/shelf/rename {id, name}` 只改 `name`，不动 `ord`、不动层里任何课。名字 `trim` 后空 → 400；`id` 不存在 → 404；长度截到 40 字。同样过 `guardWrite`。
- `GET /api/shelves` 一次返回全部层与层内的课（含 `chapters` 数与 `shelfId`），前端不再额外请求。

## 导入一本书

入口只有一个：远景里切到空层 → 书架上方的**黑板**写「第 N 层还没有书」→ 板上按「加入书籍」→ 黑板原地展开成导入表单（`ImportDialog` 已改成黑板内容，不再有独立弹窗）。

字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| 书名 | 是 | 会成为课程标题 |
| 学科 | 否 | `discipline`，留空则空字符串 |
| 章节名 | 否 | 留空则等于书名；导入后可再改 md |
| 挂到课程 | 否 | 下拉选现有课程 = 作为新章节追加；选「新建一门课程」= 书名当课程名、正文当第 1 章 |
| 正文 | 是 | 粘贴正文，或「从本地文件读入」`.md/.txt`（读进预览区，可先改） |

`src/import.ts` 的 `importChapter(db, contentDir, input)` 顺序是**写 md → 全量 sync → 回填 shelf_id**：

1. 校验：书名/正文非空，正文 ≤ 上限（超了 413）。
2. slug：中文走拼音（`src/pinyin.ts`，一次性生成的 GB2312 映射表，运行时零依赖；「国富论」→`guofulun`、「AI 导论」→`ai-dao-lun`），拉丁原样小写连字符；撞名时 `fallbackSlug` 加后缀，仍撞则 409。
3. 新课程写 `content/<slug>/_course.md` + `content/<slug>/<章slug>.md`，两个文件都带新分配的 `uid` 行。
4. 挂现有课程时只写该课程目录下的新章 md，不新建课程。
5. 调 `syncContent` 全量同步，拿回真实 id，再 `update courses set shelf_id = ?` 把它落到请求的那个层。
6. 返回 `{ ok, courseSlug, chapterSlug, uid }`。

`ImportError` 自带状态码：400（缺字段）/404（目标课程不存在）/409（slug 冲突）/413（正文过长）。

## 不做的三件事

1. **不抓网页**。给了网址也不去 fetch，只接受「已复制好的正文」粘贴进来。
2. **不进入编辑态**。导入面板只在「加一本书」时出现，平时网站是只读的；改内容仍只改 md，再 sync。
3. **不直接写库绕过 md**。任何内容落库之前必须先有 md 文件，否则 sync 会把库里的行当成孤儿。

## 改这里要守的三条

1. 新增任何写接口，必须挂 `guardWrite`，不许自己写一套判断。
2. 导入路径必须走 `importChapter`，不要为「顺手改一下」在路由里拼 SQL。
3. 改层语义（ord 方向、名字规则、删层并书规则）要同时改 `30-layout.md` 的远景一节，两处必须一致。删层一定保住书：宁可拒绝删，也不许把 `courses` 行连带删掉。
