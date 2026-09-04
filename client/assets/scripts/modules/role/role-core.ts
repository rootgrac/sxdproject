/**
 * 角色养成纯逻辑（M1-7 最小闭环，§2 S2：等级/境界/战力）。
 * - 境界链为原创占位命名（附录 E：通脉→凝元→丹成→婴变…，正式命名需法务确认）
 * - 经验曲线为内置占位公式（M1-8 后改为 config/tables 导表驱动，届时字段/接口不变）
 * - RoleState 的字段形状与 SaveData.player 对齐（level/exp/realm），可直接挂到存档上
 * 纯函数、零 cc 依赖：Cocos 内外均可测试（tools/client-core-test）。
 */

export interface RoleState {
  name: string;
  level: number;
  exp: number;
  /** REALMS 下标 */
  realm: number;
}

/** 境界链（原创占位命名；从低到高） */
export const REALM_NAMES: readonly string[] = ['通脉', '凝元', '丹成', '婴变', '化神', '归元'];

/** 各境界解锁所需最低等级（下标与 REALM_NAMES 对应） */
export const REALM_MIN_LEVEL: readonly number[] = [1, 10, 20, 35, 50, 70];

export const MAX_LEVEL = 60;

/** 升级所需经验（从 level 升到 level+1；占位曲线：100 + (level-1)*50） */
export function expToNext(level: number): number {
  return 100 + (level - 1) * 50;
}

/** 由等级推导境界下标（当前最高可达境界） */
export function realmOfLevel(level: number): number {
  let r = 0;
  for (let i = 0; i < REALM_MIN_LEVEL.length; i++) {
    if (level >= REALM_MIN_LEVEL[i]) r = i;
  }
  return r;
}

export interface GrowResult {
  levelUps: number;
  realmUps: number;
  level: number;
  realm: number;
  exp: number;
}

/** 增加经验：自动连升、境界突破（返回发生的变化；maxLevel 后经验不再累计） */
export function addExp(role: RoleState, amount: number): GrowResult {
  const beforeLevel = role.level;
  const beforeRealm = role.realm;
  let remaining = amount;

  if (role.level >= MAX_LEVEL) {
    return { levelUps: 0, realmUps: 0, level: role.level, realm: role.realm, exp: role.exp };
  }

  role.exp += remaining;
  let guard = 0;
  while (role.level < MAX_LEVEL && role.exp >= expToNext(role.level)) {
    role.exp -= expToNext(role.level);
    role.level++;
    guard++;
    if (guard > MAX_LEVEL) break; // 防呆（金额异常大时不会死循环）
  }
  role.exp = Math.max(0, role.exp);
  role.realm = realmOfLevel(role.level);

  return {
    levelUps: role.level - beforeLevel,
    realmUps: role.realm - beforeRealm,
    level: role.level,
    realm: role.realm,
    exp: role.exp,
  };
}

export interface PowerStats {
  atk: number;
  def: number;
  hp: number;
  spd: number;
}

/** 战力占位公式（§S2 统一战力公式用于展示/成就；数值待产品验收） */
export function powerOf(role: RoleState, stats: PowerStats): number {
  return (
    stats.hp / 10 + stats.atk * 3 + stats.def * 2 + stats.spd * 2 + role.level * 15 + role.realm * 100
  );
}
