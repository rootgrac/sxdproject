import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFile } from '../../../client/assets/scripts/framework/save/save-core.ts';
import type { KeyValueStorage } from '../../../client/assets/scripts/framework/save/save-core.ts';
import { AUTO_SLOT, MANUAL_SLOTS, SlotManager } from '../../../client/assets/scripts/framework/save/slot-manager.ts';

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

function mk(): { kv: MemoryKV; mgr: SlotManager } {
  const kv = new MemoryKV();
  return { kv, mgr: new SlotManager(kv) };
}

test('槽位总览：初始全空，创建后状态正确', () => {
  const { mgr } = mk();
  const all = mgr.list();
  assert.deepEqual(
    all.map((i) => i.slot),
    [...MANUAL_SLOTS, AUTO_SLOT],
  );
  for (const i of all) assert.equal(i.state, 'empty');
  mgr.create('slot1', '青玄');
  const s1 = mgr.list().find((i) => i.slot === 'slot1');
  assert.ok(s1);
  assert.equal(s1.state, 'ok');
  assert.equal(s1.name, '青玄');
});

test('create 防覆盖与 remove', () => {
  const { mgr } = mk();
  mgr.create('slot1', '甲');
  assert.throws(() => mgr.create('slot1', '乙'), /禁止直接覆盖/);
  mgr.remove('slot1');
  assert.equal(mgr.list().find((i) => i.slot === 'slot1')?.state, 'empty');
  mgr.create('slot1', '乙');
  assert.equal(mgr.read('slot1')?.data.player.name, '乙');
});

test('copy/copyOverwrite/autosave 与备份链', () => {
  const { kv, mgr } = mk();
  mgr.create('slot1', 'A');
  mgr.autosave('slot1'); // auto 快照 A
  mgr.create('slot2', 'B');
  mgr.autosave('slot2'); // auto 覆盖 → A 轮换进备份链
  assert.equal(mgr.read(AUTO_SLOT)?.data.player.name, 'B');
  assert.throws(() => mgr.copy('slot1', 'slot2'), /需要确认覆盖/);
  mgr.copyOverwrite('slot1', 'slot2');
  assert.equal(mgr.read('slot2')?.data.player.name, 'A');
  // 自动档主键损坏 → 回退最近备份 A
  kv.set('auto.json', '{broken');
  const r = mgr.read(AUTO_SLOT);
  assert.ok(r);
  assert.equal(r.recovered, true);
  assert.equal(r.data.player.name, 'A');
});

test('too-new 槽位拒绝复制覆盖', () => {
  const { kv, mgr } = mk();
  mgr.create('slot1', '甲');
  const future = { saveVersion: 999 };
  kv.set('slot3.json', encodeFile(future));
  assert.throws(() => mgr.copy('slot1', 'slot3'), /too-new/);
  assert.throws(() => mgr.copyOverwrite('slot1', 'slot3'), /too-new/);
});
