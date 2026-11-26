---
name: layout
covers: [web:courses, ui:layout, ui:shelf, ui:layers]
last-applied: 2026-11-25
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

## 多层与远景（2026-11-25 加）

书架不只是「一排」，它是**一座塔**。近景（默认）只渲染当前层；远景渲染整塔。

- **状态**：`far`（是否远景）、`activeId`（当前层 id）、`focus`（当前层内选中书）、`armed`（是否已复位过一次）。
- **退出是两段式**：近景没 `armed` 时点「退出」= 只复位（相机归零、选中第一本），同时提示「再按一次才拉远」；已 `armed` 时点「退出」= 进远景并建层。远景里按钮变「回近景」。任何视角移动（`move()`）都会把 `armed` 清回 false，`Esc` 会把 `armed` 置 true。
- **进远景不建层**：`enterFar()` 只把 `far` 打开，层数完全不变。层只在「越界按键」时增长，避免反复进出把塔堆满空架子。
- **切层**：远景里 `↑` = 上一层（ord 更大），`↓` = 下一层（ord 更小）。`sorted` 按 ord 升序，`rowIdx` 0 在最下面；每层 `translateY((activeIdx - rowIdx) * LAYER_ROW)`，`LAYER_ROW = 260`，整塔 `scale(0.46)`，所以视觉行距 120px。`activeIdx` 取当前层在 `sorted` 里的下标。
- **越界才建层，且这一边有空层就不再长**：`↑` 已到最顶 / `↓` 已到最底时，先取这一边的端点层（`dir==="bottom" ? sorted[0] : sorted[sorted.length-1]`），只要它 `courses.length === 0`（已经有空层没填）就**在黑板上写「上面 / 下面那一层还空着」并点出是哪一层**、什么都不建；端点有书才调 `addLayer("top"|"bottom")` 再切过去。换个方向不受影响：`↓` 那端有书就仍可往下长。`position:"bottom"` 走 `ord = min(ord) - 1`，插在最下面。
- **空层长得像书架**：空层不画虚线盒子，它和满层共用同一套书架：`.shelf.ghost`（宽 232px）里只有一块隔板 `.board` 和书位占位 `.book-ghost`「（空）」——占位就站在「第一本书该在的位置」，左端。整块可点、可 `Tab` 聚焦、回车/空格等价点击。
- **点空层 = 改层名**：`startRename(layer, e)` 取该层的 `getBoundingClientRect()`，在层**右侧**贴一张固定定位的 `.rename-card`（`left = rect.right + 14`，并夹在视口内），外面是一层 12% 黑的 `.layer-mask` 半遮罩。卡片里一个 `maxLength=40` 的输入框 + 取消/保存，回车提交、Esc 关闭。保存走 `POST /api/shelf/rename {id, name}`，成功后 `onReload()` 刷层。`gateOn` 为 false 时点层只出一条提示，不弹卡片。
- **长按层 = 直接进拖拽，不弹卡**：层的 `pointerdown` 起 520ms 计时，期间移动超过 6px 就取消（那就是普通点击）。到点后 `long=true`、`dragging=true`、`suppressClick=true`（吞掉紧随的 click，别顺手引发空层改名），直接进拖动态——**没有选中卡片、没有确认框**，长按就是为了马上拖。
- **拖动全程三个视觉件**：① 残影 `.layer-echo`——长按那一刻记下该层 `getBoundingClientRect()`，原位上留一个固定定位的虚线框 + 层名；② 落位槽 `.drop-slot`——`toIdx = fromIdx + round(-dy / (LAYER_ROW*FAR_SCALE))`，槽线画在 `startBottom + (fromIdx - toIdx) * rowVis`，贴着标「放到第 N / M 位」，拖到桶上时自动隐藏；③ 垃圾桶 `.shelf-trash`——`position:absolute` 挂在 `.shelf-wrap` 里，横向 `right: 44px`，与左侧柱子（`left:46`）左右对称，两侧各一道，书架居中不动，纵向由 `measureTrash()` 在长按那一刻实测：远景取柱子底边（`.bamboo-stalk` bottom）±16px 范围内最靠下的那块 `.board` 底边作为书架底线，近景退回 `stageBottom - 14`，再算 `top = line - wrapTop - 62`，**桶底就压在这条线上**（实测桶 455–521、最底隔板底 521）。**桶本身是具象的校园绿色翻盖垃圾桶**（不是抽象图标、也不是不锈钢）：容器 64×62 去掉了原来的虚线框与「删层」文字（`.trash-label` 已从 JSX 删除，状态只靠颜色）：`.trash-lid`（54×9 绿色圆弧盖 + `::after` 20×5 提手 `#86a881→#4e7350`）、`.trash-body`（50×50 略收口 `clip-path: polygon(3% 0, 97% 0, 93% 100%, 7% 100%)`，桶口 6px 深槽、腰部一道浅色加强环、底部 `::after` 一道 2px 分模线，左右受光/背光 `#4a7450→#406244`）、`.hot` 整只转砖红、`.blocked` 整只转灰；提示是 `.trash-label` 气泡（只在拖动期间存在、`pointer-events:none`，桶顶上方 2px 居中：拖动未命中「拖到桶上就删这层」/ 命中空层「松手就删这层」/ 命中带书层「这层里还有书，删不掉」），不用 `title`——拖拽时鼠标是抓取态，hover 提示不会弹。桶下是一小段木台，不是椭圆地板：`.trash-sill`（74×4 台面，`#fbf7ec→#ece5d3`，`bottom:-3`，带 1px 高光与底部接触阴影）承接桶底，`.trash-ground`（74×9 台身，横向木纹 `repeating-linear-gradient(180deg)` + `#ded7c3→#b0a88f`，与书架隔板同色系，`bottom:-12`）；`.trash-shadow`（78×13 radial 椭圆、`blur(1.4px)`、`z-index:-1`、`bottom:-19`）是台下那团影子。`.hot` 时台面台身一起转砖红。视图滚动不影响，因为它跟书架走不跟视口走。层本体 `translateY(shift + dy / FAR_SCALE)` 跟手，`.dragging` 关掉过渡。
- **拖拽与删层不受迭代开关限制**：`/api/shelf/reorder`、`/api/shelf/delete` 走 `guardWrite(req,res,true)`，只保留回环 + Origin + JSON 校验、跳过 gate——摆架是用户亲手操作，不该被授权开关挡住。长按也不再因 gate off 而被拦成半截状态。新建层 / 导入 / 改名仍要 gate。
- **拖到别的层 = 换位**：松手时 `fromIdx = sorted.findIndex(被拖层)`（不是当前激活层），`toIndex` 直接取拖动中记下的 `dropRef`（0-based，0 最下），变了才 `POST /api/shelf/reorder {id, toIndex}`；松手无论成没成都会清掉 `picked`，避免下次单击被当成继续拖动。
- **拖进垃圾桶 = 删层（只删空层）**：拖动中在书架右缘、自身底线之上显示 `.shelf-trash`（`position:absolute` 于 `.shelf-wrap`，`ref` 拿 `getBoundingClientRect()`）。`pointermove` 每次算指针是否落在桶里：空层落进去 → `.hot`（砖红、放大、标签「松手就删」）；**层里有书 → `.blocked`（灰、标签「有书不能删」）**。`pointerup` 时在桶内且该层有书 → 只出一条 notice「这层还有 N 本书，不能删」，层原样不动；桶内且该层为空 → `doDelete(layer)` 直接删，不经确认。判定同时看 `overTrashRef` 和松手坐标，双保险。
- **删层绝不带走书**：服务端 `deleteShelf` 先数 `courses`，大于 0 直接 400 `code:"not-empty"`；只有空层才真删，删完把剩余 `ord` 归一。前端和后端各拦一次，前端负责当场给反馈，后端负责兜底。
- **书架黑板（唯一提示面）**：书架顶端与页首文字之间常驻一块 `.shelf-board`（深墨绿板面 + 木框 + 粉笔槽，配色仍是纸墨）。**不存在任何弹框**：`WinDialog` 已删除。黑板内容按状态切换——近景一句话讲键位（按两下「退出」才到远景）；远景平时讲操作（长按拖起来：挪位换序、丢进右下角桶里就删、空层点一下改名），副标题写「N 层 · 这层 M 本」；切到空层写「第 N 层，空的」（gate 开时给「放一本书」按钮，关时写「加书要开迭代模式」）；越界被拦写「上面 / 下面那层还空着 · 是哪一层」+「行」；点「放一本书」后黑板原地展开成导入表单（取消 / 放进去）。**文案口径**：短句、动词开头的口语，禁用「属于…动作」「需要先在…打开」这类公文体。**板上永远不放删除按钮**——删层只走长按拖进垃圾桶。
- **左侧竹竿（纯装饰的层指示）**：`far` 时在舞台左侧 46px 处立一根竹子，`.bamboo-node` 的**节数 = 层数**（`flex-direction: column-reverse`，最下面一节 = ord 最小的那层），节高 `min(LAYER_ROW*FAR_SCALE, max(40, 440/层数))`，整根底部与第一层书架底对齐（`bottom: 100px`，实测 221–580 正好盖住第 1 层的底到第 3 层的顶）。每节里画该层的迷你书架：最多 4 根 `.bn-book` 书脊（高度按 `chapters`）、底部 `bn-board` 隔板、空层用虚线框 `.bn-empty`；不是当前层时整节半透明 + `filter: blur(1.1px)`，当前层加 `.on` 变清晰加亮。**不写字、不标数字、`pointer-events: none`，纯展示**，点击一律穿透到书架。顶端保留 `::after` 竹梢。**主干周围另生小竹**：一根内联 `<svg class="bamboo-sprigs">`（`viewBox="-30 0 200 360"`，`left:-32 bottom:0`、214×374、压在主干下层 `z-index:0`、`blur(.5px)`、`opacity:.88`）画 5 根细竹枝（`stroke` 用竖向渐变 `#5d7f60→#9dbd95`、`strokeWidth` 1.4–2.8、`M32 352` 等从主干边缘起笔，含一段 `M34 198 Q 24 214 18 236` 向左下、一段 `M34 306 Q 50 292 64 272` 向右下）和 4 组竹叶（约 14 片，`translate+rotate+scale` 分组，叶形 `M0 0 C 10 -4.5 24 -3.6 35 0 C 24 3.8 10 4.6 0 0` 的两端尖纺锤，`fill` 走 `bs-leafA/#4c7457→#adc99c`、`bs-leafB/#618a64→#c0d8ad` 两条渐变，`stroke rgba(58,84,60,.3)` 0.5，另叠 `rgba(255,255,255,.22)` 叶脉短线）。旧的三片 `.bamboo-leaf` 与对应 CSS 已删除。
- **远景里书不能点进**：`far` 时书的 `onClick` 只改 `focus`，不进入；必须按底部「进入」才开课。
- **舞台几何**：`.shelf-stage` 近景 262px，远景 480px（窄屏 420），远景 `overflow:hidden`，`perspective-origin: 50%`，`.shelf-stage.far .shelf-anchor { top: 66% }`，塔 `transform-origin: 50% 50%` 居中缩放。层名是一块**黑金铭牌** `.layer-name`，远景里竖排、钉在**书架左侧的木质挡墙** `.shelf-side` 上（`writing-mode: vertical-rl` + `text-orientation: upright`，字序自上而下）：挡墙是每层一块**平面墙板**（不是圆柱）——`.tower.scaled .shelf-side`，`left:-227px`、`width:112px`（远景 scale 0.46 后约 50×120 视觉）、`top:0 bottom:0`、`border-radius:0`，底子 `linear-gradient(180deg,#efe7d2,#e4dabd 48%,#dccfb1 78%,#d2c5a6)` 再叠 `repeating-linear-gradient(90deg, …9px)` 细竖木纹，只留左右各 1px 边线与 `7px 0 14px` 右侧投影，没有柱面高光；三层相接看成一整面侧墙。墙的右缘与第一本书之间留 **10px 视觉空隙**（实测墙 306–356、书左 366），隔板 `left/-right:-26px` 略微插进墙里。铭牌 `left:50%` + `transform: translateX(-194px)`、`bottom:30px`、`font-size:31px`（视觉约 14px 字），板宽约 21，居墙中线。板面是**棕色木牌**：`linear-gradient(180deg,#543c26,#46301d 42%,#382515 74%,#2b1b0f)`，边是**黑金边**——1px `#b1904f` 金线外套 `0 0 0 1px #17110c` 黑描边，再叠 `::after inset:4px` 的细金线；字色 `#f2e5cb`（偏牙白），配 `text-shadow 0 1px 0 rgba(38,24,12,.6)` 与极轻的 5px 暖光，在棕底上清楚但不发亮。字体是 `@font-face "Seal Script"`（`web/public/fonts/JFZSKSealScript.woff2`，敬峰中山王篆 V2.0，OFL 1.1，`OFL-JFZSKSealScript.txt` 留许可）。牌上文字走 `sealNum()`：阿拉伯数字换汉字小写（1→一）并去掉空格，避免篆体里混西文数字；篆体只收 GB2312 常用字，生僻层名回落 Songti SC。近景（`.tower:not(.scaled)`）不显示铭牌也不显示挡墙——只有一层，层名交给黑板与 HUD。空层画虚线框「空」。

## 改这里要守的三条

1. **不加 3D 库**。CSS 3D 够用；真要加必须先证明 CSS 做不到。
2. **两套排版共用同一份 `/api/courses` 数据**，书架不额外发请求。
3. **默认态回到卡片**。`localStorage` 没值时一律 `cards`，保证新用户看到最稳的一屏。
