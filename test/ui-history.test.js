import assert from 'node:assert/strict';
import test from 'node:test';
import { CHILD_HISTORY_LIMIT, childHistoryView } from '../public/history.js';

function doses(count) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
}

test('child history shows only the latest four items by default', () => {
  const view = childHistoryView(doses(10), false);
  assert.equal(CHILD_HISTORY_LIMIT, 4);
  assert.deepEqual(view.visible.map((item) => item.id), [1, 2, 3, 4]);
  assert.equal(view.shownCount, 4);
  assert.equal(view.hiddenCount, 6);
  assert.equal(view.canToggle, true);
  assert.equal(view.buttonLabel, 'Ещё 6');
  assert.equal(view.metaLabel, 'Показаны последние 4 из 10');
});

test('child history expands all items and offers Collapse', () => {
  const view = childHistoryView(doses(10), true);
  assert.equal(view.visible.length, 10);
  assert.equal(view.hiddenCount, 6);
  assert.equal(view.canToggle, true);
  assert.equal(view.buttonLabel, 'Свернуть');
  assert.equal(view.metaLabel, 'Показаны все 10');
});

test('child history hides toggle when there are four or fewer items', () => {
  const view = childHistoryView(doses(4), false);
  assert.equal(view.visible.length, 4);
  assert.equal(view.hiddenCount, 0);
  assert.equal(view.canToggle, false);
});


test('child history toggle transitions from More to Collapse and back', () => {
  const items = doses(7);
  let expanded = false;

  let view = childHistoryView(items, expanded);
  assert.equal(view.visible.length, 4);
  assert.equal(view.buttonLabel, 'Ещё 3');

  expanded = !expanded;
  view = childHistoryView(items, expanded);
  assert.equal(view.visible.length, 7);
  assert.equal(view.buttonLabel, 'Свернуть');

  expanded = !expanded;
  view = childHistoryView(items, expanded);
  assert.equal(view.visible.length, 4);
  assert.equal(view.buttonLabel, 'Ещё 3');
});


test('parent recent days use the same four-item collapsed behavior', () => {
  const days = doses(14);
  const collapsed = childHistoryView(days, false);
  assert.equal(collapsed.visible.length, 4);
  assert.equal(collapsed.hiddenCount, 10);
  assert.equal(collapsed.buttonLabel, 'Ещё 10');

  const expanded = childHistoryView(days, true);
  assert.equal(expanded.visible.length, 14);
  assert.equal(expanded.buttonLabel, 'Свернуть');
});
