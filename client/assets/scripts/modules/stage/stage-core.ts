/**
 * 主线推进纯逻辑（M1-8 最小闭环，§2.1 S7 主线章节 / §4.1 M1 第一章 10 关）。
 * - 关卡表 = config/export/stage.json（导表行结构，见 StageRow）
 * - 推进规则：只允许结算「当前目标关」（progress.chapter/node 指向的关卡）；
 *   通关 → 发放 exp/copper 并推进到同章下一关；第一章最后一关通过后 node 置 0 表示章节完成
 * - 战斗（battle-core）与奖励结算分离：胜负由调用方跑 runBattle 判定，本模块只做状态结算
 * - 与存档字段对齐：ProgressState 形状 = SaveData.progress；经验成长复用 modules/role/role-core
 * 纯函数、零 cc 依赖（tools/client-core-test 单测）。
 */
import { addExp } from '../role/role-core';
import type { GrowResult, RoleState } from '../role/role-core';

/** config/export/stage.json 行结构 */
export interface StageRow {
  id: string;
  chapter: number;
  node: number;
  name: string;
  enemies: string[] | string;
  exp_reward: number;
  copper_reward: number;
}

/** 存档字段 progress 的形状（与 SaveData.progress 一致） */
export interface ProgressState {
  chapter: number;
  node: number;
  towerBest: number;
}

/** 玩家结算上下文：角色（含钱袋）与进度 */
export interface StageClearContext {
  player: RoleState & { copper: number };
  progress: ProgressState;
}

export interface StageClearResult {
  grow: GrowResult;
  copper: number;
  next: { chapter: number; node: number } | null;
}

export function stageIdOf(chapter: number, node: number): string {
  return `${chapter}_${node}`;
}

/** 按章节+序号查关卡 */
export function findStage(rows: StageRow[], chapter: number, node: number): StageRow | undefined {
  return rows.find((r) => r.chapter === chapter && r.node === node);
}

/** 下一关（同章 node+1；不存在 = 章节完成返回 null） */
export function nextStageOf(rows: StageRow[], stage: StageRow): { chapter: number; node: number } | null {
  const next = findStage(rows, stage.chapter, stage.node + 1);
  return next ? { chapter: next.chapter, node: next.node } : null;
}

/**
 * 通关结算：校验关卡 == 当前目标 → 发放奖励 → 经验成长 → 推进进度。
 * 校验失败（重复挑战历史关/乱序）抛错，由 UI/调用方约束。
 * rows 为完整关卡表（用于推导下一关）。
 */
export function clearStage(ctx: StageClearContext, rows: StageRow[], stage: StageRow): StageClearResult {
  const { player, progress } = ctx;
  if (progress.chapter !== stage.chapter || progress.node !== stage.node) {
    throw new Error(`关卡 ${stage.id} 不是当前目标（当前 ${stageIdOf(progress.chapter, progress.node)}）`);
  }
  player.copper += stage.copper_reward;
  const grow = addExp(player, stage.exp_reward);
  const next = nextStageOf(rows, stage);
  if (next) {
    progress.chapter = next.chapter;
    progress.node = next.node;
  } else {
    // 章节最后一关通过：node 置 0 表示章节已完成（新章未开启）
    progress.node = 0;
  }
  return { grow, copper: player.copper, next };
}
