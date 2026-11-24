---
name: charter
scope: 全站
covers: [content:uid, content:md, script:sync, schema:settings, schema:courses, schema:chapters, schema:views, schema:events, schema:chapters_fts, api:/api/health, api:/api/courses, api:/api/search, api:/api/recent, api:/api/view, api:/api/chapter, api:/api/course, api:/api/gate, web:courses, ui:layout, ui:shelf, web:course, web:chapter, web:search, web:recent, web:settings]
last-applied: 2026-11-24
---

# 00 · 章程

本目录是站点的可执行规格书。每次改站，先读这里，再动手；动手完，回来改这里。

## 定位

这是一个**多课程资料库**，不是学习流。

- 要的是：多课程并列管理、快速查阅、全文检索、（TODO）AI 语义检索、浏览记录。
- 不要的是：复习排程、间隔重复、每日任务、连续天数、打卡、排行榜。
- 判据：一个新功能如果只服务于「今天该学什么」，就不属于本站；如果服务于「我想翻到某一处」，才属于。

## 三条不变量

1. **源唯一**：内容只从 `content/*.md` 改，状态只从库改。库是读取侧，md 是编辑侧。
2. **契约唯一**：前端不碰库，全走 `/api`。字段语义定版后不单方面改。
   **身份唯一**：课与章的 uid 在创建时分配、写进 md、永不修改；slug 与标题只是属性。路径不参与身份判断，md 没有 uid 一律按新建处理。
3. **不校验不落地**：任何迭代动作过不了 `bench verify` 就不写库、不留文件。

## 每次改动的门槛

1. **plan**：说清改什么、为什么、影响哪些 `covers`。
2. **snapshot**：apply 前整库 + content 打包。
3. **改站**：一次只改一件事。
4. **改说明书**：涉及的 covers 必须在 md 里登记；新增动作新建 `<动作>.md`。没写 md 的改动视同未完成。
5. **verify**：全绿才算完。任一条红 → 回滚 + 如实报出。

## 隐藏边界

- `.bench/` 不进 `web/`，不加任何服务端路由。前端产物里搜不到 `bench` 字样。
- 界面只有一处授权开关，它只是声明；执行能力始终在终端，且要求 token。
- 日志只记动作、参数、diff 摘要、前后 hash，不记正文内容。

## 木已成舟的取舍

- 检索：FTS5 trigram，三字以上走 MATCH，两字以内回退 LIKE。中文不分词是既定选择，不引分词器。
- 浏览记录只记 `opens / seconds / last_opened_at`，不建每日打卡表。

## 待办

- M1：内容管道（md 解析 → sync 入库 → 课程/章节页可读可翻）。
- M2：bench 的 plan / apply / snapshot / revert 与 covers 覆盖检查。
- M3：AI 语义检索（TODO，先只留位置，不写假实现）。
