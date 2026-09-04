import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../../client/assets/scripts/framework/save/sha256.ts';

function nodeSha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

test('SHA-256 已知向量（FIPS 180-4 示例）', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('SHA-256 与 node:crypto 对拍（中文 / 长文本 / 分块边界长度）', () => {
  const samples: string[] = [
    '仙途HD存档测试',
    'a'.repeat(55), // 填充边界：56 字节 = 恰好一块结尾
    'a'.repeat(56),
    'a'.repeat(63),
    'a'.repeat(64),
    'a'.repeat(65),
    '存档内容'.repeat(300), // 超过单块
    JSON.stringify({ saveVersion: 2, player: { name: '青玄', level: 12 }, mailbox: [] }),
  ];
  for (const s of samples) {
    assert.equal(sha256Hex(s), nodeSha(s), `mismatch for length ${s.length}`);
  }
});
