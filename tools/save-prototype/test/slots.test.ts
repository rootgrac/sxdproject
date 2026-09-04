import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTO_SLOT, MANUAL_SLOTS, SlotManager } from '../src/slots.ts';
import { createSaveData, encodeFile, SaveStore } from '../src/core.ts';

function mkManager(): { mgr: SlotManager; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'sxd-slots-'));
  const mgr = new SlotManager(dir);
  return { mgr, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('槽位总览：初始全空，创建后状态正确', (t) => {
  const { mgr, cleanup } = mkManager();
  t.after(cleanup);
  const all = mgr.list();
  assert.deepEqual(
    all.map((i) => i.slot),
    [...MANUAL_SLOTS, AUTO_SLOT],
  );
  for (const i of all) assert.equal(i.state, 'empty');
  mgr.create('slot1', '青玄');
  const after = mgr.list();
  const s1 = after.find((i) => i.slot === 'slot1');
  assert.ok(s1);
  assert.equal(s1.state, 'ok');
  assert.equal(s1.name, '青玄');
  assert.equal(s1.level, 1);
  assert.ok(s1.lastSavedAt !== null);
});

test('复制保护：目标已占用需显式确认覆盖', (t) => {
  const { mgr, cleanup } = mkManager();
  t.after(cleanup);
  mgr.create('slot1', '甲');
  mgr.create('slot2', '乙');
  assert.throws(() => mgr.copy('slot1', 'slot2'), /需要确认覆盖/);
  mgr.copyOverwrite('slot1', 'slot2');
  assert.equal(mgr.read('slot2')?.data.player.name, '甲');
  assert.equal(mgr.read('slot1')?.data.player.name, '甲'); // 源不受影响
});

test('复制到空槽与自动档', (t) => {
  const { mgr, cleanup } = mkManager();
  t.after(cleanup);
  mgr.create('slot1', '丙');
  mgr.copy('slot1', 'slot3');
  assert.equal(mgr.read('slot3')?.data.player.name, '丙');
  mgr.autosave('slot3'); // 自动档强制覆盖语义
  assert.equal(mgr.read(AUTO_SLOT)?.data.player.name, '丙');
});

test('删除槽位后恢复为空', (t) => {
  const { mgr, cleanup } = mkManager();
  t.after(cleanup);
  mgr.create('slot2', '丁');
  mgr.remove('slot2');
  const s2 = mgr.list().find((i) => i.slot === 'slot2');
  assert.equal(s2?.state, 'empty');
  assert.equal(mgr.read('slot2'), null);
});

test('主档损坏：列表显示 recoverable，读取自动修复后恢复 ok', (t) => {
  const { mgr, dir, cleanup } = mkManager();
  t.after(cleanup);
  // 先写两版，产生备份链（backup-1 = 第一版 A）
  const store = new SaveStore(dir, 'slot1');
  store.write(createSaveData('A'));
  store.write(createSaveData('A2'));
  writeFileSync(join(dir, 'slot1.json'), '{broken', 'utf8'); // 破坏主档
  const s1 = mgr.list().find((i) => i.slot === 'slot1');
  assert.equal(s1?.state, 'recoverable');
  const r = mgr.read('slot1');
  assert.ok(r && r.recovered === true);
  assert.equal(r.data.player.name, 'A'); // 回退到最近备份
  const after = mgr.list().find((i) => i.slot === 'slot1');
  assert.equal(after?.state, 'ok');
});

test('自动档同样具备备份链：覆盖快照轮换，损坏可恢复', (t) => {
  const { mgr, dir, cleanup } = mkManager();
  t.after(cleanup);
  mgr.create('slot1', '甲');
  mgr.autosave('slot1'); // auto 第一次快照
  mgr.create('slot2', '乙');
  mgr.autosave('slot2'); // 第二次快照 → 第一次快照轮换进 auto 备份链
  assert.equal(mgr.read(AUTO_SLOT)?.data.player.name, '乙');
  // 损坏自动档主档 → 回退到最近备份并修复
  writeFileSync(join(dir, 'auto.json'), '!@#$', 'utf8');
  const rr = mgr.read(AUTO_SLOT);
  assert.ok(rr && rr.recovered);
  assert.equal(rr.data.player.name, '甲');
});

test('复制到更高版本槽位被拒绝（防覆盖新数据）', (t) => {
  const { mgr, dir, cleanup } = mkManager();
  t.after(cleanup);
  mgr.create('slot1', '甲');
  // 模拟 slot3 由更高版本（v999）写出：用 encodeFile 生成校验和匹配的合法文件
  const future = { saveVersion: 999 };
  writeFileSync(join(dir, 'slot3.json'), encodeFile(future));
  assert.throws(() => mgr.copy('slot1', 'slot3'), /too-new/);
  assert.throws(() => mgr.copyOverwrite('slot1', 'slot3'), /too-new/);
});
