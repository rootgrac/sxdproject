import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bonusOf,
  createEquip,
  defOf,
  enhanceCapOf,
  enhanceCost,
  enhanceItem,
  equipTo,
  sumBonus,
  unequip,
} from '../../../client/assets/scripts/modules/equip/equip-core.ts';
import type { EquipDefRow, EquipState } from '../../../client/assets/scripts/modules/equip/equip-core.ts';

const DEFS: EquipDefRow[] = [
  { id: 'eq_w1', slot: 'weapon', name: '青锋剑', atk: 30, def: 0, hp: 0 },
  { id: 'eq_w2', slot: 'weapon', name: '重岳刀', atk: 50, def: 0, hp: 0 },
  { id: 'eq_a1', slot: 'armor', name: '棉布护身', atk: 0, def: 20, hp: 0 },
  { id: 'eq_o1', slot: 'orb', name: '聚灵珠', atk: 0, def: 0, hp: 300 },
];

test('装备定义与属性（含强化成长 +10%/级）', () => {
  assert.equal(defOf(DEFS, 'eq_w1').slot, 'weapon');
  const b0 = bonusOf(DEFS[0], 0);
  assert.deepEqual(b0, { atk: 30, def: 0, hp: 0 });
  const b3 = bonusOf(DEFS[0], 3); // 30×1.3=39
  assert.equal(b3.atk, 39);
  const b1 = bonusOf(DEFS[3], 1); // 300×1.1=330
  assert.equal(b1.hp, 330);
});

test('穿戴：同部位换装自动卸旧、跨部位共存、被占用拒绝', () => {
  const equips: EquipState[] = [createEquip('e1', 'eq_w1'), createEquip('e2', 'eq_w2'), createEquip('e3', 'eq_a1')];
  equipTo(equips, equips[0], DEFS, 'hero'); // 穿青锋剑
  equipTo(equips, equips[2], DEFS, 'hero'); // 穿护身（armor 不同部位）
  assert.equal(equips[0].owner, 'hero');
  assert.equal(equips[2].owner, 'hero');
  // 换武器：e2 装备 e1 被卸下
  equipTo(equips, equips[1], DEFS, 'hero');
  assert.equal(equips[1].owner, 'hero');
  assert.equal(equips[0].owner, null);
  // 穿给别人（伙伴）
  equipTo(equips, equips[0], DEFS, 'p_1');
  assert.equal(equips[0].owner, 'p_1');
});

test('属性汇总：只统计指定 owner', () => {
  const equips: EquipState[] = [
    { ...createEquip('e1', 'eq_w1'), owner: 'hero' },
    { ...createEquip('e2', 'eq_o1'), owner: 'hero' },
    { ...createEquip('e3', 'eq_w2'), owner: 'p_1' },
  ];
  const s = sumBonus(DEFS, equips, 'hero');
  assert.deepEqual(s, { atk: 30, def: 0, hp: 300 });
  const sp = sumBonus(DEFS, equips, 'p_1');
  assert.equal(sp.atk, 50);
});

test('卸下与强化（上限随境界/费用曲线）', () => {
  const equips: EquipState[] = [createEquip('e1', 'eq_w1')];
  equipTo(equips, equips[0], DEFS, 'hero');
  unequip(equips[0]);
  assert.equal(equips[0].owner, null);

  assert.equal(enhanceCapOf(0), 5);
  assert.equal(enhanceCapOf(1), 10);
  assert.equal(enhanceCost(0), 100);
  const item = equips[0];
  enhanceItem(item, 0);
  assert.equal(item.enhance, 1);
  // 推到上限后拒绝
  const big = createEquip('e2', 'eq_w1');
  big.enhance = enhanceCapOf(0);
  assert.throws(() => enhanceItem(big, 0), /已达上限/);
  // 境界提升解锁更高上限：realm1 上限 10，realm2 上限 15
  big.enhance = enhanceCapOf(1);
  assert.throws(() => enhanceItem(big, 1), /已达上限/);
  big.enhance = enhanceCapOf(2) - 1;
  assert.equal(enhanceItem(big, 2), enhanceCapOf(2));
});
