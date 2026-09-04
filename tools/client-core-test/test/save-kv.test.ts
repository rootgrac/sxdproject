import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSaveData,
  CURRENT_SAVE_VERSION,
  decodeFile,
  encodeFile,
  KvSaveStore,
} from '../../../client/assets/scripts/framework/save/save-core.ts';
import type { KeyValueStorage } from '../../../client/assets/scripts/framework/save/save-core.ts';

/** 内存 KV（模拟 localStorage 语义），用于 Cocos 外单测 */
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

  raw(key: string): string | null {
    return this.get(key);
  }
}

function mk(): { kv: MemoryKV; store: KvSaveStore } {
  const kv = new MemoryKV();
  return { kv, store: new KvSaveStore(kv, 'slot1') };
}

test('往返：写入后读取一致，无残留临时键', () => {
  const { kv, store } = mk();
  assert.equal(store.exists(), false);
  store.write(createSaveData('青玄'));
  assert.equal(store.exists(), true);
  const r = store.read();
  assert.ok(r);
  assert.equal(r.migrated, false);
  assert.equal(r.recovered, false);
  assert.equal(r.data.player.name, '青玄');
  assert.equal(r.data.saveVersion, CURRENT_SAVE_VERSION);
  assert.ok(!kv.keys().includes('slot1.json.tmp')); // 原子写入无残留

  const d2 = createSaveData('云瑶');
  d2.player.level = 12;
  store.write(d2);
  assert.equal(store.read()?.data.player.level, 12);
});

test('备份轮换：保留最近 2 份，最旧被淘汰', () => {
  const { kv, store } = mk();
  for (const n of ['A', 'B', 'C', 'D']) store.write(createSaveData(n));
  const nameOf = (key: string): string => decodeFile(kv.raw(key) as string).data.player.name;
  assert.equal(store.read()?.data.player.name, 'D');
  assert.equal(nameOf('slot1.backup-1.json'), 'C');
  assert.equal(nameOf('slot1.backup-2.json'), 'B');
  assert.ok(!kv.keys().includes('slot1.backup-3.json'));
});

test('主档损坏（非法 JSON）自动回退最近备份并修复主键', () => {
  const { kv, store } = mk();
  store.write(createSaveData('A'));
  store.write(createSaveData('B'));
  kv.set('slot1.json', '{broken');
  const r = store.read();
  assert.ok(r);
  assert.equal(r.recovered, true);
  assert.equal(r.data.player.name, 'A');
  const r2 = store.read();
  assert.ok(r2 && r2.recovered === false); // 主键已修复
  assert.equal(r2.data.player.name, 'A');
});

test('内容被篡改（SHA-256 不匹配）视为损坏并回退', () => {
  const { kv, store } = mk();
  store.write(createSaveData('A'));
  store.write(createSaveData('B'));
  const tampered = (kv.raw('slot1.json') as string).replace('"level":1', '"level":99');
  kv.set('slot1.json', tampered);
  const r = store.read();
  assert.ok(r);
  assert.equal(r.recovered, true);
  assert.equal(r.data.player.name, 'A');
  assert.equal(r.data.player.level, 1);
});

test('create 保护：占用槽位或更高版本档拒绝覆盖', () => {
  const { kv, store } = mk();
  store.create('甲');
  assert.throws(() => store.create('乙'), /禁止直接覆盖/);
  const future = { ...createSaveData('未来'), saveVersion: 999 };
  kv.set('slot1.json', encodeFile(future));
  assert.throws(() => store.create('丙'), /禁止直接覆盖/);
  assert.equal(store.read(), null); // too-new：等待升级版本
  assert.ok(kv.raw('slot1.json') !== null); // 原档保留
  store.remove();
  assert.equal(store.exists(), false);
  store.create('丁');
  assert.equal(store.read()?.data.player.name, '丁');
});

test('版本迁移：v1 → 当前版本链式升级（mailbox + party + daily）', () => {
  const { kv, store } = mk();
  const v1 = {
    saveVersion: 1,
    meta: { createdAt: 1756944000000, playtimeSec: 3600, lastSavedAt: 1756947600000 },
    player: { name: '青玄', level: 12, exp: 3450, realm: 1, copper: 8888, gold: 66, stamina: 74, staminaTs: 1756944000000 },
    partners: [],
    equips: [],
    bag: [{ id: 'potion_s', count: 5 }],
    progress: { chapter: 2, node: 5, towerBest: 0 },
    achievements: { unlocked: [], claimed: [] },
    // 无 mailbox、无 party —— v1 特征
  };
  kv.set('slot1.json', encodeFile(v1));
  const r = store.read();
  assert.ok(r);
  assert.equal(r.migrated, true);
  assert.equal(r.data.saveVersion, CURRENT_SAVE_VERSION);
  assert.deepEqual(r.data.mailbox, []);
  assert.deepEqual(r.data.party.partnerSlots, [null, null]); // v3 party 就位
  assert.equal(r.data.player.level, 12); // 旧数据完整保留
  assert.deepEqual(r.data.party.partnerSlots, [null, null]);
  assert.deepEqual(r.data.daily, { dateKey: '', elites: {} }); // v4 daily 就位
  const snap = decodeFile(kv.raw('slot1.backup_v1.json') as string).data;
  assert.equal(snap.saveVersion, 1); // 迁移前原始档已另存
});

test('版本迁移：v2（无 party）→ 当前版本补 party 槽位', () => {
  const { kv, store } = mk();
  const v2 = { ...createSaveData('旧档'), saveVersion: 2 } as unknown as Record<string, unknown>;
  delete (v2 as { party?: unknown }).party;
  kv.set('slot1.json', encodeFile(v2 as never));
  const r = store.read();
  assert.ok(r);
  assert.equal(r.data.saveVersion, CURRENT_SAVE_VERSION);
  assert.deepEqual(r.data.party.partnerSlots, [null, null]);
  assert.deepEqual(r.data.daily, { dateKey: '', elites: {} });
});

test('版本迁移：v3（无 daily）→ v4 补每日状态', () => {
  const { kv, store } = mk();
  const v3 = { ...createSaveData('旧档'), saveVersion: 3 } as unknown as Record<string, unknown>;
  delete (v3 as { daily?: unknown }).daily;
  kv.set('slot1.json', encodeFile(v3 as never));
  const r = store.read();
  assert.ok(r);
  assert.equal(r.data.saveVersion, CURRENT_SAVE_VERSION);
  assert.deepEqual(r.data.daily, { dateKey: '', elites: {} });
});

test('summary 状态：ok / recoverable / empty / corrupt', () => {
  const { kv, store } = mk();
  assert.equal(store.summary().state, 'empty');
  store.write(createSaveData('A'));
  store.write(createSaveData('B'));
  assert.equal(store.summary().state, 'ok');
  kv.set('slot1.json', '!@#');
  assert.equal(store.summary().state, 'recoverable'); // 只读检查：不修复
  store.read(); // 读取时修复
  assert.equal(store.summary().state, 'ok');
});
