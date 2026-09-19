export function historyView(doses = [], expanded = false, limit = 4) {
  const items = Array.isArray(doses) ? doses : [];
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 4;
  const hiddenCount = Math.max(0, items.length - safeLimit);
  const visible = expanded ? items : items.slice(0, safeLimit);

  return {
    visible,
    hiddenCount,
    total: items.length,
    toggleHidden: hiddenCount === 0,
    toggleExpanded: Boolean(expanded),
    toggleText: expanded ? 'Свернуть' : `Ещё ${hiddenCount}`,
    metaText: items.length === 0
      ? 'Пока нет отметок'
      : expanded
        ? `Показаны все ${items.length}`
        : `Показаны последние ${visible.length} из ${items.length}`,
  };
}
