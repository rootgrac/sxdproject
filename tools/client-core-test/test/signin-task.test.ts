import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prevDayKey, rewardOf, signIn, signedToday, signInStatusOf } from '../../../client/assets/scripts/modules/task/signin-core.ts';
import type { DailyTasks } from '../../../client/assets/scripts/modules/task/task-core.ts';
import type { SignInRow } from '../../../client/assets/scripts/modules/task/signin-core.ts';
import { GameSession } from '../../../client/assets/scripts/modules/game/game-session.ts';
import type { GameConfigs } from '../../../client/assets/scripts/modules/game/game-session.ts';
import type { KeyValueStorage } from '../../../client/assets/scripts/framework/save/save-core.ts';

const SIGN_ROWS: SignInRow[] = [
  { day: 1, copper: 500, item: 'it_iron' },
  { day: 7, copper: 5000, item: 'it_blueprint_o1' },
];

function mkDaily(dayKey: string): DailyTasks {
  return { dateKey: '', elites: {}, tasks: {}, claimedBoxes: [], signIn: { streak: 0, lastKey: dayKey } };
}

test('prevDayKey / 连续签到与断签重置 / 同天重复拒绝', () => {
  assert.equal(prevDayKey('2026-09-04'), '2026-09-03');
  assert.equal(prevDayKey('2026-03-01'), '2026-02-28');
  const d = mkDaily(''); // 从未签到
  const r1 = signIn(d, '2026-09-01');
  assert.equal(r1.streak, 1);
  assert.equal(r1.day, 1);
  const r2 = signIn(d, '2026-09-02'); // 连续
  assert.equal(r2.streak, 2);
  assert.equal(r2.day, 2);
  assert.throws(() => signIn(d, '2026-09-02'), /已签到/);
  // 断签（跳过 09-03）
  const d2 = mkDaily('2026-09-02');
  const d2b = mkDaily('2026-09-02');
  void d2;
  signIn(d2b, '2026-09-04'); // 昨天(09-03)未签 → 重置 1
  assert.equal(d2b.signIn.streak, 1);
});

test('七日循环：连续 7 天到第 7 天大奖日', () => {
  const d = mkDaily('');
  let day = 0;
  for (let i = 1; i <= 7; i++) {
    const key = `2026-01-0${i}`;
    day = signIn(d, key).day;
  }
  assert.equal(day, 7);
  // 第 8 天回到第 1 天模式（连续保持）
  const r8 = signIn(d, '2026-01-08');
  assert.equal(r8.day, 1);
  assert.equal(r8.streak, 8);
});

test('奖励表查询与状态', () => {
  assert.deepEqual(rewardOf(SIGN_ROWS, 7), { copper: 5000, item: 'it_blueprint_o1' });
  assert.deepEqual(rewardOf(SIGN_ROWS, 2), { copper: 0, item: '' }); // 表外默认空奖励
  const d = mkDaily('2026-09-04');
  assert.equal(signedToday(d, '2026-09-04'), true);
  // 昨天已签（streak=2）→ 明天应领第 3 天
  const d2: DailyTasks = { ...mkDaily('2026-09-04'), signIn: { streak: 2, lastKey: '2026-09-04' } };
  const st = signInStatusOf(d2, '2026-09-05');
  assert.equal(st.nextDay, 3);
});

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
    { id: 'e001', name: '枯木妖', hp: 400, atk: 80, def: 20, spd: 80, acc: 0.9, eva: 0.1, crit: 0.05, skills: ['sk_basic'], recruit_level: 0 },
  ],
  skills: [{ id: 'sk_basic', name: '普攻', kind: 'normal', ratio: 1 }],
  effectRows: [],
  stages: [
    { id: '1_1', chapter: 1, node: 1, name: '首关', enemies: ['e001'], exp_reward: 30, copper_reward: 500 },
    { id: '1_2', chapter: 1, node: 2, name: '次关', enemies: ['e001'], exp_reward: 30, copper_reward: 500 },
  ],
  recruit: [],
  recruitCfg: { cost_single: 800, cost_ten: 7200, guarantee_rarity: 1 },
  equip: [],
  item: [{ id: 'it_iron', name: '精铁', kind: 'material' }],
  craft: [],
  shop: [],
  elite: [],
  eliteReward: [],
  tasks: [
    { id: 't_stage', name: '通关主线关卡', type: 'stage_win', target: 2, active: 10 },
    { id: 't_recruit', name: '招募伙伴', type: 'recruit', target: 1, active: 10 },
  ],
  taskBox: [{ threshold: 10, copper: 500 }],
  signIn: [
    { day: 1, copper: 500, item: 'it_iron' },
    { day: 2, copper: 800, item: '' },
  ],
};

test('会话集成：通关/招募推进每日任务，签到发奖，宝箱领取', () => {
  const kv = new MemoryKV();
  let now = Date.UTC(2026, 8, 4, 2, 0, 0); // 2026-09-04（UTC 02:00 → 本地日期依赖时区，用注入 now 的本地转换——统一以本地为准）
  const session = new GameSession(kv, CFG, () => now, () => 0.001);
  session.newGame('slot1', '青玄');
  // 通关两次 → t_stage 完成
  session.onBattleWin();
  session.onBattleWin();
  const tasks = session.taskView();
  assert.equal(tasks[0].done, true);
  assert.equal(session.activeToday(), 10);
  // 签到（第 1 天 +500 铜 + 精铁）
  const si = session.signInNow();
  assert.equal(si.day, 1);
  assert.equal(si.copper, 500);
  assert.throws(() => session.signInNow(), /已签到/);
  // 活跃宝箱
  assert.equal(session.claimActiveBox(10), true);
  // 重复领拒绝
  assert.throws(() => session.claimActiveBox(10), /已领取/);
  // 持久化：新会话状态在
  const fresh = new GameSession(kv, CFG, () => now);
  assert.ok(fresh.continue('slot1'));
  assert.equal(fresh.signInStatus().signedToday, true);
  assert.equal(fresh.taskView()[0].done, true);
});
