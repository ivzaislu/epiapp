export const CHILD_HISTORY_LIMIT = 4;

export function childHistoryView(doses, expanded = false) {
  const items = Array.isArray(doses) ? doses : [];
  const visible = expanded ? items : items.slice(0, CHILD_HISTORY_LIMIT);
  const hiddenCount = Math.max(0, items.length - CHILD_HISTORY_LIMIT);

  return {
    visible,
    total: items.length,
    shownCount: visible.length,
    hiddenCount,
    canToggle: hiddenCount > 0,
    expanded: Boolean(expanded),
    buttonLabel: expanded ? 'Свернуть' : `Ещё ${hiddenCount}`,
    metaLabel: expanded
      ? `Показаны все ${items.length}`
      : `Показаны последние ${visible.length} из ${items.length}`,
  };
}
