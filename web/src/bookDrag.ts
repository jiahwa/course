// 近景书的指针拖拽：只算几何与落点，不渲染、不发请求、不碰样式。
//
// 使用方（Shelf）负责三件事：
//   1. 按下时把同层每本书的矩形、书架矩形的快照交进来（press）；
//   2. 把 move 返回的视图套到自己的样式上（dx 跟手、slot 画落位槽、to 显示位次）；
//   3. 松手后看 release 的 changed 决定要不要落库。
//
// 所以这一层跟具体视觉效果、接口、React 都无关；删掉它不影响阅读、远景和层拖拽，
// 想换套拖拽观感也不用改这里。

export type BookBox = { left: number; right: number; top: number; bottom: number };

export type BookDragPress = {
  id: number;
  /** 在当层渲染顺序里的下标 */
  index: number;
  /** 按下点（视口坐标） */
  x: number;
  y: number;
  /** 按下那一刻，同层每本书的矩形，顺序即渲染顺序 */
  slots: BookBox[];
  /** 书架容器，用来把落位槽换算成相对坐标 */
  shelf: BookBox;
  /** 垃圾桶矩形（可选）。指针落进去就当成删除，不再算换序。 */
  trash?: BookBox;
};

export type BookDragView = {
  id: number;
  from: number;
  /** 松手后会落在数组的哪个下标 */
  to: number;
  /** 被拖书的横向位移，直接给 transform 用 */
  dx: number;
  /** 落位槽，坐标相对 shelf 左上角 */
  slot: { left: number; top: number; height: number };
  /** 指针是否压在垃圾桶上 */
  overTrash: boolean;
};

export type BookDragDrop = { id: number; from: number; to: number; changed: boolean; overTrash: boolean };

export type BookDragOptions = {
  /** 位移超过这个像素数才算拖动，否则按点击处理 */
  threshold?: number;
  /** 落位槽离最近那本书的距离 */
  slotGap?: number;
};

const DEFAULT_THRESHOLD = 8;
const DEFAULT_SLOT_GAP = 8;

const centerX = (box: BookBox) => box.left + (box.right - box.left) / 2;

const inBox = (x: number, y: number, box: BookBox) =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

// 移走自己之后，指针落在剩余队列里的插入下标：
// 比指针中心靠左的书有几本，就插在第几位。
function insertionIndex(pointerX: number, from: number, slots: BookBox[]): number {
  let to = 0;
  for (let i = 0; i < slots.length; i += 1) {
    if (i !== from && pointerX > centerX(slots[i])) to += 1;
  }
  return to;
}

function slotAt(to: number, press: BookDragPress, gap: number): BookDragView["slot"] {
  const others = press.slots.filter((_, i) => i !== press.index);
  const self = press.slots[press.index];
  const left =
    to === 0 ? (others[0]?.left ?? self.left) - gap : (others[to - 1]?.right ?? self.right) + gap;
  const top = Math.min(...press.slots.map((b) => b.top));
  const bottom = Math.max(...press.slots.map((b) => b.bottom));
  return { left: left - press.shelf.left, top: top - press.shelf.top, height: bottom - top };
}

export function createBookDrag(options: BookDragOptions = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const gap = options.slotGap ?? DEFAULT_SLOT_GAP;

  let press: BookDragPress | null = null;
  let dragging = false;
  let to = 0;
  let overTrash = false;

  return {
    get dragging() {
      return dragging;
    },

    press(next: BookDragPress) {
      press = next;
      dragging = false;
      overTrash = false;
      to = next.index;
    },

    /** 返回 null = 还没过阈值，或没有按下。 */
    move(x: number, y: number): BookDragView | null {
      if (!press) return null;
      if (!dragging) {
        if (Math.abs(x - press.x) < threshold && Math.abs(y - press.y) < threshold) return null;
        dragging = true;
      }
      to = insertionIndex(x, press.index, press.slots);
      overTrash = !!press.trash && inBox(x, y, press.trash);
      return { id: press.id, from: press.index, to, dx: x - press.x, slot: slotAt(to, press, gap), overTrash };
    },

    /** 返回 null = 这一下是一次点击，不是拖动。 */
    release(): BookDragDrop | null {
      const p = press;
      const wasDragging = dragging;
      const lastTo = to;
      const lastOver = overTrash;
      press = null;
      dragging = false;
      overTrash = false;
      if (!p || !wasDragging) return null;
      return { id: p.id, from: p.index, to: lastTo, changed: lastTo !== p.index, overTrash: lastOver };
    },

    /** 中途放弃（Esc / 指针被系统收走）：丢掉按下态，不当成落位。 */
    cancel() {
      press = null;
      dragging = false;
      overTrash = false;
    },
  };
}

export type BookDrag = ReturnType<typeof createBookDrag>;
