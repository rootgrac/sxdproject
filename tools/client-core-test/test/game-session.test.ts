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

const UNIT_ROWS = [
  { id: 'u001', name: '云骞', hp: 1000, atk: 120, def: 60, spd: 110, acc: 1, eva: 0.05, crit: 0.15, skills: ['sk_basic', 'sk_qi'] },
  { id: 'u002', name: '洛璃', hp: 850, atk: 150, def: 40, spd: 125, acc: 0.95, eva: 0.1, crit: 0.05, skills: ['sk_basic', 'sk_heal'] },
  { id: 'u003', name: '沈砚', hp: 1200, atk: 90, def: 90, spd: 95, acc: 1, eva: 0.05, crit: 0.1, skills: ['sk_basic', 'sk_guard'] },
  { id: 'e001', name: '枯木妖', hp: 900, atk: 110, def: 50, spd: 100, acc: 0.9, eva: 0.15, crit: 0.05, skills: ['sk_basic', 'sk_qi'] },
];

const SKILL_ROWS = [
  { id: 'sk_basic', name: '普攻', kind: 'normal', ratio: 1 },
  { id: 'sk_qi', name: '绝技·冲霄', kind: 'ultimate', ratio: 1.8 },
  { id: 'sk_heal', name: '绝技·莲华', kind: 'ultimate', ratio: 1.5 },
  { id: 'sk_guard', name: '绝技·磐石', kind: 'ultimate', ratio: 1.5 },
];

const EFFECT_ROWS = [
  { id: 'se_1', skill: 'sk_qi', kind: 'damage', target: 'enemy', ratio: 1.8, stat: '', value: 0, duration: 0 },
  { id: 'se_2', skill: 'sk_guard', kind: 'buff', target: 'self', ratio: 0, stat: 'def', value: 0.5, duration: 3 },
  { id: 'se_3', skill: 'sk_heal', kind: 'heal', target: 'self', ratio: 1.5, stat: '', value: 0, duration: 0 },
];

const STAGE_ROWS = [
  { id: '1_1', chapter: 1, node: 1, name: '山道初行', enemies: ['e001'], exp_reward: 50, copper_reward: 100 },
  { id: '1_2', chapter: 1, node: 2, name: '雾林小径', enemies: ['e001'], exp_reward: 60, copper_reward: 120 },
  { id: '1_3', chapter: 1, node: 3, name: '断桥遗冢', enemies: ['e001'], exp_reward: 75, copper_reward: 150 },
];

const CFG: GameConfigs = {
  units: UNIT_ROWS,
  skills: SKILL_ROWS,
  effectRows: EFFECT_ROWS,
  stages: STAGE_ROWS,
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
  fate: [],
  fateSet: [],
  fateCfg: { cost_single: 600, cost_ten: 5400, guarantee_rarity: 3 },
};

function mk(): { kv: MemoryKV; session: GameSession } {
  const kv = new MemoryKV();
  return { kv, session: new GameSession(kv, CFG) };
}

test('newGame → snapshot → continue 往返一致', () => {
  const { kv } = mk();
  const session = new GameSession(kv, CFG);
  assert.equal(session.isInGame(), false);
  const snap = session.newGame('slot1', '青玄');
  assert.equal(snap.name, '青玄');
  assert.equal(snap.level, 1);
  assert.equal(snap.node, 1);
  assert.equal(session.currentStage()?.id, '1_1');
  // 重新会话（模拟重启）：continue 读档（同一存储）
  const s2 = new GameSession(kv, CFG);
  const snap2 = s2.continue('slot1');
  assert.ok(snap2);
  assert.equal(snap2.copper, 0);
  assert.equal(snap2.name, '青玄');
});

test('战斗构造：配置驱动 + 布阵（我方 3 人列 0..2）', () => {
  const { session } = mk();
  session.newGame('slot1', '青玄');
  const b = session.buildBattle();
  assert.ok(b);
  assert.equal(b.allies.length, 3);
  assert.deepEqual(b.allies.map((u) => u.position), [0, 1, 2]);
  assert.equal(b.enemies.length, 1);
  assert.equal(b.enemies[0].id, 'e001');
  // 整场战斗可跑通（确定性内核）
  const r = runBattle({ seed: 1, allies: b.allies, enemies: b.enemies, skillEffects: session.skillEffectsOf() });
  assert.ok(['ally', 'enemy', 'draw'].includes(r.winner));
});

test('通关：奖励入账 + 进度推进 + 立即落盘（关键节点 flushNow）', () => {
  const { kv, session } = mk();
  session.newGame('slot1', '青玄');
  session.onBattleWin(); // 通关 1_1
  const snap = session.snapshot();
  assert.equal(snap.copper, 100);
  assert.equal(snap.exp, 50);
  assert.equal(snap.node, 2);
  // 落盘验证：新会话继续在 1_2，铜钱保留
  const s2 = new GameSession(kv, CFG);
  const snap2 = s2.continue('slot1');
  assert.ok(snap2);
  assert.equal(snap2.node, 2);
  assert.equal(snap2.copper, 100);
});

test('战败无奖励；非目标关不可结算', () => {
  const { session } = mk();
  session.newGame('slot1', '青玄');
  session.onBattleLose();
  assert.equal(session.snapshot().copper, 0);
  assert.equal(session.snapshot().node, 1);
});

test('通关最后一关：章节完成（node=0），无当前关', () => {
  const { session } = mk();
  session.newGame('slot1', '青玄');
  session.onBattleWin(); // 1_1
  session.onBattleWin(); // 1_2
  session.onBattleWin(); // 1_3（最后一关）
  assert.equal(session.snapshot().node, 0);
  assert.equal(session.currentStage(), null);
  assert.throws(() => session.onBattleWin(), /无可结算关卡/);
});

test('三槽位独立（slot1 与 slot2 存档互不干扰）', () => {
  const { session } = mk();
  session.newGame('slot1', '青玄');
  session.onBattleWin();
  session.newGame('slot2', '云瑶');
  assert.equal(session.snapshot().name, '云瑶');
  assert.equal(session.snapshot().node, 1); // 新档从 1_1 开始
});
