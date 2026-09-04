import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattle } from '../src/engine.ts';
import { makeUnit } from '../src/model.ts';
import type { SkillEffectDef, Unit } from '../src/model.ts';

/**
 * 效果器体系单测（M1-6）：damage / heal / buff / debuff。
 * 场景均用 1v1 简化推演（acc=1/eva=0 → 必中；crit=0 → 无暴击；数值可精确断言）。
 */

function mkSolo(over: Partial<{ hp: number; atk: number; def: number; spd: number }> = {}, side: 'ally' | 'enemy'): Unit {
  return makeUnit({
    id: side === 'ally' ? 'A' : 'E',
    side,
    hp: over.hp ?? 100_000,
    stats: { atk: over.atk ?? (side === 'ally' ? 100 : 0), def: over.def ?? 0, spd: over.spd ?? (side === 'ally' ? 200 : 100), acc: 1, eva: 0, crit: 0 },
    skillId: 'sk_test',
  });
}

/** 效果器命中 qi 规则：每普攻命中 +25，行动 4 轮后（第 4 回合行动时）qi=100 → 放绝技 */
function runWithEffect(fx: SkillEffectDef): ReturnType<typeof runBattle> {
  const allies = [mkSolo({}, 'ally')];
  const enemies = [mkSolo({}, 'enemy')];
  return runBattle({
    seed: 42,
    allies,
    enemies,
    config: { qiGainAttack: 25, maxRounds: 20 },
    skillEffects: { sk_test: [fx] },
  });
}

const effectEvents = (r: ReturnType<typeof runBattle>) => r.events.filter((e) => e.type === 'effect');

test('damage 效果器：按配置倍率结算（2.0× atk=100 → 200）', () => {
  const r = runWithEffect({ id: 'x', kind: 'damage', target: 'enemy', ratio: 2.0 });
  const dmg = effectEvents(r).find((e) => e.kind === 'damage' && e.actor === 'A');
  assert.ok(dmg && dmg.type === 'effect');
  assert.equal(dmg.damage, 200);
  // cast 事件先于 effect 事件
  const castIdx = r.events.findIndex((e) => e.type === 'skill' && e.actor === 'A');
  const effIdx = r.events.findIndex((e) => e === dmg);
  assert.ok(castIdx >= 0 && effIdx > castIdx);
});

test('heal 效果器：按攻击力倍率回复自身（先被打伤再治疗）', () => {
  // 敌方高速先手持续输出，我方 4 回合攒满气势后放治疗
  const allies = [mkSolo({ atk: 100, spd: 200, hp: 1000 }, 'ally')];
  const enemies = [mkSolo({ atk: 50, spd: 300, hp: 200_000 }, 'enemy')];
  const r = runBattle({
    seed: 7,
    allies,
    enemies,
    config: { maxRounds: 12 },
    skillEffects: { sk_test: [{ id: 'h', kind: 'heal', target: 'self', ratio: 1.5 }] },
  });
  const heal = effectEvents(r).find((e) => e.kind === 'heal');
  assert.ok(heal && heal.type === 'effect');
  assert.ok((heal.healing ?? 0) > 0);
  assert.ok((heal.healing ?? 0) <= 150); // 上限 = floor(atk×1.5)
});

test('buff 效果器：atk+50% 后普攻伤害提升（100 → 150）', () => {
  const r = runWithEffect({ id: 'b', kind: 'buff', target: 'self', stat: 'atk', value: 0.5, duration: 10 });
  const buff = effectEvents(r).find((e) => e.kind === 'buff');
  assert.ok(buff && buff.type === 'effect');
  assert.equal(buff.mult, 0.5);
  assert.equal(buff.untilRound, buff.round + 10);
  // buff 生效后我方普攻伤害 = floor(100×1.5 − 0) = 150
  assert.ok(
    r.events.some((e) => e.type === 'attack' && e.actor === 'A' && e.damage === 150),
    '期望出现 150 伤害的普攻（受 buff 加成）',
  );
});

test('debuff 效果器：敌方 def-50% 使伤害提高（40 → 70）', () => {
  const allies = [mkSolo({ atk: 100, spd: 200, def: 0 }, 'ally')];
  const enemies = [mkSolo({ atk: 0, spd: 100, def: 100, hp: 200_000 }, 'enemy')];
  const r = runBattle({
    seed: 11,
    allies,
    enemies,
    config: { maxRounds: 20 },
    skillEffects: { sk_test: [{ id: 'd', kind: 'debuff', target: 'enemy', stat: 'def', value: 0.5, duration: 3 }] },
  });
  const debuff = effectEvents(r).find((e) => e.kind === 'debuff');
  assert.ok(debuff && debuff.type === 'effect');
  assert.equal(debuff.mult, -0.5);
  // 基础伤害 floor(100-100×0.6)=40；debuff 后 def 50 → floor(100-30)=70
  assert.ok(r.events.some((e) => e.type === 'attack' && e.actor === 'A' && e.damage === 70));
});

test('多段效果器：damage + buff 顺序执行且事件齐全', () => {
  const allies = [mkSolo({ atk: 100, spd: 200 }, 'ally')];
  const enemies = [mkSolo({ atk: 0, spd: 100, def: 0, hp: 200_000 }, 'enemy')];
  const r = runBattle({
    seed: 5,
    allies,
    enemies,
    config: { maxRounds: 20 },
    skillEffects: {
      sk_test: [
        { id: 'd1', kind: 'damage', target: 'enemy', ratio: 1.0 },
        { id: 'b1', kind: 'buff', target: 'self', stat: 'atk', value: 0.3, duration: 5 },
      ],
    },
  });
  const kinds = effectEvents(r).map((e) => (e.type === 'effect' ? `${e.effectId}:${e.kind}` : ''));
  const castIdx = r.events.findIndex((e) => e.type === 'skill');
  assert.ok(castIdx >= 0);
  assert.ok(kinds.includes('d1:damage') && kinds.includes('b1:buff'));
  // d1 的伤害按效果器倍率 1.0 结算
  const dmgEv = effectEvents(r).find((e) => e.type === 'effect' && e.effectId === 'd1');
  assert.equal(dmgEv && dmgEv.type === 'effect' ? dmgEv.damage : -1, 100);
});
