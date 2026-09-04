/**
 * 打造核心（M2-4，§2.1 S5 打造：图纸 + 材料合成高阶装备）。
 * - 配方来自 config/export/craft.json：craft（产出装备）→ 材料清单（item + count）
 * - 消耗背包材料，产出装备实例（enhance=0、owner=null），加入 equips 由调用方完成
 * 纯逻辑、零 cc 依赖。
 */
import { addItem, countOf, removeItem } from '../item/item-core';
import type { BagItem } from '../item/item-core';
import type { EquipState } from '../equip/equip-core';

export interface CraftRow {
  id: string;
  craft: string; // 产出 equipId
  item: string; // 消耗 itemId
  count: number;
}

export interface CraftNeed {
  itemId: string;
  count: number;
}

/** 配方需求聚合：equipId → 材料清单（同一装备多行合并同类材料） */
export function needsOf(rows: CraftRow[], equipId: string): CraftNeed[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.craft !== equipId) continue;
    map.set(r.item, (map.get(r.item) ?? 0) + r.count);
  }
  return [...map.entries()].map(([itemId, count]) => ({ itemId, count }));
}

/** 全部可打造装备 */
export function craftableEquips(rows: CraftRow[]): string[] {
  return [...new Set(rows.map((r) => r.craft))];
}

/** 材料是否足够 */
export function canCraft(rows: CraftRow[], bag: BagItem[], equipId: string): boolean {
  const need = needsOf(rows, equipId);
  if (need.length === 0) return false; // 无配方
  return need.every((n) => countOf(bag, n.itemId) >= n.count);
}

/**
 * 打造：校验配方与材料 → 扣除 → 返回新装备实例（由调用方加入 equips）。
 */
export function craft(rows: CraftRow[], bag: BagItem[], equipId: string, uid: string): EquipState {
  const need = needsOf(rows, equipId);
  if (need.length === 0) throw new Error(`无打造配方：${equipId}`);
  for (const n of need) {
    removeItem(bag, n.itemId, n.count); // 不足即抛错
  }
  return { uid, equipId, owner: null, enhance: 0 };
}

/** 逆向：装备分解回收部分材料（占位比例 50%，向下取整；数值待产品验收） */
export function salvage(rows: CraftRow[], bag: BagItem[], equipId: string, refundRatio = 0.5): void {
  const need = needsOf(rows, equipId);
  for (const n of need) {
    const back = Math.floor(n.count * refundRatio);
    if (back > 0) addItem(bag, n.itemId, back);
  }
}
