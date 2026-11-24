---
name: layout
covers: [web:courses, ui:layout, ui:shelf]
last-applied: 2026-11-24
---

# 30 · 课程页排版

课程页（`web/src/main.tsx` 的 `Courses`）有两套排版，用户可切换，选择记在 `localStorage` 的 `course.layout`（`cards` / `shelf`）。

## 两套排版

| 名字 | 组件 | 是什么 |
|---|---|---|
| 卡片 `cards` | `Cards` | 默认。每门课一张卡，纵向列表，点「进入」开课。 |
| 立体书架 `shelf` | `Shelf` | 3D 书脊一排立在隔板上，下方是视角操控盘。 |

## 立体书架怎么做的

**零依赖**：不加任何 3D 库，只用 CSS `perspective` + `translate3d` + `preserve-3d`。

- 舞台：`.shelf-stage` 给 `perspective: 900px`，`perspective-origin: 50% 47%`。
- 书架：`.shelf` 是 flex 一排书，`transform-style: preserve-3d`；整体位移由 React 状态 `cam.x / cam.z` 拼成 `translate3d()`，`transition` 0.6s。
- 书：`.book` 宽固定，高度 `150 + 章节数 * 16`（上限 240），`rotateY(-26deg)` 露出侧面；`.book-spine` 是书脊（竖排标题 + 学科），`.book-side` 是书页厚度面（`rotateY(90deg)`）。
- 选中：靠 `focus` 索引，选中书 `translateZ(84px)` 浮到镜头前，HUD 与按钮联动。
- 隔板：`.board` 一条绝对定位木色横条，在书架底部。

## 五个操控按钮 + 键盘

左下 `← ↑ · ↓ →` 十字盘：`←/→` 平移 ±120px（限 ±460），`↑/↓` 进深 ±80px（限 -140…300），`·` 复位。右侧「进入」开当前选中课程，「退出」复位并选回第一本。

键盘等价：`←→↑↓` 推视角，`Enter` 进入，`Esc` 复位。输入框聚焦时不拦截。单击选书，双击直接进入。

## 改这里要守的三条

1. **不加 3D 库**。CSS 3D 够用；真要加必须先证明 CSS 做不到。
2. **两套排版共用同一份 `/api/courses` 数据**，书架不额外发请求。
3. **默认态回到卡片**。`localStorage` 没值时一律 `cards`，保证新用户看到最稳的一屏。
