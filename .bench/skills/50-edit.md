---
name: edit
covers: [api:/api/chapter/save, api:/api/chapter/delete, content:md, content:trash, script:sync, ui:edit, ui:chapterdel, web:chapter]
last-applied: 2026-11-27
---

# 50 · 改章节正文

范围**只有章节正文**，外加一个「删这一章」的入口（见下）。书名 / 学科 / 章节标题 / 删整本书都不在站内改——那些仍要动 md 或 `.bench`。

## 唯一入口

章节页正文右上角一个小按钮「改正文」：`web/src/main.tsx` 的 `ChapterView`，`.chapter-head` 是标题与按钮的一行，按钮 `.chapter-edit`（12px、细描边、`--ink-faint`，hover 才转正文色）。`writable`（= 只读模式关着）为 false 时按钮不出现；旁边的「删除」不受只读模式影响，始终在。

点它把 `data.body` 灌进 `.chapter-editor`（等正文宽、`min-height:46vh`、纸色底、衬线继承、可竖向拉伸），页面切到编辑态：Markdown 渲染让位给 textarea，`chapter-meta` 加一句「改的是 content 里的 md，存完立刻同步」，下面一行是字数、取消、保存（`.chapter-btn` / `.chapter-btn.primary`）。取消直接回到只读，不写盘。

## 写盘路径

`POST /api/chapter/save`（`server/main.ts`）→ `src/import.ts` 的 `saveChapterBody`：

1. `guardWrite(req, res)`：回环 + Origin 白名单 + `application/json` + 只读模式关着。只读模式开着返回 403 `readonly-on`，前端把 `error` 原样显示在 `.chapter-err`。
2. 入参 `{course, slug, body}`；`course` / `slug` 必须匹配 `^[A-Za-z0-9_-]+$`（400「slug 不合法」），`body` 空则 400、超过 `MAX_BODY = 200_000` 则 413。
3. **先查库**：`chapters JOIN courses` 里必须真有这对 slug，否则 404「查无此章」——路径永远由库里的 slug 推出，不拿用户输入拼路径。算出 `resolve(contentDir, course, slug.md)` 后再校验它 `startsWith(root + sep)`。
4. md 不存在 → 404「这章的 md 不在（先用 npm run sync 重建编辑源）」。
5. **只换正文**：正则取出开头 `---\n…\n---\n` 整段 front matter 原样保留（`title` / `order` / `uid` 一个字节都不动），文件写成 `front + 空行 + body + \n`。uid 保住，views 与统计不断。
6. 立刻 `syncContent(db, contentDir)`——同进程内同步，不新增 `/api/sync`，也不在设置页放「重扫 md」。外部手改 md 之后仍要终端跑 `npm run sync`。
7. 返回 `{course, slug, title, words}`；前端拿它 `reload()` 同一章节，字数与「更新」日期就地刷新，编辑态关闭。

## 别做的事

- 不要给 `saveChapterBody` 加「改标题 / 改 order / 改课程归属」的字段：那是另一次决定。
- 不要在保存时重建 uid 或重写 front matter——那会打断浏览记录。
- 不要让前端直接碰 md 路径或 `content/`；一切都以库里的 slug 为准。
- 写临时文件再 rename 也大可不必：单进程单用户，直接覆盖原 md 就是最短路径。

## 验收

`curl -X POST /api/chapter/save` 改一章 → md 的 front matter 与 uid 不变、正文变了、`/api/chapter` 立即返回新正文、`chapters.content_hash` 随之更新；再把原文贴回并 `npm run sync` 复原。`npm test` 32 条绿、`node .bench/bench.ts verify` PASS。截图基线 `docs/preview/chapter-view.png`（只读带按钮）、`docs/preview/chapter-edit.png`（编辑态）。

## 删这一章

标题右侧「改正文」左边并排一个「删除」（`.chapter-del`，同尺寸细描边，hover 转砖红）。两段式、不弹框：第一下按钮变「确认删除」（`.ask`，砖红描边 + 极浅红底），3 秒没再点自动复原；第二下才执行。

`POST /api/chapter/delete`（`server/main.ts`）→ `src/import.ts` 的 `deleteChapter`：`course`/`slug` 白名单、库里有这一章否则 404、md 路径由库里 slug 推出并夹在 `contentDir` 内；把 md 移到 `content/.trash/<课程>-<章节>.md-<时间戳>`，删这一章的库行，再 `syncContent`。课程与其它章节不动；课程章数归零也留着（层里可以有一本没章节的书）。
