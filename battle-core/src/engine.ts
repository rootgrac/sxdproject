/**
 * 确定性回合制战斗内核（M1-6：技能 = 效果器列表驱动）。
 * 输入 =（我方阵容，敌方阵容，随机种子，配置, 技能效果表），同输入必同结果（§3.4）。
 *
 * 规则（占位，M1 数值定稿前）：
 * - 每轮按速度降序行动（同速保持阵容顺序）；死亡单位跳过
 * - 行动时气势 ≥ qiMax → 释放绝技：先发 cast 事件，再按效果器表逐段执行
 *   （damage 伤害段 / heal 治疗 / buff·debuff 增减益，见 SkillEffectDef）
 *   绝技技能未配置效果器时回退单段伤害（倍率 = 单位 skillRatio ?? config.skillRatio）
 * - 普攻命中判定：命中率 = acc/(acc+eva)，夹在 [min,max]；命中后自身 +qiGainAttack 气势
 * - 受到伤害 +qiGainHurt 气势；伤害 dmg = effAtk×ratio − effDef×defFactor，暴击 ×critMult，下限 1
 * - 增减益按属性乘区叠加（buff atk+0.5 时 effAtk = base×1.5），持续 duration 回合（含施放回合）
 * - 目标选择：敌方存活列表首位（九宫格站位/前排在 M1-5 布阵系统接入）
 * - 一方全灭即胜；超过 maxRounds 判平
 */
import { Rng } from './rng.ts';
import type { BattleBuff, BattleConfig, BattleEvent, BattleResult, Side, SkillEffectDef, Unit } from './model.ts';
import { DEFAULT_BATTLE_CONFIG } from './model.ts';

export interface BattleInput {
  seed: number;
  allies: Unit[];
  enemies: Unit[];
  config?: Partial<BattleConfig>;
  /** 技能效果器表：skillId → 效果器列表（M1-6）；缺省技能回退单段伤害 */
  skillEffects?: Record<string, SkillEffectDef[]>;
}

function cloneUnit(u: Unit): Unit {
  return { ...u, stats: { ...u.stats } };
}

function hitChanceOf(a: Unit['stats'], t: Unit['stats'], cfg: BattleConfig): number {
  const raw = a.acc / (a.acc + t.eva);
  return Math.min(cfg.maxHitChance, Math.max(cfg.minHitChance, raw));
}

export function runBattle(input: BattleInput): BattleResult {
  const cfg: BattleConfig = { ...DEFAULT_BATTLE_CONFIG, ...input.config };
  const rng = new Rng(input.seed);
  const events: BattleEvent[] = [];
  const units: Unit[] = [...input.allies.map(cloneUnit), ...input.enemies.map(cloneUnit)];
  /** 临时状态（增减益）：unitId → buffs */
  const buffs = new Map<string, BattleBuff[]>();
  let tick = 0;

  const sideAlive = (s: Side): boolean => units.some((u) => u.side === s && u.hp > 0);

  /** 站位列：未布阵单位视为后排（col=2），保证既有行为兼容 */
  const colOf = (u: Unit): number => (u.position === undefined ? 2 : u.position % 3);

  /** 目标选择（M1-5）：敌方存活中「列号最小」优先（前排先承受攻击），同列保持阵容顺序 */
  const firstTargetOf = (u: Unit): Unit | null => {
    const foe: Side = u.side === 'ally' ? 'enemy' : 'ally';
    let best: Unit | null = null;
    let bestCol = Number.MAX_SAFE_INTEGER;
    for (const x of units) {
      if (x.side === foe && x.hp > 0) {
        const c = colOf(x);
        if (c < bestCol) {
          bestCol = c;
          best = x;
        }
      }
    }
    return best;
  };

  const buffListOf = (u: Unit): BattleBuff[] => {
    let list = buffs.get(u.id);
    if (!list) {
      list = [];
      buffs.set(u.id, list);
    }
    return list;
  };

  /** 属性乘区：基础值 × (1 + 增减益 + 站位加成)；buff 在 [施放回合, untilRound) 内生效 */
  const effStat = (u: Unit, stat: 'atk' | 'def', round: number): number => {
    let multSum = 0;
    for (const b of buffListOf(u)) {
      if (b.stat === stat && round < b.untilRound) multSum += b.mult;
    }
    let bonus = 0;
    if (u.position !== undefined) {
      const col = colOf(u);
      if (col === 0 && stat === 'def') bonus += cfg.frontDef;
      if (col === 2 && stat === 'atk') bonus += cfg.backAtk;
    }
    return u.stats[stat] * (1 + multSum + bonus);
  };

  /** 伤害判定（含暴击与增减益），不修改状态 */
  const rollDamage = (u: Unit, t: Unit, ratio: number, round: number): { crit: boolean; damage: number } => {
    const crit = rng.chance(u.stats.crit);
    const raw = effStat(u, 'atk', round) * ratio - effStat(t, 'def', round) * cfg.defFactor;
    const damage = Math.max(1, Math.floor(crit ? raw * cfg.critMult : raw));
    return { crit, damage };
  };

  const gainHurtQi = (t: Unit): void => {
    t.qi = Math.min(cfg.qiMax, t.qi + cfg.qiGainHurt);
  };

  const onKill = (t: Unit, round: number): void => {
    if (t.hp <= 0) {
      events.push({ type: 'death', tick: ++tick, round, unit: t.id });
    }
  };

  const castSkill = (u: Unit, round: number): void => {
    const skillId = u.skillId || '__ultimate';
    u.qi = 0;
    events.push({ type: 'skill', tick: ++tick, round, actor: u.id, skillId, actorQi: u.qi });

    const defined = input.skillEffects?.[skillId];
    const effects: SkillEffectDef[] =
      defined && defined.length > 0
        ? defined
        : [{ id: '__auto', kind: 'damage', target: 'enemy', ratio: u.skillRatio ?? cfg.skillRatio }];

    for (const fx of effects) {
      if (fx.kind === 'damage') {
        const t = firstTargetOf(u);
        if (!t) break;
        const { crit, damage } = rollDamage(u, t, fx.ratio ?? 1, round);
        t.hp -= damage;
        gainHurtQi(t);
        events.push({
          type: 'effect',
          tick: ++tick,
          round,
          actor: u.id,
          skillId,
          effectId: fx.id,
          kind: 'damage',
          target: t.id,
          crit,
          damage,
        });
        onKill(t, round);
      } else if (fx.kind === 'heal') {
        const healing = Math.min(
          u.maxHp - u.hp,
          Math.max(0, Math.floor(effStat(u, 'atk', round) * (fx.ratio ?? 1))),
        );
        u.hp += healing;
        events.push({
          type: 'effect',
          tick: ++tick,
          round,
          actor: u.id,
          skillId,
          effectId: fx.id,
          kind: 'heal',
          target: u.id,
          healing,
        });
      } else {
        // buff / debuff
        const t = fx.target === 'self' ? u : firstTargetOf(u);
        if (!t) break;
        const base = Math.max(1, fx.duration ?? 1);
        const mult = (fx.kind === 'buff' ? 1 : -1) * (fx.value ?? 0);
        const untilRound = round + base;
        buffListOf(t).push({ stat: fx.stat ?? 'atk', mult, untilRound });
        events.push({
          type: 'effect',
          tick: ++tick,
          round,
          actor: u.id,
          skillId,
          effectId: fx.id,
          kind: fx.kind,
          target: t.id,
          stat: fx.stat ?? 'atk',
          mult,
          untilRound,
        });
      }
    }
  };

  const act = (u: Unit, round: number): void => {
    const t = firstTargetOf(u);
    if (!t) return;

    if (u.qi >= cfg.qiMax) {
      castSkill(u, round);
    } else if (rng.chance(hitChanceOf(u.stats, t.stats, cfg))) {
      // 普攻命中
      const { crit, damage } = rollDamage(u, t, 1, round);
      t.hp -= damage;
      u.qi = Math.min(cfg.qiMax, u.qi + cfg.qiGainAttack);
      gainHurtQi(t);
      events.push({
        type: 'attack',
        tick: ++tick,
        round,
        actor: u.id,
        target: t.id,
        hit: true,
        crit,
        damage,
        actorQi: u.qi,
        targetQi: t.qi,
      });
      onKill(t, round);
    } else {
      events.push({
        type: 'attack',
        tick: ++tick,
        round,
        actor: u.id,
        target: t.id,
        hit: false,
        crit: false,
        damage: 0,
        actorQi: u.qi,
        targetQi: t.qi,
      });
    }
  };

  let winner: BattleResult['winner'] | null = null;
  let rounds = 0;

  outer: for (let round = 1; round <= cfg.maxRounds; round++) {
    rounds = round;
    events.push({ type: 'round', round });
    const order = units
      .filter((u) => u.hp > 0)
      .sort((a, b) => b.stats.spd - a.stats.spd); // 稳定排序：同速保持原顺序
    for (const u of order) {
      if (u.hp <= 0) continue;
      act(u, round);
      if (!sideAlive('enemy')) {
        winner = 'ally';
        break outer;
      }
      if (!sideAlive('ally')) {
        winner = 'enemy';
        break outer;
      }
    }
  }

  if (!winner) winner = 'draw';
  events.push({ type: 'end', winner, rounds });
  return { winner, rounds, seed: input.seed, events };
}
