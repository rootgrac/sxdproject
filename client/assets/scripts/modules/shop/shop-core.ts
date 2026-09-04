/**
 * 杂货商店核心（M2-5b，§2.1 S8 商店）。
 * - 商品来自 config/export/shop.json：item（物品） + cost（铜钱）+ limit（每日限购，0=不限；限购状态接入 daily 后启用）
 * 纯逻辑、零 cc 依赖。
 */
import { addItem } from '../item/item-core';
import type { BagItem } from '../item/item-core';

export interface ShopRow {
  id: string;
  item: string;
  cost: number;
  limit: number;
}

export function priceOf(rows: ShopRow[], itemId: string): number {
  const r = rows.find((x) => x.item === itemId);
  if (!r) throw new Error(`商店无此商品：${itemId}`);
  return r.cost;
}

/**
 * 购买：校验单价与铜钱 → 扣款 → 入包。
 * wallet 为可变对象（存档 player 引用），保持数据单一来源。
 */
export function buy(
  rows: ShopRow[],
  bag: BagItem[],
  wallet: { copper: number },
  itemId: string,
  count = 1,
): { itemId: string; count: number; cost: number } {
  if (count <= 0) throw new Error(`购买数量必须为正：${count}`);
  const unit = priceOf(rows, itemId);
  const total = unit * count;
  if (wallet.copper < total) throw new Error(`铜钱不足：需 ${total}，有 ${wallet.copper}`);
  wallet.copper -= total;
  addItem(bag, itemId, count);
  return { itemId, count, cost: total };
}
