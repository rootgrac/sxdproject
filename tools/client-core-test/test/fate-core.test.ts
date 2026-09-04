import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addFateOrEvolve,
  autoEquip,
  equippedFates,
  findFate,
  FATE_SLOT_COUNT,
  setSlot,
  sumFateBonus,
} from '../../../client/assets/scripts/modules/fate/fate-core.ts';
import type { FateDefRow, FateSetRow, FateState } from '../../../client/assets/scripts/modules/fate/fate-core.ts';

const DEFS: FateDefRow[] = [
  { id: 'f1', name: '微光·破军', stat: 'atk', value: 25, set_id: 0, weight: 40, rarity: 1 },
  { id: 'f3', name: '流辉·北辰一', stat: 'atk', value: 35, set_id: 1, weight: 30, rarity: 2 },
  { id: 'f4', name: '流辉·北辰二', stat: 'def', value: 25, set_id: 1, weight: 30, rarity: 2 },
  { id: 'f7', name: '曜华·天枢', stat: 'atk', value: 70, set_id: 0, weight: 15, rarity: 3 },
];
const SETS: FateSetRow[] = [
  { id: 's1', set_id: 1, need: 2, stat: 'atk', value: 30 },
];

test('新增与精进：同名重复 +1 级', () => {
  const fates: FateState[] = [];
  let n = 0;
  const gen = (): string => `f${++n}`;
  const r1 = addFateOrEvolve(fates, DEFS[0], gen());
  assert.equal(r1.kind, 'new');
  assert.equal(r1.level, 1);
  const r2 = addFateOrEvolve(fates, DEFS[0], gen());
  assert.equal(r2.kind, 'evolve');
  assert.equal(r2.level, 2);
  assert.equal(fates.length, 1); // 同源合一
});

test('8 槽装配：setSlot/autoEquip/卸下/满槽拒绝', () => {
  const fates: FateState[] = [];
  let n = 0;
  const gen = (): string => `u${++n}`;
  for (const d of DEFS) addFateOrEvolve(fates, d, gen());
  const slots: (string | null)[] = new Array(FATE_SLOT_COUNT).fill(null);
  for (const f of fates) autoEquip(slots, f.uid);
  assert.equal(slots.filter((s) => s !== null).length, 4);
  // 满 8 槽时拒绝新装配（构造满槽场景）
  const full: (string | null)[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const newFate = addFateOrEvolve(fates, DEFS[3], gen());
  assert.throws(() => autoEquip(full, newFate.uid), /槽已满/);
  // 卸下槽 0 → 可再装
  setSlot(full, 0, null);
  autoEquip(full, newFate.uid);
  assert.equal(full[0], newFate.uid);
});

test('加成：单件 level×value 累加 + 套装件数达标追加', () => {
  const fates: FateState[] = [
    { uid: 'a', fateId: 'f3', level: 2 }, // 北辰一 atk 70
    { uid: 'b', fateId: 'f4', level: 1 }, // 北辰二 def 25
    { uid: 'c', fateId: 'f1', level: 1 }, // 破军 atk 25（未装配）
  ];
  const slots: (string | null)[] = ['a', 'b', null, null, null, null, null, null];
  const b = sumFateBonus(DEFS, SETS, fates, slots);
  assert.equal(b.atk, 70 + 30); // 70 + 北辰两件套 atk30
  assert.equal(b.def, 25);
  // 未装配的破军不计入
});

test('装配槽损坏引用容错', () => {
  const fates: FateState[] = [{ uid: 'a', fateId: 'f1', level: 1 }];
  const slots: (string | null)[] = ['a', 'ghost', null, null, null, null, null, null];
  const eq = equippedFates(fates, slots);
  assert.equal(eq.length, 1);
  assert.equal(eq[0].uid, 'a');
});

test('findFate', () => {
  const fates: FateState[] = [{ uid: 'x', fateId: 'f7', level: 3 }];
  assert.equal(findFate(fates, 'x')?.level, 3);
  assert.equal(findFate(fates, 'y'), undefined);
});
