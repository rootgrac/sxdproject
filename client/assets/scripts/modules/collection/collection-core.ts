/**
 * 图鉴收集核心（M3-7，§S9：伙伴/装备/命格收集度，收尾给收集向留存）。
 * - 收藏集 = 配置表全量（伙伴=可招募单位、装备、命格）
 * - 进度 = 拥有数/总数（owned 由调用方以 id 集提供）
 * 纯逻辑、零 cc 依赖。
 */
export interface CollectionSet {
  key: string;
  title: string;
  entries: { id: string; name: string }[];
}

export function collectionProgress(owned: ReadonlySet<string>, all: { id: string }[]): { owned: number; total: number; pct: number } {
  const total = all.length;
  const ownedCount = all.filter((e) => owned.has(e.id)).length;
  return { owned: ownedCount, total, pct: total === 0 ? 0 : Math.round((ownedCount / total) * 100) };
}

/** 组装三个收藏集视图（含拥有标记） */
export function buildCollectionView(sets: CollectionSet[], owned: ReadonlySet<string>): { key: string; title: string; progress: { owned: number; total: number; pct: number }; entries: { id: string; name: string; owned: boolean }[] }[] {
  return sets.map((s) => ({
    key: s.key,
    title: s.title,
    progress: collectionProgress(owned, s.entries),
    entries: s.entries.map((e) => ({ id: e.id, name: e.name, owned: owned.has(e.id) })),
  }));
}
