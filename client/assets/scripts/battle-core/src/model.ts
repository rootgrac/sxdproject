/**
 * 战斗数据模型（M0 原型子集，开发文档 §3.4）。
 * 属性模型完整清单（生命/武攻/武防/绝攻/绝防/法攻/法防/速度/命中/闪避/暴击/韧性/格挡/破击）
 * 待数值定稿后扩展；原型只实现：攻/防/速/命中/闪避/暴击 + 气势。
 * 规则示例参数（普攻 +25 气势、被击 +15、气势 100 放绝技、30 回合判平）为文档占位值，M1 前定稿。
 */

export type Side = 'ally' | 'enemy';
export type Winner = Side | 'draw';

export interface UnitStats {
  atk: number;   // 攻击（物理，占位统一）
  def: number;   // 防御（物理，占位统一）
  spd: number;   // 速度：决定行动顺序
  acc: number;   // 命中
  eva: number;   // 闪避
  crit: number;  // 暴击率 [0,1]
}

export interface Unit {
  id: string;
  side: Side;
  name: string;
  maxHp: number;
  hp: number;
  /** 气势 [0, qiMax]，≥ qiMax 时行动改为释放绝技 */
  qi: number;
  /** 绝技（气势技）id——表现层用于显示技能名；效果倍率见 skillRatio */
  skillId: string;
  /** 绝技伤害倍率（由技能配置注入，M1-3）；缺省回退 BattleConfig.skillRatio */
  skillRatio?: number;
  stats: UnitStats;
}

export interface BattleConfig {
  maxRounds: number;      // 超过判平
  qiMax: number;          // 气势上限
  qiGainAttack: number;   // 普攻命中后自身气势
  qiGainHurt: number;     // 受到伤害后气势
  skillRatio: number;     // 绝技伤害倍率（占位，未来由技能效果器表驱动）
  defFactor: number;      // 防御减伤系数（占位：dmg = atk*ratio - def*defFactor）
  critMult: number;       // 暴击倍率
  minHitChance: number;   // 命中率下限
  maxHitChance: number;   // 命中率上限
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  maxRounds: 30,
  qiMax: 100,
  qiGainAttack: 25,
  qiGainHurt: 15,
  skillRatio: 1.8,
  defFactor: 0.6,
  critMult: 1.5,
  minHitChance: 0.05,
  maxHitChance: 0.95,
};

export const DEFAULT_STATS: UnitStats = {
  atk: 100,
  def: 50,
  spd: 80,
  acc: 1,
  eva: 0.1,
  crit: 0.1,
};

export interface MakeUnitOptions {
  id: string;
  side: Side;
  name?: string;
  hp?: number;
  skillId?: string;
  skillRatio?: number;
  stats?: Partial<UnitStats>;
}

/** 便捷构造（血满、气势 0），供配置表与测试使用 */
export function makeUnit(o: MakeUnitOptions): Unit {
  const maxHp = o.hp ?? 1000;
  return {
    id: o.id,
    side: o.side,
    name: o.name ?? o.id,
    maxHp,
    hp: maxHp,
    qi: 0,
    skillId: o.skillId ?? 'ultimate',
    skillRatio: o.skillRatio,
    stats: { ...DEFAULT_STATS, ...o.stats },
  };
}

/** 战斗事件流：结算与表现分离，演出层只消费事件（§3.4） */
export type BattleEvent =
  | { type: 'round'; round: number }
  | {
      type: 'attack';
      tick: number;
      round: number;
      actor: string;
      target: string;
      hit: boolean;
      crit: boolean;
      damage: number;
      actorQi: number;
      targetQi: number;
    }
  | {
      type: 'skill';
      tick: number;
      round: number;
      actor: string;
      target: string;
      crit: boolean;
      damage: number;
      actorQi: number;
      targetQi: number;
    }
  | { type: 'death'; tick: number; round: number; unit: string }
  | { type: 'end'; winner: Winner; rounds: number };

export interface BattleResult {
  winner: Winner;
  rounds: number;
  seed: number;
  events: BattleEvent[];
}
