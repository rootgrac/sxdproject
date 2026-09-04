/**
 * 批量战斗模拟器（表驱动基线版，开发文档 §3.6 / §4.3）。
 *
 * 阵容与技能全部来自 config/export（unit/skill/skill_effect）：
 *  - 我方 = unit 表前 3（主角队，含效果器：治疗/护盾/爆发）
 *  - 敌方 = unit 表第 4-6（第一章敌方模板），布阵 0/1/2
 * 数值改动后运行本工具即可得到新基线，用于对照胜率曲线。
 *
 * 运行：node tools/sim/run.ts [每场景场数=1000]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBattle } from '../../battle-core/src/engine.ts';
import { buildEffects, buildUnits } from '../../battle-core/src/setup.ts';
import type { SkillEffectRow, SkillRow, UnitRow } from '../../battle-core/src/setup.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORT = join(HERE, '..', '..', 'config', 'export');

function readRows(name: string): unknown[] {
  return JSON.parse(readFileSync(join(EXPORT, `${name}.json`), 'utf8')) as unknown[];
}

function cloneRows(rows: UnitRow[], key: 'atk' | 'def' | 'spd', factor: number): UnitRow[] {
  return rows.map((r) => ({ ...r, [key]: (r[key] as number) * factor }));
}

interface SimStats {
  allyWins: number;
  enemyWins: number;
  draws: number;
  roundsSum: number;
  total: number;
}

function simulate(allies: ReturnType<typeof buildUnits>, enemies: ReturnType<typeof buildUnits>, effects: ReturnType<typeof buildEffects>, runs: number): SimStats {
  const s: SimStats = { allyWins: 0, enemyWins: 0, draws: 0, roundsSum: 0, total: runs };
  for (let seed = 1; seed <= runs; seed++) {
    const r = runBattle({ seed, allies, enemies, skillEffects: effects });
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

function main(): void {
  const runs = Math.max(1, Math.floor(Number(process.argv[2]) || 1000));
  const unitRows = readRows('unit') as UnitRow[];
  const skillRows = readRows('skill') as SkillRow[];
  const effectRows = readRows('skill_effect') as SkillEffectRow[];
  const effects = buildEffects(effectRows);

  const heroRows = unitRows.slice(0, 3);
  const foeRows = unitRows.slice(3, 6);
  const names = (rs: UnitRow[]) => rs.map((r) => r.name).join('/');

  const mkAllies = (rows: UnitRow[]) => buildUnits(rows, skillRows, 'ally').map((u, i) => ({ ...u, position: i }));
  const mkEnemies = (rows: UnitRow[]) => buildUnits(rows, skillRows, 'enemy').map((u, i) => ({ ...u, position: Math.min(i, 2) }));

  const baseA = mkAllies(heroRows);
  const baseE = mkEnemies(foeRows);

  console.log('仙途 HD · 批量战斗模拟器（表驱动基线 · config/export）');
  console.log(`阵容：我方 ${names(heroRows)} vs 敌方 ${names(foeRows)}`);
  console.log(`技能效果器：${effectRows.map((e) => e.skill).join(', ') || '无'}`);
  console.log(`每场景场数：${runs}（seed 1..${runs}）\n`);
  console.log('场景'.padEnd(20), '我方胜'.padStart(8), '敌方胜'.padStart(8), '平局'.padStart(7), '平均回合'.padStart(8));

  const base = simulate(baseA, baseE, effects, runs);
  const scenarios = [
    { name: '基线（当前表数值）', allies: baseA, enemies: baseE },
    { name: '我方攻击 ×1.1', allies: mkAllies(cloneRows(heroRows, 'atk', 1.1)), enemies: baseE },
    { name: '敌方防御 ×1.2', allies: baseA, enemies: mkEnemies(cloneRows(foeRows, 'def', 1.2)) },
    { name: '敌方攻击 ×1.1', allies: baseA, enemies: mkEnemies(cloneRows(foeRows, 'atk', 1.1)) },
  ];
  for (const sc of scenarios) {
    const s = simulate(sc.allies, sc.enemies, effects, runs);
    const delta = s.allyWins - base.allyWins;
    const deltaTxt = sc.name === scenarios[0].name ? '' : `  （vs 基线 ${delta >= 0 ? '+' : ''}${pct(delta, runs)}）`;
    console.log(
      sc.name.padEnd(20),
      pct(s.allyWins, runs).padStart(8),
      pct(s.enemyWins, runs).padStart(8),
      pct(s.draws, runs).padStart(7),
      (s.roundsSum / s.total).toFixed(1).padStart(6) + ' 回',
      deltaTxt,
    );
  }
  console.log('\n基线说明：数值改动（config/tables）后重跑本工具对比；偏差超 ±5pp 需产品确认（config/battle.md §5）。');
}

main();
