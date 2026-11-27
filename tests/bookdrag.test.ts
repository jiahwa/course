import test from "node:test";
import assert from "node:assert/strict";

const { createBookDrag } = await import("../web/src/bookDrag.ts");

const box = (left: number, right: number, top = 500, bottom = 720) => ({ left, right, top, bottom });
const shelf = box(200, 560, 480, 740);

function setup() {
  const d = createBookDrag();
  d.press({
    id: 7,
    index: 0,
    x: 300,
    y: 600,
    shelf,
    slots: [box(280, 328), box(348, 390), box(410, 453)],
  });
  return d;
}

test("拖动：没过阈值返回 null，过了才出视图", () => {
  const d = setup();
  assert.equal(d.move(303, 602), null);
  assert.equal(d.dragging, false);

  const v = d.move(320, 600);
  assert.ok(v);
  assert.equal(d.dragging, true);
  assert.equal(v!.id, 7);
  assert.equal(v!.from, 0);
  assert.equal(v!.dx, 20);
});

test("落点：按指针越过几本别的书中心算", () => {
  const d = setup();
  d.move(320, 600);
  assert.equal(d.move(300, 600)!.to, 0);
  assert.equal(d.move(360, 600)!.to, 0); // 第 2 本中心 369，360 还没越过
  assert.equal(d.move(380, 600)!.to, 1); // 越过 369，落到第 2 位
});

test("落点：明确越过全部别人的中心", () => {
  const d = setup();
  d.move(320, 600);
  const v = d.move(500, 600)!;
  assert.equal(v.to, 2);
  assert.equal(v.slot.height, 220);
});

test("松手：原位不变 changed=false，换位 changed=true，取消后返回 null", () => {
  const d = setup();
  d.move(320, 600);
  const same = d.release()!;
  assert.deepEqual(same, { id: 7, from: 0, to: 0, changed: false, overTrash: false });

  const e = setup();
  e.move(320, 600);
  e.move(500, 600);
  assert.deepEqual(e.release()!, { id: 7, from: 0, to: 2, changed: true, overTrash: false });

  const c = setup();
  c.move(320, 600);
  c.cancel();
  assert.equal(c.release(), null);
});

test("纯点击：只按下没拖动，release 是 null", () => {
  const d = setup();
  assert.equal(d.release(), null);
});

test("桶：指针压进垃圾桶矩形时 overTrash 为真，松手带回这个标记", () => {
  const d = createBookDrag();
  const trash = box(640, 704, 560, 622);
  d.press({
    id: 7,
    index: 0,
    x: 300,
    y: 600,
    shelf,
    trash,
    slots: [box(280, 328), box(348, 390), box(410, 453)],
  });

  const mid = d.move(500, 600)!;
  assert.equal(mid.overTrash, false);

  const onIt = d.move(670, 590)!;
  assert.equal(onIt.overTrash, true);
  assert.deepEqual(d.release(), { id: 7, from: 0, to: 2, changed: true, overTrash: true });

  // 拖出来再松手：不删
  const e = createBookDrag();
  e.press({ id: 7, index: 0, x: 300, y: 600, shelf, trash, slots: [box(280, 328)] });
  e.move(670, 590);
  e.move(320, 600);
  assert.deepEqual(e.release(), { id: 7, from: 0, to: 0, changed: false, overTrash: false });
});

test("桶：没给 trash 矩形时 overTrash 永远是 false", () => {
  const d = setup();
  const v = d.move(700, 560)!;
  assert.equal(v.overTrash, false);
  assert.equal(d.release()!.overTrash, false);
});
