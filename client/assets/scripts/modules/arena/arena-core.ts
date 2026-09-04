/**
 * 竞技场核心（M3-5，§S9/§3.4：挑战 AI 名将镜像、本地结算）。
 * - 镜像对手 = 敌模板 unit × 档位 scale（开发文档：按玩家战力分段生成镜像；数值定稿后由战力推导档位）
 * - 每日获胜次数存 daily.elites['arena']（复用精英跨日重置语义），上限 ARENA_DAILY_WINS（占位 3）
 * - 荣誉 honor（player.v7）累计，供成就/商店使用
 * 纯逻辑、零 cc 依赖。
 */
import type { UnitRow } from '../../battle-core/src/setup';

export interface ArenaRow {
  id: string;
  name: string;
  units: string[] | string;
  scale: number;
  reward_copper: number;
  honor: number;
}

/** 每日可获胜次数（占位，数值待拍板） */
export const ARENA_DAILY_WINS = 3;

/** 镜像生成：按系数缩放模板（hp/atk/def，向下取整；速度/命中不动） */
export function scaleUnitRows(defs: UnitRow[], ids: string[], scale: number): UnitRow[] {
  return ids
    .map((id) => defs.find((d) => d.id === id))
    .filter((d): d is UnitRow => d !== undefined)
    .map((d) => ({
      ...d,
      hp: Math.round(d.hp * scale),
      atk: Math.round(d.atk * scale),
      def: Math.round(d.def * scale),
    }));
}

/** 当日已胜场（elites 内建键 'arena'） */
export function arenaWinsToday(elites: Record<string, number>): number {
  return elites['arena'] ?? 0;
}

export function arenaRemaining(elites: Record<string, number>): number {
  return Math.max(0, ARENA_DAILY_WINS - arenaWinsToday(elites));
}

/** 记录一场胜（超限抛错；败方不扣——重试友好，同精英语义） */
export function recordArenaWin(elites: Record<string, number>): void {
  if (arenaRemaining(elites) <= 0) {
    throw new Error(`今日竞技场胜场已达上限（${ARENA_DAILY_WINS}/${ARENA_DAILY_WINS}），明日重置`);
  }
  elites['arena'] = arenaWinsToday(elites) + 1;
}
