import assert from 'node:assert/strict';
import test from 'node:test';
import { historyView } from '../public/history-view.js';

const doses = Array.from({ length: 9 }, (_, index) => ({ id: index + 1 }));

test('child history shows only four latest entries by default', () => {
  const view = historyView(doses, false);
  assert.equal(view.visible.length, 4);
  assert.deepEqual(view.visible.map((dose) => dose.id), [1, 2, 3, 4]);
  assert.equal(view.hiddenCount, 5);
  assert.equal(view.toggleHidden, false);
  assert.equal(view.toggleExpanded, false);
  assert.equal(view.toggleText, 'Ещё 5');
  assert.equal(view.metaText, 'Показаны последние 4 из 9');
});

test('child history expands all entries and offers collapse', () => {
  const view = historyView(doses, true);
  assert.equal(view.visible.length, 9);
  assert.equal(view.hiddenCount, 5);
  assert.equal(view.toggleHidden, false);
  assert.equal(view.toggleExpanded, true);
  assert.equal(view.toggleText, 'Свернуть');
  assert.equal(view.metaText, 'Показаны все 9');
});

test('child history hides toggle when four or fewer entries exist', () => {
  const four = historyView(doses.slice(0, 4), false);
  assert.equal(four.visible.length, 4);
  assert.equal(four.hiddenCount, 0);
  assert.equal(four.toggleHidden, true);

  const empty = historyView([], false);
  assert.equal(empty.visible.length, 0);
  assert.equal(empty.toggleHidden, true);
  assert.equal(empty.metaText, 'Пока нет отметок');
});
