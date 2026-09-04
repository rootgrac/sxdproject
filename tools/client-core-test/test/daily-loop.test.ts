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
    { id: 'u001', name: '云骞', hp: 2000, atk: 300, def: 100, spd: 150, acc: 1, eva: 0.05, crit: 0.1, skills: ['sk_basic', 'sk_qi'], recruit_level: 0 },
    { id: 'u101', name: '白纾', hp: 900, atk: 150, def: 50, spd: 120, acc: 1, eva: 0.1, crit: 0.1, skills: ['sk_basic'], recruit_level: 1 },
    { id: 'e001', name: '枯木妖', hp: 200, atk: 40, def: 10, spd: 60, acc: 0.9, eva: 0.1, crit: 0.05, skills: ['sk_basic'], recruit_level: 0 },
  ],
  skills: [
    { id: 'sk_basic', name: '普攻', kind: 'normal', ratio: 1 },
    { id: 'sk_qi', name: '绝技·冲霄', kind: 'ultimate', ratio: 1.8 },
  ],
  effectRows: [{ id: 'se_1', skill: 'sk_qi', kind: 'damage', target: 'enemy', ratio: 1.8, stat: '', value: 0, duration: 0 }],
  stages: [
    { id: '1_1', chapter: 1, node: 1, name: '一', enemies: ['e001'], exp_reward: 40, copper_reward: 1000 },
    { id: '1_2', chapter: 1, node: 2, name: '二', enemies: ['e001'], exp_reward: 40, copper_reward: 1000 },
    { id: '1_3', chapter: 1, node: 3, name: '三', enemies: ['e001'], exp_reward: 40, copper_reward: 1000 },
  ],
  recruit: [{ unit: 'u101', weight: 1, rarity: 1 }],
  recruitCfg: { cost_single: 800, cost_ten: 7200, guarantee_rarity: 1 },
  equip: [{ id: 'eq_w1', slot: 'weapon', name: '青锋剑', atk: 30, def: 0, hp: 0 }],
  item: [{ id: 'it_iron', name: '精铁', kind: 'material' }],
  craft: [{ id: 'cr1', craft: 'eq_w1', item: 'it_iron', count: 2 }],
  shop: [{ id: 's1', item: 'it_iron', cost: 100, limit: 0 }],
  elite: [{ id: 'e_e1', name: '沉沙涧', enemies: ['e001'], stamina_cost: 5, daily_limit: 3 }],
  eliteReward: [{ id: 'er1', elite: 'e_e1', item: 'it_iron', count: 3 }],
  tasks: [
    { id: 't_stage', name: '通关主线关卡', type: 'stage_win', target: 3, active: 10 },
    { id: 't_elite', name: '挑战精英副本', type: 'elite_win', target: 1, active: 10 },
    { id: 't_recruit', name: '招募伙伴', type: 'recruit', target: 1, active: 10 },
    { id: 't_enhance', name: '强化装备', type: 'enhance', target: 1, active: 10 },
    { id: 't_craft', name: '打造装备', type: 'craft', target: 1, active: 10 },
    { id: 't_shop', name: '商店购物', type: 'shop', target: 1, active: 10 },
  ],
  taskBox: [
    { threshold: 20, copper: 1000 },
    { threshold: 40, copper: 2500 },
    { threshold: 60, copper: 5000 },
  ],
  signIn: [{ day: 1, copper: 500, item: 'it_iron' }],
  fate: [],
  fateSet: [],
  fateCfg: { cost_single: 600, cost_ten: 5400, guarantee_rarity: 3 },
  arena: [{ id: 'ar1', name: '名将·玄一', units: ['e001'], scale: 1, reward_copper: 800, honor: 100 }],
  achievements: [{ id: 'a_h', name: '竞技新秀', desc: '荣誉 100', type: 'honor', target: 100, reward_copper: 2000 }],
};

test('30 分钟日常剧本：签到/推图/精英/招募/打造强化/商店 → 活跃 60 领三箱 + 竞技荣誉 + 成就邮件', () => {
  const kv = new MemoryKV();
  const session = new GameSession(kv, CFG, () => Date.UTC(2026, 8, 4, 4, 0, 0), () => 0.001);
  session.newGame('slot1', '青玄');
  const copper = (): number => session.snapshot().copper;

  const start = copper();
  // 1. 签到
  session.signInNow();
  // 2. 推图 3 关（任务 stage_win 3/3）
  session.onBattleWin();
  session.onBattleWin();
  session.onBattleWin();
  // 3. 精英 1 次（材料 + 任务）
  session.onEliteWin('e_e1');
  // 4. 招募 1 次（任务）
  session.recruit('single');
  // 5. 商店买材料 → 打造 → 强化（三个任务 + 装备闭环）
  session.shopBuy('it_iron', 2);
  session.craftAndEquipHero('eq_w1');
  session.enhanceHeroWeapon();
  // 6. 竞技 1 胜（荣誉 100 → 成就邮件）
  session.arenaWin('ar1');

  // 任务全完成 → 活跃 60
  const active = session.activeToday();
  assert.equal(active, 60);
  // 三档宝箱可领
  session.claimActiveBox(20);
  session.claimActiveBox(40);
  session.claimActiveBox(60);
  assert.throws(() => session.claimActiveBox(60), /已领取/);
  // 成就邮件：honor 100 达成
  const achMail = session.mailView().find((m) => m.title.includes('竞技新秀'));
  assert.ok(achMail && achMail.unclaimed);
  // 信箱领取（成就 2000 铜）
  const n = session.claimMailsAll();
  assert.equal(n, 1);
  // 收支预算：主线+3000 签到+500 宝箱+8500 成就+2000 竞技+800
  //          招募-800 商店-200 强化-100 → 净 +13700
  assert.equal(copper(), start + 13700);
  // 持久化重启后全部保留
  const fresh = new GameSession(kv, CFG);
  assert.ok(fresh.continue('slot1'));
  assert.equal(fresh.signInStatus().signedToday, true);
  assert.equal(fresh.activeToday(), 60);
  assert.ok(fresh.achievementView().find((a) => a.id === 'a_h')?.unlocked);
});
