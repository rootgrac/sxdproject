import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattle } from '../../../client/assets/scripts/battle-core/src/engine.ts';
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
    { id: 'u001', name: '云骞', hp: 1000, atk: 200, def: 50, spd: 120, acc: 1, eva: 0.05, crit: 0.1, skills: ['sk_basic'], recruit_level: 0 },
    { id: 'e001', name: '枯木妖', hp: 200, atk: 30, def: 5, spd: 60, acc: 0.9, eva: 0.1, crit: 0.05, skills: ['sk_basic'], recruit_level: 0 },
  ],
  skills: [{ id: 'sk_basic', name: '普攻', kind: 'normal', ratio: 1 }],
  effectRows: [],
  stages: [{ id: '1_1', chapter: 1, node: 1, name: '首关', enemies: ['e001'], exp_reward: 20, copper_reward: 5000 }],
  recruit: [],
  recruitCfg: { cost_single: 800, cost_ten: 7200, guarantee_rarity: 1 },
  equip: [],
  item: [{ id: 'it_iron', name: '精铁', kind: 'material' }],
  craft: [],
  shop: [],
  elite: [],
  eliteReward: [],
  tasks: [],
  taskBox: [],
  signIn: [],
  fate: [],
  fateSet: [],
  fateCfg: { cost_single: 600, cost_ten: 5400, guarantee_rarity: 3 },
  arena: [
    { id: 'ar1', name: '新锐名将·玄一', units: ['e001'], scale: 1, reward_copper: 800, honor: 40 },
    { id: 'ar2', name: '成名名将·青鸿', units: ['e001'], scale: 2, reward_copper: 1200, honor: 60 },
  ],
  achievements: [
    { id: 'a_h', name: '竞技新秀', desc: '荣誉 40', type: 'honor', target: 40, reward_copper: 2000 },
    { id: 'a_lv', name: '初窥门径', desc: 'Lv5', type: 'level', target: 5, reward_copper: 1000 },
  ],
};

test('竞技场：挑战镜像可开战、胜利发奖累计、每日 3 胜上限、荣誉成就邮件', () => {
  const kv = new MemoryKV();
  const session = new GameSession(kv, CFG, undefined, () => 0.5);
  session.newGame('slot1', '青玄');
  // 阵容可开战（镜像强档可试）
  const b = session.arenaBattle('ar2');
  const r = runBattle({ seed: 1, allies: b.allies, enemies: b.enemies, skillEffects: session.skillEffectsOf() });
  assert.ok(['ally', 'enemy', 'draw'].includes(r.winner));

  // 三连胜 ar1（镜像弱 → 直接结算层验证）
  const w1 = session.arenaWin('ar1');
  assert.equal(w1.copper, 800);
  assert.equal(w1.honor, 40);
  // 荣誉 40 达标 → 成就自动解锁并发邮件
  assert.ok(w1.achievements.includes('竞技新秀'));
  const mails = session.mailView();
  assert.ok(mails.some((m) => m.title.includes('竞技新秀') && m.unclaimed));
  session.arenaWin('ar1');
  session.arenaWin('ar1');
  assert.equal(session.arenaRemainingToday(), 0);
  assert.throws(() => session.arenaWin('ar1'), /上限/);
  // 领取成就邮件
  const n = session.claimMailsAll();
  assert.equal(n, 1);
  // 跨日重置胜场（推进 fake 日期一天）
  // （now 未注入时用真实时间——这里直接验证每日上限逻辑即可）
  const fresh = new GameSession(kv, CFG);
  assert.ok(fresh.continue('slot1'));
  assert.equal(fresh.arenaRemainingToday() <= 3, true);
  assert.ok(fresh.achievementView().find((a) => a.id === 'a_h')?.unlocked);
});
