/**
 * 背包核心（M2-5，§2.1 S8）：物品堆叠存储。
 * - SaveData.bag: BagItem[]（装备实例在 equips，不占背包位）
 * - 物品定义来自 config/export/item.json（材料/道具/图纸）
 * 纯逻辑、零 cc 依赖。
 */
export interface BagItem {
  itemId: string;
  count: number;
}

export interface ItemDefRow {
  id: string;
  name: string;
  kind: string; // material | consumable | blueprint
}

export function countOf(bag: BagItem[], itemId: string): number {
  return bag.find((b) => b.itemId === itemId)?.count ?? 0;
}

/** 入账：同物品堆叠，无则新增 */
export function addItem(bag: BagItem[], itemId: string, count: number): void {
  if (count <= 0) throw new Error(`数量必须为正：${count}`);
  const entry = bag.find((b) => b.itemId === itemId);
  if (entry) {
    entry.count += count;
  } else {
    bag.push({ itemId, count });
  }
}

/** 出账：数量不足抛错；清零条目移除 */
export function removeItem(bag: BagItem[], itemId: string, count: number): void {
  if (count <= 0) throw new Error(`数量必须为正：${count}`);
  const entry = bag.find((b) => b.itemId === itemId);
  if (!entry || entry.count < count) {
    throw new Error(`物品不足：${itemId}（需 ${count}，有 ${entry?.count ?? 0}）`);
  }
  entry.count -= count;
  if (entry.count === 0) {
    const idx = bag.indexOf(entry);
    bag.splice(idx, 1);
  }
}
