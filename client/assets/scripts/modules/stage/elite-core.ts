/**
 * 精英副本核心（M2-6，§2.1 S7 精英副本：每日次数限制、高阶材料产出）。
 * - 配置：elite.json（敌阵/每日次数）+ elite_reward.json（固定掉落）
 * - 每日状态：SaveData.daily（v4），按本地日期 dateKey 惰性重置（§3.5-5 本地日历驱动）
 * - 战斗与主线同内核；本模块只负责次数与掉落结算
 * 纯逻辑、零 cc 依赖。
 */
import { addItem } from '../item/item-core';
import type { BagItem } from '../item/item-core';

export interface EliteRow {
  id: string;
  name: string;
  enemies: string[] | string;
  stamina_cost: number;
  daily_limit: number;
}

export interface EliteRewardRow {
  id: string;
  elite: string;
  item: string;
  count: number;
}

/** 与 SaveData.daily 对齐 */
export interface DailyState {
  dateKey: string;
  elites: Record<string, number>;
}

export function findElite(rows: EliteRow[], id: string): EliteRow {
  const e = rows.find((x) => x.id === id);
  if (!e) throw new Error(`精英副本不存在：${id}`);
  return e;
}

/** 惰性跨日重置：日期变化则清空当日计数（原地修改） */
export function rollDay(daily: DailyState, today: string): void {
  if (daily.dateKey !== today) {
    daily.dateKey = today;
    daily.elites = {};
  }
}

export function clearsToday(daily: DailyState, today: string, eliteId: string): number {
  rollDay(daily, today);
  return daily.elites[eliteId] ?? 0;
}

/** 今天还能挑战几次（≤0 说明已用完） */
export function remainingToday(daily: DailyState, today: string, elite: EliteRow): number {
  return Math.max(0, elite.daily_limit - clearsToday(daily, today, elite.id));
}

/** 记录一次挑战（次数已尽抛错，由 UI 引导等待次日重置） */
export function recordChallenge(daily: DailyState, today: string, elite: EliteRow): void {
  rollDay(daily, today);
  const used = daily.elites[elite.id] ?? 0;
  if (used >= elite.daily_limit) {
    throw new Error(`今日次数已用尽（${elite.daily_limit}/${elite.daily_limit}），明日重置`);
  }
  daily.elites[elite.id] = used + 1;
}

/** 精英固定掉落清单（聚合同物品） */
export function rewardsOf(rows: EliteRewardRow[], eliteId: string): { itemId: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.elite !== eliteId) continue;
    map.set(r.item, (map.get(r.item) ?? 0) + r.count);
  }
  return [...map.entries()].map(([itemId, count]) => ({ itemId, count }));
}

/** 发放掉落（胜利结算后调用；战败不发） */
export function grantRewards(bag: BagItem[], rows: EliteRewardRow[], eliteId: string): void {
  for (const r of rewardsOf(rows, eliteId)) {
    addItem(bag, r.itemId, r.count);
  }
}
