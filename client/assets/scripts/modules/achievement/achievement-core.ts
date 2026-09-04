/**
 * 成就核心（M3-6，§S9：里程碑成就 + 奖励）。
 * - 达标自动解锁（扫描式），奖励走系统邮件（mail-core）——领取/防重由信箱保证
 * - 条件类型：level / realm / partners / fates / honor（可扩展）
 * 纯逻辑、零 cc 依赖。
 */
export type AchievementType = 'level' | 'realm' | 'partners' | 'fates' | 'honor';

export interface AchievementRow {
  id: string;
  name: string;
  desc: string;
  type: string;
  target: number;
  reward_copper: number;
}

export interface AchievementStats {
  level: number;
  realm: number;
  partnerCount: number;
  fateCount: number;
  honor: number;
}

export function isDone(row: AchievementRow, stats: AchievementStats): boolean {
  const cur =
    row.type === 'level'
      ? stats.level
      : row.type === 'realm'
        ? stats.realm
        : row.type === 'partners'
          ? stats.partnerCount
          : row.type === 'fates'
            ? stats.fateCount
            : row.type === 'honor'
              ? stats.honor
              : 0;
  return cur >= row.target;
}

/** 扫描未解锁成就，返回新达标列表（不修改状态） */
export function scanAchievements(rows: AchievementRow[], unlockedIds: string[], stats: AchievementStats): AchievementRow[] {
  return rows.filter((r) => !unlockedIds.includes(r.id) && isDone(r, stats));
}
