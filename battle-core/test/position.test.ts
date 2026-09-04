import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattle } from '../src/engine.ts';
import { makeUnit } from '../src/model.ts';
import type { Unit } from '../src/model.ts';

function mk(id: string, side: 'ally' | 'enemy', over: Partial<{ hp: number; atk: number; def: number; spd: number }> = {}, position?: number): Unit {
  return makeUnit({
    id,
    side,
    hp: over.hp ?? 100_000,
    stats: { atk: over.atk ?? (side === 'ally' ? 100 : 0), def: over.def ?? 0, spd: over.spd ?? (side === 'ally' ? 200 : 100), acc: 1, eva: 0, crit: 0 },
    position,
  });
}

test('目标选择：列号最小优先（前排先承受攻击）', () => {
  const allies = [mk('A', 'ally')];
  // e_front 在前排(col0)，e_back 在后排(col2)；后排 hp 更低也不应被先攻击
  const enemies = [
    mk('e_back', 'enemy', { hp: 1000, def: 0 }, 8),
    mk('e_front', 'enemy', { hp: 100_000, def: 0 }, 0),
  ];
  const r = runBattle({ seed: 1, allies, enemies, config: { maxRounds: 6 } });
  const attacks = r.events.filter((e) => e.type === 'attack' && e.actor === 'A');
  assert.ok(attacks.length > 0);
  for (const a of attacks.slice(0, attacks.length - 1)) {
    assert.equal(a.target, 'e_front'); // 前排不倒，后排不会被攻击
  }
});

test('前排倒下后目标转向后排', () => {
  const allies = [mk('A', 'ally', { atk: 1000 })];
  const enemies = [
    mk('e_back', 'enemy', { hp: 100_000, def: 0 }, 8),
    mk('e_front', 'enemy', { hp: 100, def: 0 }, 0),
  ];
  const r = runBattle({ seed: 2, allies, enemies, config: { maxRounds: 10 } });
  assert.ok(r.events.some((e) => e.type === 'attack' && e.actor === 'A' && e.target === 'e_back'));
});

test('站位加成：后排攻击 +50%（atk 100 → 150）', () => {
  const allies = [mk('A', 'ally', { atk: 100 }, 8)]; // 后排
  const enemies = [mk('E', 'enemy', { def: 0 })];
  const r = runBattle({ seed: 3, allies, enemies, config: { backAtk: 0.5, maxRounds: 5 } });
  const atk = r.events.find((e) => e.type === 'attack' && e.actor === 'A');
  assert.ok(atk && atk.type === 'attack');
  assert.equal(atk.damage, 150);
});

test('站位加成：前排防御 +100%（敌 def 100 → 200，伤害 100→floor(100-120)= 1 下限）', () => {
  const allies = [mk('A', 'ally', { atk: 100 })];
  const enemies = [mk('E', 'enemy', { def: 100 }, 0)]; // 前排
  const r = runBattle({ seed: 4, allies, enemies, config: { frontDef: 1.0, maxRounds: 5 } });
  const atk = r.events.find((e) => e.type === 'attack' && e.actor === 'A');
  assert.ok(atk && atk.type === 'attack');
  assert.equal(atk.damage, 1); // floor(100 - 200*0.6) = -20 → 下限 1
});

test('站位加成默认关闭：不布阵单位不受影响（兼容既有行为）', () => {
  const allies = [mk('A', 'ally', { atk: 100 })]; // 无 position
  const enemies = [mk('E', 'enemy', { def: 0 })];
  const r = runBattle({ seed: 5, allies, enemies, config: { backAtk: 0.5, maxRounds: 5 } });
  const atk = r.events.find((e) => e.type === 'attack' && e.actor === 'A');
  assert.ok(atk && atk.type === 'attack');
  assert.equal(atk.damage, 100); // 未布阵：不享受后排加成
});
