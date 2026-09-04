import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattle } from '../src/engine.ts';
import { buildUnits } from '../src/setup.ts';
import type { SkillRow, UnitRow } from '../src/setup.ts';

const SKILLS: SkillRow[] = [
  { id: 'sk_basic', name: '普攻', kind: 'normal', ratio: 1 },
  { id: 'sk_qi', name: '绝技·冲霄', kind: 'ultimate', ratio: 1.8 },
  { id: 'sk_guard', name: '绝技·磐石', kind: 'ultimate', ratio: 1.5 },
];

const UNITS: UnitRow[] = [
  { id: 'u001', name: '云骞', hp: 1000, atk: 120, def: 60, spd: 110, acc: 1, eva: 0.05, crit: 0.15, skills: ['sk_basic', 'sk_qi'] },
  { id: 'u002', name: '洛璃', hp: 850, atk: 150, def: 40, spd: 125, acc: 0.95, eva: 0.1, crit: 0.05, skills: ['sk_basic', 'sk_qi'] },
  { id: 'u003', name: '沈砚', hp: 1200, atk: 90, def: 90, spd: 95, acc: 1, eva: 0.05, crit: 0.1, skills: ['sk_basic', 'sk_guard'] },
];

test('buildUnits：字段映射与绝技倍率注入', () => {
  const units = buildUnits(UNITS, SKILLS, 'ally');
  assert.equal(units.length, 3);
  const [u1, u3] = [units[0], units[2]];
  assert.equal(u1.id, 'u001');
  assert.equal(u1.name, '云骞');
  assert.equal(u1.maxHp, 1000);
  assert.equal(u1.stats.acc, 1);
  assert.equal(u1.stats.crit, 0.15);
  assert.equal(u1.skillId, 'sk_qi'); // 首个 ultimate
  assert.equal(u1.skillRatio, 1.8);
  assert.equal(u3.skillRatio, 1.5); // 磐石 1.5
});

test('buildUnits：无绝技/引用缺失时不崩溃且不回退出坏数据', () => {
  const noUlt = buildUnits([{ id: 'x1', name: 'X', hp: 100, atk: 10, def: 0, spd: 10, acc: 1, eva: 0, crit: 0, skills: ['sk_basic'] }], SKILLS, 'ally');
  assert.equal(noUlt[0].skillId, '');
  assert.equal(noUlt[0].skillRatio, undefined);
  const missing = buildUnits([{ id: 'x2', name: 'Y', hp: 100, atk: 10, def: 0, spd: 10, acc: 1, eva: 0, crit: 0, skills: ['nope'] }], SKILLS, 'ally');
  assert.equal(missing[0].skillId, '');
  const emptySkills = buildUnits([{ id: 'x3', name: 'Z', hp: 100, atk: 10, def: 0, spd: 10, acc: 1, eva: 0, crit: 0, skills: [] }], SKILLS, 'ally');
  assert.equal(emptySkills[0].skillId, '');
});

test('配置驱动整场战斗：确定性 & 正常结算', () => {
  const allies = buildUnits(UNITS, SKILLS, 'ally');
  const enemies = buildUnits(UNITS, SKILLS, 'enemy'); // 镜像阵容仅测流程
  const mk = () => ({ seed: 20260904, allies, enemies });
  const r1 = runBattle(mk());
  const r2 = runBattle(mk());
  assert.ok(['ally', 'enemy', 'draw'].includes(r1.winner));
  assert.ok(r1.events.length > 0);
  assert.deepEqual(r1.events, r2.events); // 确定性
  assert.ok(r1.events.some((e) => e.type === 'skill')); // 配置的绝技确实释放
});
