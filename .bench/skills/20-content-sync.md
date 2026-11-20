---
name: content-sync
covers: [content:md, script:sync, schema:courses, schema:chapters, api:/api/course, web:course, web:chapter]
last-applied: 2026-11-20
---

# 20 · 内容管道

改内容的唯一入口是 `content/`，从不在库里直接写正文。

## md 形态

```
content/<course-slug>/
├── _course.md      课程元信息
└── <chapter-slug>.md
```

`_course.md` 的 front matter：

```
title: 人工智能导论        # 必填，缺了整门课跳过
discipline: 人工智能
summary: 一句话说明
source: 自编讲义
order: 1
```

章节 md 的 front matter：`title`（必填，缺了用文件名）、`order`。正文写在分隔线之后。

## 身份（uid）

每门课、每一章在**创建那一刻**分配一个 uid，写进 md 的 front matter，之后永不修改：

```
---
title: 注意力机制
order: 1
uid: hB03637BA1A67
---
```

- sync 只在 md 里还没有 uid 时补写一次，之后从不改文件；
- **只认 uid，不看路径**：md 里有 uid 就按它认；没有就当新建，sync 立刻分配一个并写回文件；
- 所以改名、挪目录、换课程都不换身份：id 不变、浏览记录不断；
- 同一个 uid 出现在两个文件 = 冲突，报出来且不写入，绝不静默覆盖；
- 想「另存为一份新章」：复制文件 → **改文件名** → **删掉 uid 行**，sync 给它新身份；只删 uid 不改名会被判冲突（同课程同 slug 只能有一章）。
- 删掉 uid 但文件名不变 = 冲突，不写入；这样能防止「手滑丢了一行 uid」把一章悄悄劈成两半。

## 冲突长什么样、怎么修

报在**终端**（`npm run sync` 的输出里），不在浏览器。网页不会报错，它只会「没变化」——因为库里那行还在。

```
[sync] 冲突 1 条（未写入）：
  - ai-intro/attention（未写入：库里这个路径已被 uid hB03637BA1A67 占用
    ——把该 uid 写回 md 的 uid 行即可恢复，或改文件名另开一章）
[sync] 库中 1 章没有被任何 md 认领（未删除）：
  - ai-intro/attention
```

看到这两行就等于知道了修法：把提示里的 uid 加回 md front matter，再 sync 一次就好。退出码仍是 0，同批其它文件照常处理。

## 规则

- 正文只放章节 md。`_course.md` 分隔线之后的内容不入库，sync 只报一条跳过。
- **只 upsert，不删除**。md 里消失的章节会报成 orphan，由人确认后再清库，避免一次 sync 误删。
- hash 变了才更新，内容没变不动 `updated_at`，不让列表页日期抖动。
- `words` = 去空白后的字符数，仅用于列表展示，不做学习统计。

## 验收

1. `npm run sync` 跑两次，第二次必须是「课程未变 / 章节未变」。
2. 删掉一章 md 再 sync，只出现 orphan 提示，`chapters` 行数不变。
3. `curl /api/course?slug=<课程>` 能拿到章节列表与字数。
