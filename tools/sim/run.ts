/**
 * 仙途 HD — 批量战斗模拟器雏形
 *
 * 用途（开发文档 §3.6 / §4.3）：
 * - 数值改动必须走 PR 评审 + 战斗模拟器回归（批量 ≥1000 场校验胜率曲线）
 * - M2 起维护正式平衡报告；本脚本为 M0 基线雏形
 *
 * 运行：
 *   node tools/sim/run.ts            # 每场景 1000 场
 *   node tools/sim/run.ts 2000       # 自定义场数
 *
 * 说明：阵容为占位数值；基准线（场景 1）建议作为每次改动前的对照基线。
 */
import { runBattle } from '../../battle-core/src/engine.ts';
import { makeUnit } from '../../battle-core/src/model.ts';
import type { Side, Unit, UnitStats } from '../../battle-core/src/model.ts';

interface HeroDef {
  id: string;
  hp: number;
  stats: UnitStats;
}

const ALLY_SQUAD: HeroDef[] = [
  { id: '云骞', hp: 1000, stats: { atk: 120, def: 60, spd: 110, acc: 1, eva: 0.05, crit: 0.15 } },
  { id: '洛璃', hp: 850, stats: { atk: 150, def: 40, spd: 125, acc: 0.95, eva: 0.1, crit: 0.05 } },
  { id: '沈砚', hp: 1200, stats: { atk: 90, def: 90, spd: 95, acc: 1, eva: 0.05, crit: 0.1 } },
];

const ENEMY_SQUAD: HeroDef[] = [
  { id: '枯木妖', hp: 900, stats: { atk: 110, def: 50, spd: 100, acc: 0.9, eva: 0.15, crit: 0.05 } },
  { id: '赤目妖', hp: 800, stats: { atk: 130, def: 35, spd: 130, acc: 0.95, eva: 0.05, crit: 0.2 } },
  { id: '黑风妖', hp: 1000, stats: { atk: 100, def: 70, spd: 90, acc: 0.95, eva: 0.1, crit: 0.05 } },
];

function build(defs: HeroDef[], side: Side): Unit[] {
  return defs.map((d) => makeUnit({ id: d.id, side, hp: d.hp, stats: d.stats }));
}

/** 数值敏感性：整体放大某项属性（对照场景用） */
function scaleStat(defs: HeroDef[], key: keyof UnitStats, factor: number): HeroDef[] {
  return defs.map((d) => ({ ...d, stats: { ...d.stats, [key]: d.stats[key] * factor } }));
}

interface SimStats {
  allyWins: number;
  enemyWins: number;
  draws: number;
  total: number;
  roundsSum: number;
}

function simulate(allies: Unit[], enemies: Unit[], runs: number): SimStats {
  const s: SimStats = { allyWins: 0, enemyWins: 0, draws: 0, total: runs, roundsSum: 0 };
  for (let seed = 1; seed <= runs; seed++) {
    const r = runBattle({ seed, allies, enemies });
    if (r.winner === 'ally') s.allyWins++;
    else if (r.winner === 'enemy') s.enemyWins++;
    else s.draws++;
    s.roundsSum += r.rounds;
  }
  return s;
}

function pct(n: number, total: number): string {
  return ((n / total) * 100).toFixed(1) + '%';
}

interface Scenario {
  name: string;
  allies: Unit[];
  enemies: Unit[];
}

function main(): void {
  const runs = Math.max(1, Math.floor(Number(process.argv[2]) || 1000));
  const baseA = build(ALLY_SQUAD, 'ally');
  const baseE = build(ENEMY_SQUAD, 'enemy');

  const scenarios: Scenario[] = [
    { name: '基准（占位数值）', allies: baseA, enemies: baseE },
    { name: '我方攻击 ×1.1', allies: build(scaleStat(ALLY_SQUAD, 'atk', 1.1), 'ally'), enemies: baseE },
    { name: '敌方防御 ×1.2', allies: baseA, enemies: build(scaleStat(ENEMY_SQUAD, 'def', 1.2), 'enemy') },
    { name: '敌方攻击 ×1.1', allies: baseA, enemies: build(scaleStat(ENEMY_SQUAD, 'atk', 1.1), 'enemy') },
  ];

  console.log('仙途 HD · 批量战斗模拟器（雏形）— 平衡回归基线（config/battle.md §5）');
  console.log(`阵容：我方 ${ALLY_SQUAD.map((h) => h.id).join('/')} vs 敌方 ${ENEMY_SQUAD.map((h) => h.id).join('/')}`);
  console.log(`每场景场数：${runs}（seed 1..${runs}）\n`);
  console.log('场景'.padEnd(18), '我方胜'.padStart(8), '敌方胜'.padStart(8), '平局'.padStart(7), '平均回合'.padStart(8));

  const base: SimStats = simulate(scenarios[0].allies, scenarios[0].enemies, runs);
  for (const sc of scenarios) {
    const s = simulate(sc.allies, sc.enemies, runs);
    const allyDelta = s.allyWins - base.allyWins;
    const deltaTxt = sc === scenarios[0] ? '' : `  （vs 基准 ${allyDelta >= 0 ? '+' : ''}${pct(allyDelta, runs)}）`;
    console.log(
      sc.name.padEnd(18),
      pct(s.allyWins, runs).padStart(8),
      pct(s.enemyWins, runs).padStart(8),
      pct(s.draws, runs).padStart(7),
      (s.roundsSum / s.total).toFixed(1).padStart(6) + ' 回',
      deltaTxt,
    );
  }
  console.log('\n说明：改动数值后与基准对比；我方胜率偏差超 ±5 个百分点需产品负责人确认（§3.6 / config/battle.md §5）。');
}

main();
