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
    { id: 'u001', name: '云骞', hp: 1000, atk: 150, def: 60, spd: 110, acc: 1, eva: 0.05, crit: 0.15, skills: ['sk_basic', 'sk_qi'] },
    { id: 'u002', name: '洛璃', hp: 850, atk: 160, def: 40, spd: 125, acc: 0.95, eva: 0.1, crit: 0.05, skills: ['sk_basic', 'sk_heal'] },
    { id: 'u003', name: '沈砚', hp: 1200, atk: 120, def: 90, spd: 95, acc: 1, eva: 0.05, crit: 0.1, skills: ['sk_basic', 'sk_guard'] },
    { id: 'e001', name: '枯木妖', hp: 600, atk: 100, def: 40, spd: 100, acc: 0.9, eva: 0.15, crit: 0.05, skills: ['sk_basic', 'sk_qi'] },
    { id: 'e002', name: '黑风妖', hp: 700, atk: 95, def: 50, spd: 90, acc: 0.95, eva: 0.1, crit: 0.05, skills: ['sk_basic', 'sk_qi'] },
  ],
  skills: [
    { id: 'sk_basic', name: '普攻', kind: 'normal', ratio: 1 },
    { id: 'sk_qi', name: '绝技·冲霄', kind: 'ultimate', ratio: 1.8 },
    { id: 'sk_heal', name: '绝技·莲华', kind: 'ultimate', ratio: 1.5 },
    { id: 'sk_guard', name: '绝技·磐石', kind: 'ultimate', ratio: 1.5 },
  ],
  effectRows: [
    { id: 'se_1', skill: 'sk_qi', kind: 'damage', target: 'enemy', ratio: 1.8, stat: '', value: 0, duration: 0 },
    { id: 'se_2', skill: 'sk_guard', kind: 'buff', target: 'self', ratio: 0, stat: 'def', value: 0.5, duration: 3 },
    { id: 'se_3', skill: 'sk_heal', kind: 'heal', target: 'self', ratio: 1.5, stat: '', value: 0, duration: 0 },
  ],
  recruit: [],
  recruitCfg: { cost_single: 800, cost_ten: 7200, guarantee_rarity: 2 },
  equip: [],
  item: [],
  craft: [],
  shop: [],
  elite: [],
  eliteReward: [],
  tasks: [],
  taskBox: [],
  signIn: [],
  stages: [
    { id: '1_1', chapter: 1, node: 1, name: '山道初行', enemies: ['e001'], exp_reward: 50, copper_reward: 100 },
    { id: '1_2', chapter: 1, node: 2, name: '雾林小径', enemies: ['e002'], exp_reward: 60, copper_reward: 120 },
    { id: '1_3', chapter: 1, node: 3, name: '断桥遗冢', enemies: ['e001', 'e002'], exp_reward: 300, copper_reward: 200 },
  ],
};

test('杀进程不丢档：胜利即 flushNow，新会话完整恢复（多关连推）', () => {
  const kv = new MemoryKV();
  const session = new GameSession(kv, CFG);
  session.newGame('slot1', '青玄');
  session.onBattleWin(); // 1_1
  session.onBattleWin(); // 1_2
  const mid = session.snapshot();
  // 「杀进程」：丢弃内存会话
  const fresh = new GameSession(kv, CFG);
  const restored = fresh.continue('slot1');
  assert.ok(restored);
  assert.equal(restored.copper, mid.copper); // 220
  assert.equal(restored.node, 3);
  // 继续打完第一章
  fresh.onBattleWin(); // 1_3
  assert.equal(fresh.snapshot().node, 0);
  // 再次「杀进程」
  const fresh2 = new GameSession(kv, CFG);
  const restored2 = fresh2.continue('slot1');
  assert.ok(restored2);
  assert.equal(restored2.node, 0); // 章节完成状态也持久化
  assert.equal(restored2.copper, 420); // 100+120+200
  assert.ok(restored2.level >= 3); // 经验累计升级
});
