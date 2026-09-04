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
    { id: 'u001', name: '云骞', hp: 1000, atk: 100, def: 50, spd: 100, acc: 1, eva: 0.05, crit: 0.1, skills: ['sk_basic'], recruit_level: 0 },
    { id: 'e001', name: '枯木妖', hp: 300, atk: 50, def: 10, spd: 60, acc: 0.9, eva: 0.1, crit: 0.05, skills: ['sk_basic'], recruit_level: 0 },
  ],
  skills: [{ id: 'sk_basic', name: '普攻', kind: 'normal', ratio: 1 }],
  effectRows: [],
  stages: [
    { id: '1_1', chapter: 1, node: 1, name: '首关', enemies: ['e001'], exp_reward: 20, copper_reward: 6000 },
    { id: '1_2', chapter: 1, node: 2, name: '次关', enemies: ['e001'], exp_reward: 20, copper_reward: 500 },
  ],
  recruit: [],
  recruitCfg: { cost_single: 800, cost_ten: 7200, guarantee_rarity: 1 },
  equip: [],
  item: [],
  craft: [],
  shop: [],
  elite: [],
  eliteReward: [],
  tasks: [],
  taskBox: [],
  signIn: [],
  fate: [
    { id: 'f1', name: '微光·破军', stat: 'atk', value: 25, set_id: 0, weight: 50, rarity: 1 },
    { id: 'f3', name: '流辉·北辰一', stat: 'atk', value: 35, set_id: 1, weight: 30, rarity: 2 },
    { id: 'f4', name: '流辉·北辰二', stat: 'def', value: 25, set_id: 1, weight: 20, rarity: 2 },
  ],
  fateSet: [{ id: 's1', set_id: 1, need: 2, stat: 'atk', value: 30 }],
  fateCfg: { cost_single: 600, cost_ten: 5400, guarantee_rarity: 2 },
};

test('观星：扣费、新命格自动装配、重复精进 +1、加成入战斗并持久化', () => {
  const kv = new MemoryKV();
  const session = new GameSession(kv, CFG, undefined, () => 0.001); // 恒低滚 → 稀有 1（破军）
  session.newGame('slot1', '青玄');
  session.onBattleWin(); // 启动资金
  const r1 = session.observeFate('single');
  assert.equal(r1.cost, 600);
  assert.equal(r1.events[0].kind, 'new');
  assert.equal(r1.events[0].name, '微光·破军');
  const view1 = session.fateView();
  assert.equal(view1.equipped.length, 1);
  // 重复抽取 → 精进 +1
  const r2 = session.observeFate('single');
  assert.equal(r2.events[0].kind, 'evolve');
  assert.equal(r2.events[0].level, 2);
  assert.equal(session.fateView().equipped[0].level, 2);
  // 战斗加成：主角 atk = 100 + 25×2
  const battle = session.buildBattle();
  assert.ok(battle);
  const hero = battle.allies.find((u) => u.id === 'u001');
  assert.equal(hero?.stats.atk, 150);
  // 持久化
  const fresh = new GameSession(kv, CFG);
  assert.ok(fresh.continue('slot1'));
  assert.equal(fresh.fateView().equipped[0].level, 2);
});
