import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecruitHall } from '../../../client/assets/scripts/modules/partner/recruit-core.ts';
import type { RecruitCfgRow, RecruitContext, RecruitEntryRow } from '../../../client/assets/scripts/modules/partner/recruit-core.ts';

const CFG: RecruitCfgRow = { cost_single: 800, cost_ten: 7200, guarantee_rarity: 2 };

// 小池：u101/u102 灵品(门槛1)，u103 玄品(门槛15) —— 用于门槛/单抽/扣费用例
const POOL: RecruitEntryRow[] = [
  { unit: 'u101', weight: 50, rarity: 1 },
  { unit: 'u102', weight: 40, rarity: 1 },
  { unit: 'u103', weight: 10, rarity: 2 },
];
const LEVEL_OF = new Map<string, number>([
  ['u101', 1],
  ['u102', 1],
  ['u103', 15],
]);

// 大池：12 灵品 + 2 玄品（>十连 10 抽，用于保底用例）
const BIG_POOL: RecruitEntryRow[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ unit: `g${i + 1}`, weight: 20, rarity: 1 })),
  { unit: 'x1', weight: 5, rarity: 2 },
  { unit: 'x2', weight: 5, rarity: 2 },
];
const BIG_LEVELS = new Map<string, number>(BIG_POOL.map((e) => [e.unit, 1]));

function ctx(over: Partial<RecruitContext>): RecruitContext {
  return {
    copper: 100_000,
    playerLevel: 1,
    ownedUnitIds: new Set<string>(),
    rand: () => 0.001, // 恒低滚 → 最低稀有档（灵品）
    ...over,
  };
}

test('单抽：命中低稀有并按权重随机到具体伙伴；扣费正确', () => {
  const c = ctx({});
  const r = new RecruitHall(CFG, POOL, LEVEL_OF).recruit(c, 'single');
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].rarity, 1);
  assert.equal(r.cost, 800);
  assert.equal(c.copper, 100_000 - 800);
});

test('铜钱不足拒绝', () => {
  const c = ctx({ copper: 799 });
  assert.throws(() => new RecruitHall(CFG, POOL, LEVEL_OF).recruit(c, 'single'), /铜钱不足/);
});

test('等级门槛：15 级前玄品不可抽；灵品集齐后被门槛挡住则池空', () => {
  const hall = new RecruitHall(CFG, POOL, LEVEL_OF);
  // 灵品全拥有但等级 14 → u103 门槛 15 挡住 → 池空
  const c = ctx({ playerLevel: 14, ownedUnitIds: new Set(['u101', 'u102']) });
  assert.throws(() => hall.recruit(c, 'single'), /暂无可用招募/);
  // 15 级后可抽玄品
  const c2 = ctx({ playerLevel: 15, ownedUnitIds: new Set(['u101', 'u102']) });
  const r = hall.recruit(c2, 'single');
  assert.equal(r.results[0].unit, 'u103');
  assert.equal(r.results[0].rarity, 2);
});

test('十连保底：前 9 抽低稀有，第 10 抽强制最高稀有（玄品）；结果一次操作内不重复', () => {
  const c = ctx({});
  const r = new RecruitHall(CFG, BIG_POOL, BIG_LEVELS).recruit(c, 'ten');
  assert.equal(r.results.length, 10);
  assert.equal(c.copper, 100_000 - 7200);
  const first9 = r.results.slice(0, 9);
  for (const x of first9) assert.equal(x.rarity, 1, '前 9 抽应为灵品');
  assert.equal(r.results[9].rarity, 2, '第 10 抽保底玄品');
  assert.equal(r.guaranteedHit, true);
  assert.equal(new Set(r.results.map((x) => x.unit)).size, 10);
});

test('已拥有排除：灵品集齐后单抽必中玄品；全拥有报池空', () => {
  const hall = new RecruitHall(CFG, BIG_POOL, BIG_LEVELS);
  const ownedAllCommon = new Set(BIG_POOL.filter((e) => e.rarity === 1).map((e) => e.unit));
  const c1 = ctx({ playerLevel: 1, ownedUnitIds: ownedAllCommon });
  const r1 = hall.recruit(c1, 'single');
  assert.equal(r1.results[0].rarity, 2);
  // 全拥有 → 池空
  const c2 = ctx({ ownedUnitIds: new Set(BIG_POOL.map((e) => e.unit)) });
  assert.throws(() => hall.recruit(c2, 'single'), /暂无可用招募/);
});

test('十连保底降级：最高稀有全拥有时保底给次高稀有（灵品）', () => {
  const ownedRare = new Set(['x1', 'x2']);
  const c = ctx({ ownedUnitIds: ownedRare });
  const r = new RecruitHall(CFG, BIG_POOL, BIG_LEVELS).recruit(c, 'ten');
  assert.equal(r.results[9].rarity, 1, '玄品已集齐 → 保底降级灵品');
  assert.equal(new Set(r.results.map((x) => x.unit)).size, 10);
});

test('十连可用不足校验：可用伙伴 <10 时拒绝十连', () => {
  // 小池（3 位）即使拥有者少也不足 10 位
  const c = ctx({});
  const hall = new RecruitHall(CFG, POOL, LEVEL_OF);
  assert.throws(() => hall.recruit(c, 'ten'), /不足十位/);
});
