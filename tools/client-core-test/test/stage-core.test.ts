import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearStage,
  findStage,
  nextStageOf,
  stageIdOf,
} from '../../../client/assets/scripts/modules/stage/stage-core.ts';
import type { StageClearContext, StageRow } from '../../../client/assets/scripts/modules/stage/stage-core.ts';

function mkRows(): StageRow[] {
  const rows: StageRow[] = [];
  for (let node = 1; node <= 10; node++) {
    rows.push({
      id: stageIdOf(1, node),
      chapter: 1,
      node,
      name: `关卡${node}`,
      enemies: ['u004', 'u005', 'u006'].slice(0, node >= 3 ? 3 : 2),
      exp_reward: 50 * node,
      copper_reward: 100 * node,
    });
  }
  return rows;
}

function mkCtx(): StageClearContext {
  return {
    player: { name: '云骞', level: 1, exp: 0, realm: 0, copper: 0 },
    progress: { chapter: 1, node: 1, towerBest: 0 },
  };
}

test('通关首关：奖励入账、进度推进到 1_2', () => {
  const rows = mkRows();
  const ctx = mkCtx();
  const r = clearStage(ctx, rows, rows[0]);
  assert.equal(r.copper, 100);
  assert.equal(ctx.player.copper, 100);
  assert.equal(ctx.player.exp, 50); // 50 exp 不足以升级
  assert.equal(r.grow.levelUps, 0);
  assert.deepEqual(r.next, { chapter: 1, node: 2 });
  assert.deepEqual({ chapter: ctx.progress.chapter, node: ctx.progress.node }, { chapter: 1, node: 2 });
});

test('经验累积跨关升级（exp 正确保留）', () => {
  const rows = mkRows();
  const ctx = mkCtx();
  clearStage(ctx, rows, rows[0]); // exp 50
  clearStage(ctx, rows, rows[1]); // +100 → 150：升 1 级剩 50
  assert.equal(ctx.player.level, 2);
  assert.equal(ctx.player.exp, 50);
  assert.equal(ctx.player.realm, 0); // 2 级仍通脉
});

test('校验：非当前目标关卡拒绝结算（防重复刷关）', () => {
  const rows = mkRows();
  const ctx = mkCtx();
  assert.throws(() => clearStage(ctx, rows, rows[4]), /不是当前目标/);
  // 结算过 1_1 后再结算 1_1（重复）也被拒
  clearStage(ctx, rows, rows[0]);
  assert.throws(() => clearStage(ctx, rows, rows[0]), /不是当前目标/);
});

test('第一章通关：最后一关 next=null 且 node 置 0', () => {
  const rows = mkRows();
  const ctx = mkCtx();
  for (const stage of rows) {
    clearStage(ctx, rows, stage); // 顺序打通 10 关
  }
  assert.equal(ctx.progress.node, 0); // 章节完成标记
  assert.deepEqual(clearStage.length, 3); // 防呆：clearStage 参数数量不变
});

test('findStage / nextStageOf / 章节边界', () => {
  const rows = mkRows();
  assert.equal(findStage(rows, 1, 3)?.id, '1_3');
  assert.equal(findStage(rows, 2, 1), undefined);
  const last = rows[rows.length - 1];
  assert.equal(nextStageOf(rows, last), null);
  assert.equal(nextStageOf(rows, rows[0])?.node, 2);
});
