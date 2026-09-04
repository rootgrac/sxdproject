import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, countOf, removeItem } from '../../../client/assets/scripts/modules/item/item-core.ts';
import type { BagItem } from '../../../client/assets/scripts/modules/item/item-core.ts';
import { canCraft, craft, craftableEquips, needsOf, salvage } from '../../../client/assets/scripts/modules/equip/craft-core.ts';
import type { CraftRow } from '../../../client/assets/scripts/modules/equip/craft-core.ts';

const ROWS: CraftRow[] = [
  { id: 'cr1', craft: 'eq_w2', item: 'it_iron', count: 3 },
  { id: 'cr2', craft: 'eq_w2', item: 'it_spirit', count: 1 },
  { id: 'cr3', craft: 'eq_a2', item: 'it_iron', count: 4 },
];

test('背包：堆叠入账/出账/不足抛错/清零移除', () => {
  const bag: BagItem[] = [];
  addItem(bag, 'it_iron', 2);
  addItem(bag, 'it_iron', 3);
  assert.equal(countOf(bag, 'it_iron'), 5);
  addItem(bag, 'it_spirit', 1);
  assert.equal(bag.length, 2);
  removeItem(bag, 'it_iron', 5);
  assert.equal(countOf(bag, 'it_iron'), 0);
  assert.equal(bag.length, 1); // 清零条目移除
  assert.throws(() => removeItem(bag, 'it_iron', 1), /物品不足/);
  assert.throws(() => addItem(bag, 'it_iron', 0), /数量必须为正/);
});

test('配方聚合与可打造集合', () => {
  const need = needsOf(ROWS, 'eq_w2');
  assert.deepEqual(need.sort((a, b) => a.itemId.localeCompare(b.itemId)), [
    { itemId: 'it_iron', count: 3 },
    { itemId: 'it_spirit', count: 1 },
  ]);
  assert.deepEqual(craftableEquips(ROWS).sort(), ['eq_a2', 'eq_w2']);
  assert.equal(needsOf(ROWS, 'eq_o1').length, 0); // 无配方
});

test('打造：材料足够产出实例并扣料；不足拒绝', () => {
  const bag: BagItem[] = [{ itemId: 'it_iron', count: 3 }, { itemId: 'it_spirit', count: 1 }];
  assert.equal(canCraft(ROWS, bag, 'eq_w2'), true);
  const made = craft(ROWS, bag, 'eq_w2', 'equip_1');
  assert.equal(made.equipId, 'eq_w2');
  assert.equal(made.enhance, 0);
  assert.equal(made.owner, null);
  assert.equal(countOf(bag, 'it_iron'), 0); // 3-3
  assert.equal(countOf(bag, 'it_spirit'), 0); // 1-1

  // 材料不足
  addItem(bag, 'it_iron', 3);
  assert.equal(canCraft(ROWS, bag, 'eq_a2'), false); // 需 4 铁
  assert.throws(() => craft(ROWS, bag, 'eq_a2', 'x'), /物品不足/);
  assert.throws(() => craft(ROWS, bag, 'eq_nope', 'x'), /无打造配方/);
});

test('分解回收：50% 材料返还（向下取整）', () => {
  const bag: BagItem[] = [{ itemId: 'it_iron', count: 3 }, { itemId: 'it_spirit', count: 1 }];
  craft(ROWS, bag, 'eq_w2', 'e1'); // 消耗 3铁1砂
  assert.equal(countOf(bag, 'it_iron'), 0);
  salvage(ROWS, bag, 'eq_w2'); // 回收 floor(3×0.5)=1 铁、floor(1×0.5)=0 砂
  assert.equal(countOf(bag, 'it_iron'), 1);
  assert.equal(countOf(bag, 'it_spirit'), 0);
});
