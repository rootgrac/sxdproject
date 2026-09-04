import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addExp,
  expToNext,
  MAX_LEVEL,
  powerOf,
  realmOfLevel,
  REALM_NAMES,
} from '../../../client/assets/scripts/modules/role/role-core.ts';
import type { RoleState } from '../../../client/assets/scripts/modules/role/role-core.ts';

function mk(level = 1, exp = 0, realm = 0): RoleState {
  return { name: '云骞', level, exp, realm };
}

test('经验累积：一次升级，等级+1 并扣除对应经验', () => {
  const r = mk(1, 0);
  const g = addExp(r, expToNext(1));
  assert.equal(g.levelUps, 1);
  assert.equal(r.level, 2);
  assert.equal(r.exp, 0);
});

test('大量经验连升多级（经验正确扣减）', () => {
  const r = mk(1, 0);
  // 升到 4 级所需：100+150+200=450
  const g = addExp(r, 450);
  assert.equal(g.levelUps, 3);
  assert.equal(r.level, 4);
  assert.equal(r.exp, 0);
  const g2 = addExp(r, 60);
  assert.equal(g2.levelUps, 0);
  assert.equal(r.level, 4);
  assert.equal(r.exp, 60); // 不满一级时经验保留
});

test('境界：随等级突破，返回 realmUps', () => {
  const r = mk(1, 0);
  r.exp = 0;
  r.level = 9;
  r.realm = realmOfLevel(9);
  assert.equal(r.realm, 0); // 通脉
  const g = addExp(r, expToNext(9));
  assert.equal(g.levelUps, 1);
  assert.equal(r.level, 10);
  assert.equal(r.realm, 1); // 凝元
  assert.equal(g.realmUps, 1);
  assert.equal(REALM_NAMES[r.realm], '凝元');
});

test('满级后不再累计经验', () => {
  const r = mk(MAX_LEVEL, 0);
  const g = addExp(r, 999_999);
  assert.equal(g.levelUps, 0);
  assert.equal(r.level, MAX_LEVEL);
  assert.equal(r.exp, 0);
});

test('境界推导与命名边界', () => {
  assert.equal(realmOfLevel(1), 0);
  assert.equal(realmOfLevel(9), 0);
  assert.equal(realmOfLevel(10), 1);
  assert.equal(realmOfLevel(19), 1);
  assert.equal(realmOfLevel(20), 2); // 丹成
  assert.equal(realmOfLevel(34), 2);
  assert.equal(realmOfLevel(35), 3); // 婴变
  assert.equal(REALM_NAMES.length, 6);
});

test('战力占位公式可计算', () => {
  const r = mk(12, 0, realmOfLevel(12));
  const p = powerOf(r, { hp: 1000, atk: 120, def: 60, spd: 110 });
  // 100 + 360 + 120 + 220 + 180 + 100 = 1080
  assert.equal(p, 1080);
});
