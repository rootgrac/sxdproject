import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveData, KvSaveStore } from '../../../client/assets/scripts/framework/save/save-core.ts';
import type { KeyValueStorage } from '../../../client/assets/scripts/framework/save/save-core.ts';
import { SaveManager } from '../../../client/assets/scripts/framework/save/save-manager.ts';

/** 计数 KV：统计主键 set 次数（每次 write 恰好写一次主键，rotate 的备份写入不计） */
class CountingKV implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  mainWrites = 0;

  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
    if (key === 'slot1.json') this.mainWrites++;
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  keys(): readonly string[] {
    return [...this.map.keys()];
  }
}

function mk(): { kv: CountingKV; store: KvSaveStore; manager: SaveManager; clock: { t: number } } {
  const kv = new CountingKV();
  const store = new KvSaveStore(kv, 'slot1');
  const clock = { t: 1_000_000 };
  const manager = new SaveManager({ store, now: () => clock.t });
  return { kv, store, manager, clock };
}

test('脏数据未满 30 秒不写盘，满 30 秒批量写一次', () => {
  const { manager, clock } = mk();
  manager.create('甲');
  const base = manager.getData() as ReturnType<typeof createSaveData>;
  assert.equal(base.player.copper, 0);

  base.player.copper = 100; // 业务修改
  manager.markDirty();
  assert.equal(manager.isDirty(), true);

  clock.t += 10_000;
  assert.equal(manager.tick(), false); // 未满 30s：不写

  clock.t += 25_000; // 距上次写盘 35s
  assert.equal(manager.tick(), true); // 批量写盘
  assert.equal(manager.isDirty(), false);
});

test('多次修改合并为一次写盘（脏标记合并）', () => {
  const { kv, manager, clock } = mk();
  manager.create('甲');
  const writesAtStart = kv.mainWrites;
  const d = manager.getData() as ReturnType<typeof createSaveData>;

  d.player.copper = 100;
  manager.markDirty();
  d.player.level = 5;
  manager.markDirty();
  d.player.exp = 1234;
  manager.markDirty();
  clock.t += 31_000;
  assert.equal(manager.tick(), true);
  assert.equal(kv.mainWrites, writesAtStart + 1); // 三处修改仅一次写盘
});

test('flushNow：关键节点立即写盘并更新 lastSavedAt', () => {
  const { manager, clock } = mk();
  manager.create('乙');
  const d = manager.getData() as ReturnType<typeof createSaveData>;
  d.player.gold = 66;
  manager.markDirty();
  clock.t += 60_000;
  assert.equal(manager.flushNow(), true); // 不等节拍，立即写
  assert.equal(manager.isDirty(), false);

  // 写盘内容可读回且 lastSavedAt 已更新
  manager.load();
  assert.equal(manager.getData()?.player.gold, 66);
  assert.equal(manager.getData()?.meta.lastSavedAt, clock.t);
});

test('无修改时 tick / flushNow 均不产生写盘', () => {
  const { kv, manager, clock } = mk();
  manager.create('丙');
  const base = kv.mainWrites;
  clock.t += 100_000;
  assert.equal(manager.tick(), false);
  assert.equal(manager.flushNow(), false);
  assert.equal(kv.mainWrites, base);
});

test('load 复用已有档：迁移/恢复语义透传，读后未修改不写盘', () => {
  const { kv, manager, clock } = mk();
  const fresh = new KvSaveStore(kv, 'slot1');
  fresh.write(createSaveData('存量档'));
  clock.t += 5_000;
  manager.load();
  assert.equal(manager.getData()?.player.name, '存量档');
  assert.equal(manager.isDirty(), false);
  const base = kv.mainWrites;
  clock.t += 100_000;
  assert.equal(manager.tick(), false); // 未修改不写
  assert.equal(kv.mainWrites, base);
});
