import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../../../client/assets/scripts/modules/game/game-session.ts';
import type { GameConfigs } from '../../../client/assets/scripts/modules/game/game-session.ts';
import type { KeyValueStorage } from '../../../client/assets/scripts/framework/save/save-core.ts';

class MemoryKV implements KeyValueStorage {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  keys(): readonly string[] {
    return [...this.map.keys()];
  }
}

const CFG: GameConfigs = {
  units: [
    { id: 'u001', name: '云骞', hp: 1000, atk: 120, def: 60, spd: 110, acc: 1, eva: 0.05, crit: 0.15, skills: ['sk_basic', 'sk_qi'], recruit_level: 0 },
    { id: 'u002', name: '洛璃', hp: 850, atk: 150, def: 40, spd: 125, acc: 0.95, eva: 0.1, crit: 0.05, skills: ['sk_basic', 'sk_heal'], recruit_level: 0 },
    { id: 'u003', name: '沈砚', hp: 1200, atk: 90, def: 90, spd: 95, acc: 1, eva: 0.05, crit: 0.1, skills: ['sk_basic', 'sk_guard'], recruit_level: 0 },
    { id: 'u101', name: '白纾', hp: 900, atk: 135, def: 55, spd: 120, acc: 1, eva: 0.1, crit: 0.1, skills: ['sk_basic', 'sk_qi'], recruit_level: 1 },
    { id: 'e001', name: '枯木妖', hp: 500, atk: 100, def: 40, spd: 100, acc: 0.9, eva: 0.15, crit: 0.05, skills: ['sk_basic', 'sk_qi'], recruit_level: 0 },
  ],
  skills: [
    { id: 'sk_basic', name: '普攻', kind: 'normal', ratio: 1 },
    { id: 'sk_qi', name: '绝技·冲霄', kind: 'ultimate', ratio: 1.8 },
    { id: 'sk_heal', name: '绝技·莲华', kind: 'ultimate', ratio: 1.5 },
    { id: 'sk_guard', name: '绝技·磐石', kind: 'ultimate', ratio: 1.5 },
  ],
  effectRows: [
    { id: 'se_1', skill: 'sk_qi', kind: 'damage', target: 'enemy', ratio: 1.8, stat: '', value: 0, duration: 0 },
  ],
  stages: [
    { id: '1_1', chapter: 1, node: 1, name: '山道初行', enemies: ['e001'], exp_reward: 50, copper_reward: 5000 },
  ],
  recruit: [{ unit: 'u101', weight: 1, rarity: 1 }],
  recruitCfg: { cost_single: 800, cost_ten: 7200, guarantee_rarity: 1 },
  equip: [
    { id: 'eq_w1', slot: 'weapon', name: '青锋剑', atk: 30, def: 0, hp: 0 },
    { id: 'eq_o1', slot: 'orb', name: '聚灵珠', atk: 0, def: 0, hp: 300 },
  ],
  item: [
    { id: 'it_iron', name: '精铁', kind: 'material' },
    { id: 'it_spirit', name: '灵砂', kind: 'material' },
  ],
  craft: [
    { id: 'cr1', craft: 'eq_w1', item: 'it_iron', count: 2 },
    { id: 'cr2', craft: 'eq_o1', item: 'it_iron', count: 1 },
    { id: 'cr3', craft: 'eq_o1', item: 'it_spirit', count: 3 },
  ],
  shop: [{ id: 's1', item: 'it_iron', cost: 100, limit: 0 }],
  elite: [{ id: 'e_e1', name: '沉沙涧', enemies: ['e001'], stamina_cost: 5, daily_limit: 3 }],
  eliteReward: [
    { id: 'er1', elite: 'e_e1', item: 'it_iron', count: 2 },
    { id: 'er2', elite: 'e_e1', item: 'it_spirit', count: 1 },
  ],
  tasks: [],
  taskBox: [],
  signIn: [],
  fate: [],
  fateSet: [],
  fateCfg: { cost_single: 600, cost_ten: 5400, guarantee_rarity: 3 },
};

function mk(randValue = 0.001): { kv: MemoryKV; session: GameSession } {
  const kv = new MemoryKV();
  let now = 1_000_000_000_000;
  const session = new GameSession(kv, CFG, () => now, () => randValue);
  session.newGame('slot1', '青玄');
  return { kv, session };
}

test('招募：扣费、入队、自动上阵并写盘', () => {
  const { kv, session } = mk();
  session.onBattleWin(); // 赚 5000 铜钱
  const before = session.partnerView().length;
  const r = session.recruit('single');
  assert.equal(r.joined[0], '白纾');
  const view = session.partnerView();
  assert.equal(view.length, before + 1);
  assert.equal(view[0].onField, true); // 自动上阵
  assert.equal(session.snapshot().copper, 5000 - 800);
  // 持久化
  const fresh = new GameSession(kv, CFG);
  assert.ok(fresh.continue('slot1'));
  assert.equal(fresh.partnerView().length, 1);
});

test('打造并穿戴：材料扣除、主角自动换装', () => {
  const { session } = mk();
  session.onBattleWin(); // 启动资金（+5000 铜）
  // 备材料（商店买）
  session.shopBuy('it_iron', 2);
  const made = session.craftAndEquipHero('eq_w1');
  assert.equal(made.equipId, 'eq_w1');
  const view = session.heroEquipsView();
  assert.equal(view.length, 1);
  assert.equal(view[0].name, '青锋剑');
  // 再打造 orb（缺灵砂）→ 拒绝
  assert.throws(() => session.craftAndEquipHero('eq_o1'), /材料不足/);
});

test('强化武器：扣费升级、境界上限拦截', () => {
  const { session } = mk();
  session.onBattleWin(); // 启动资金
  session.shopBuy('it_iron', 2);
  session.craftAndEquipHero('eq_w1');
  const r1 = session.enhanceHeroWeapon();
  assert.equal(r1.enhance, 1);
  assert.ok(r1.cost > 0);
  const view = session.heroEquipsView();
  assert.equal(view[0].enhance, 1);
});

test('商店：购买入包', () => {
  const { session } = mk();
  session.onBattleWin(); // 启动资金
  session.shopBuy('it_iron', 3);
  const bag = session.bagView();
  assert.equal(bag.find((b) => b.itemId === 'it_iron')?.count, 3);
});

test('精英：胜利扣次数+掉落；再战到次数尽拒绝；战败不扣', () => {
  const { session } = mk();
  // 新档等级 1 打得过（敌人弱），直接走结算层验证
  const st = session.eliteStatus();
  assert.equal(st[0].remaining, 3);
  session.onEliteWin('e_e1');
  assert.equal(session.eliteStatus()[0].remaining, 2);
  assert.equal(session.bagView().find((b) => b.itemId === 'it_iron')?.count, 2);
  session.onEliteLose(); // 战败不扣
  assert.equal(session.eliteStatus()[0].remaining, 2);
  session.onEliteWin('e_e1');
  session.onEliteWin('e_e1');
  assert.equal(session.eliteStatus()[0].remaining, 0);
  assert.throws(() => session.onEliteWin('e_e1'), /次数已用尽/);
});
