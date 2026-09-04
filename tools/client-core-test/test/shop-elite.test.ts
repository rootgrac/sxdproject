import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, countOf } from '../../../client/assets/scripts/modules/item/item-core.ts';
import type { BagItem } from '../../../client/assets/scripts/modules/item/item-core.ts';
import { buy, priceOf } from '../../../client/assets/scripts/modules/shop/shop-core.ts';
import type { ShopRow } from '../../../client/assets/scripts/modules/shop/shop-core.ts';
import {
  clearsToday,
  findElite,
  grantRewards,
  recordChallenge,
  remainingToday,
  rewardsOf,
  rollDay,
} from '../../../client/assets/scripts/modules/stage/elite-core.ts';
import type { DailyState, EliteRewardRow, EliteRow } from '../../../client/assets/scripts/modules/stage/elite-core.ts';

const SHOP: ShopRow[] = [
  { id: 's1', item: 'it_iron', cost: 100, limit: 0 },
  { id: 's2', item: 'it_spirit', cost: 200, limit: 0 },
];

const ELITE: EliteRow[] = [
  { id: 'e_e1', name: '沉沙涧', enemies: ['u004', 'u005'], stamina_cost: 5, daily_limit: 3 },
];

const REWARDS: EliteRewardRow[] = [
  { id: 'er1', elite: 'e_e1', item: 'it_iron', count: 2 },
  { id: 'er2', elite: 'e_e1', item: 'it_iron', count: 1 }, // 同物品聚合
  { id: 'er3', elite: 'e_e1', item: 'it_spirit', count: 1 },
];

test('商店：单价/批量购买扣款入包/钱不足拒绝', () => {
  const bag: BagItem[] = [];
  const wallet = { copper: 1000 };
  assert.equal(priceOf(SHOP, 'it_iron'), 100);
  const r = buy(SHOP, bag, wallet, 'it_iron', 3);
  assert.equal(r.cost, 300);
  assert.equal(wallet.copper, 700);
  assert.equal(countOf(bag, 'it_iron'), 3);
  assert.throws(() => buy(SHOP, bag, wallet, 'it_spirit', 4), /铜钱不足/); // 需 800 > 700
  assert.throws(() => buy(SHOP, bag, wallet, 'nope', 1), /商店无此商品/);
  assert.equal(wallet.copper, 700); // 失败不扣款
});

test('精英：跨日惰性重置', () => {
  const daily: DailyState = { dateKey: '2026-09-04', elites: { e_e1: 3 } };
  rollDay(daily, '2026-09-04');
  assert.equal(clearsToday(daily, '2026-09-04', 'e_e1'), 3); // 同日保留
  rollDay(daily, '2026-09-05'); // 次日
  assert.equal(clearsToday(daily, '2026-09-05', 'e_e1'), 0); // 重置
  assert.equal(daily.dateKey, '2026-09-05');
});

test('精英：次数限制与记录', () => {
  const daily: DailyState = { dateKey: '', elites: {} };
  const e = findElite(ELITE, 'e_e1');
  assert.equal(remainingToday(daily, '2026-09-04', e), 3);
  recordChallenge(daily, '2026-09-04', e);
  recordChallenge(daily, '2026-09-04', e);
  recordChallenge(daily, '2026-09-04', e);
  assert.equal(remainingToday(daily, '2026-09-04', e), 0);
  assert.throws(() => recordChallenge(daily, '2026-09-04', e), /次数已用尽/);
});

test('精英掉落：同物品聚合发放', () => {
  const daily: DailyState = { dateKey: '', elites: {} };
  const e = findElite(ELITE, 'e_e1');
  recordChallenge(daily, '2026-09-04', e);
  assert.deepEqual(rewardsOf(REWARDS, 'e_e1'), [
    { itemId: 'it_iron', count: 3 },
    { itemId: 'it_spirit', count: 1 },
  ]);
  const bag: BagItem[] = [];
  grantRewards(bag, REWARDS, 'e_e1');
  assert.equal(countOf(bag, 'it_iron'), 3);
  assert.equal(countOf(bag, 'it_spirit'), 1);
});
