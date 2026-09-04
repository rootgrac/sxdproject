import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSaveData, CURRENT_SAVE_VERSION, decodeFile, encodeFile, SaveStore } from '../src/core.ts';

function mkStore(): { store: SaveStore; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'sxd-save-'));
  const store = new SaveStore(dir, 'slot1');
  return { store, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function mainPath(dir: string): string {
  return join(dir, 'slot1.json');
}

function readBackupName(dir: string, i: number): string {
  const text = readFileSync(join(dir, `slot1.backup-${i}.json`), 'utf8');
  return decodeFile(text).data.player.name;
}

test('往返：写入后读取一致，无残留临时文件', (t) => {
  const { store, dir, cleanup } = mkStore();
  t.after(cleanup);
  assert.equal(store.exists(), false);
  store.write(createSaveData('青玄'));
  assert.equal(store.exists(), true);
  const r = store.read();
  assert.ok(r);
  assert.equal(r.migrated, false);
  assert.equal(r.recovered, false);
  assert.equal(r.data.player.name, '青玄');
  assert.equal(r.data.saveVersion, CURRENT_SAVE_VERSION);
  assert.equal(existsSync(mainPath(dir) + '.tmp'), false); // 原子写入无残留
  // 覆盖写入新值
  const d2 = createSaveData('云瑶');
  d2.player.level = 12;
  store.write(d2);
  const r2 = store.read();
  assert.ok(r2);
  assert.equal(r2.data.player.name, '云瑶');
  assert.equal(r2.data.player.level, 12);
});

test('备份轮换：保留最近 2 份，最旧被淘汰', (t) => {
  const { store, dir, cleanup } = mkStore();
  t.after(cleanup);
  for (const n of ['A', 'B', 'C', 'D']) store.write(createSaveData(n));
  const r = store.read();
  assert.ok(r);
  assert.equal(r.data.player.name, 'D');
  assert.equal(readBackupName(dir, 1), 'C');
  assert.equal(readBackupName(dir, 2), 'B');
  assert.equal(existsSync(join(dir, 'slot1.backup-3.json')), false);
});

test('主档损坏（截断）自动回退最近备份并修复主档', (t) => {
  const { store, dir, cleanup } = mkStore();
  t.after(cleanup);
  store.write(createSaveData('A'));
  store.write(createSaveData('B'));
  writeFileSync(mainPath(dir), '{broken', 'utf8'); // 模拟文件损坏
  const r = store.read();
  assert.ok(r);
  assert.equal(r.recovered, true);
  assert.equal(r.data.player.name, 'A');
  const r2 = store.read(); // 已回写主档，不再恢复
  assert.ok(r2);
  assert.equal(r2.recovered, false);
  assert.equal(r2.data.player.name, 'A');
});

test('内容被篡改（校验和不匹配）视为损坏并回退', (t) => {
  const { store, dir, cleanup } = mkStore();
  t.after(cleanup);
  store.write(createSaveData('A'));
  store.write(createSaveData('B'));
  const p = mainPath(dir);
  const tampered = readFileSync(p, 'utf8').replace('"level":1', '"level":99');
  writeFileSync(p, tampered);
  const r = store.read();
  assert.ok(r);
  assert.equal(r.recovered, true);
  assert.equal(r.data.player.name, 'A');
  assert.equal(r.data.player.level, 1); // 恢复的是真实数据而非篡改值
});

test('create 保护：占用槽位或更高版本档一律拒绝覆盖', (t) => {
  const { store, dir, cleanup } = mkStore();
  t.after(cleanup);
  store.create('甲');
  assert.throws(() => store.create('乙'), /禁止直接覆盖/);
  // 模拟由更高版本（v999）写出的存档
  const future = { ...createSaveData('未来'), saveVersion: 999 };
  writeFileSync(mainPath(dir), encodeFile(future));
  assert.throws(() => store.create('丙'), /禁止直接覆盖/);
  assert.equal(store.read(), null); // too-new：拒绝读取，等待升级版本（防丢档）
  assert.equal(existsSync(mainPath(dir)), true); // 原档保留
  store.remove();
  assert.equal(store.exists(), false);
  store.create('丁'); // 清档后可以开新游戏
  assert.equal(store.read()?.data.player.name, '丁');
});

test('版本迁移：v1 → v2 补 mailbox、另存 backup_v1、迁移后立即写盘', (t) => {
  const { store, dir, cleanup } = mkStore();
  t.after(cleanup);
  const v1Raw = JSON.parse(
    readFileSync(new URL('./fixtures/save_v1.json', import.meta.url), 'utf8'),
  );
  writeFileSync(mainPath(dir), encodeFile(v1Raw));
  const r = store.read();
  assert.ok(r);
  assert.equal(r.migrated, true);
  assert.equal(r.data.saveVersion, CURRENT_SAVE_VERSION);
  assert.deepEqual(r.data.mailbox, []);
  assert.equal(r.data.player.level, 12); // 旧数据完整保留
  // 迁移前原始档已另存
  const snap = decodeFile(readFileSync(join(dir, 'slot1.backup_v1.json'), 'utf8')).data;
  assert.equal(snap.saveVersion, 1);
  // 主档已是 v2，再次读取不再迁移
  const r2 = store.read();
  assert.ok(r2);
  assert.equal(r2.migrated, false);
});
