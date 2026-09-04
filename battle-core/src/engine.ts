/**
 * 确定性回合制战斗内核（M0 原型）。
 * 输入 =（我方阵容，敌方阵容，随机种子，配置），同输入必同结果（§3.4）。
 *
 * 规则（占位，M1 数值定稿前）：
 * - 每轮按速度降序行动（同速保持阵容顺序）；死亡单位跳过
 * - 行动时气势 ≥ qiMax → 释放绝技（必中，伤害倍率 skillRatio，气势清零），否则普攻
 * - 普攻命中判定：命中率 = acc/(acc+eva)，夹在 [min,max]；命中后自身 +qiGainAttack 气势
 * - 受到伤害 +qiGainHurt 气势；伤害 dmg = atk*ratio - def*defFactor，暴击 ×critMult，下限 1
 * - 目标选择：敌方存活列表首位（九宫格站位/前排在 M1 布阵系统接入）
 * - 一方全灭即胜；超过 maxRounds 判平
 */
import { Rng } from './rng.ts';
import type { BattleConfig, BattleEvent, BattleResult, Side, Unit } from './model.ts';
import { DEFAULT_BATTLE_CONFIG } from './model.ts';

export interface BattleInput {
  seed: number;
  allies: Unit[];
  enemies: Unit[];
  config?: Partial<BattleConfig>;
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
  let tick = 0;

  const sideAlive = (s: Side): boolean => units.some((u) => u.side === s && u.hp > 0);

  const firstTargetOf = (u: Unit): Unit | null => {
    const foe: Side = u.side === 'ally' ? 'enemy' : 'ally';
    return units.find((x) => x.side === foe && x.hp > 0) ?? null;
  };

  /** 伤害判定（含暴击），不修改状态 */
  const rollDamage = (u: Unit, t: Unit, ratio: number): { crit: boolean; damage: number } => {
    const crit = rng.chance(u.stats.crit);
    const raw = u.stats.atk * ratio - t.stats.def * cfg.defFactor;
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

  const act = (u: Unit, round: number): void => {
    const t = firstTargetOf(u);
    if (!t) return;

    if (u.qi >= cfg.qiMax) {
      // 绝技：必中，气势清零；倍率 = 单位技能配置注入，缺省回退全局 skillRatio
      u.qi = 0;
      const { crit, damage } = rollDamage(u, t, u.skillRatio ?? cfg.skillRatio);
      t.hp -= damage;
      gainHurtQi(t);
      events.push({
        type: 'skill',
        tick: ++tick,
        round,
        actor: u.id,
        target: t.id,
        crit,
        damage,
        actorQi: u.qi,
        targetQi: t.qi,
      });
      onKill(t, round);
    } else if (rng.chance(hitChanceOf(u.stats, t.stats, cfg))) {
      // 普攻命中
      const { crit, damage } = rollDamage(u, t, 1);
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
