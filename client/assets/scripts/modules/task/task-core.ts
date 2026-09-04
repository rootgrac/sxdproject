/**
 * 每日任务核心（M3-2，§2.1 S10：任务链 + 活跃度宝箱；§3.5-5 本地日历驱动）。
 * - 任务定义：config/export/task.json（type 对应系统事件：主线通关/精英/招募/强化/打造/商店）
 * - 活跃宝箱：config/export/task_box.json（阈值 → 铜钱）
 * - 状态存 SaveData.daily（v5：tasks/claimedBoxes；跨日按 dateKey 惰性重置）
 * 纯逻辑、零 cc 依赖。
 */
export type TaskType = 'stage_win' | 'elite_win' | 'recruit' | 'enhance' | 'craft' | 'shop';

export interface TaskRow {
  id: string;
  name: string;
  type: string;
  target: number;
  active: number;
}

export interface TaskBoxRow {
  threshold: number;
  copper: number;
}

/** SaveData.daily（v5）视图 */
export interface DailyTasks {
  dateKey: string;
  elites: Record<string, number>;
  tasks: Record<string, number>;
  claimedBoxes: number[];
  signIn: { streak: number; lastKey: string };
}

export function tasksByType(rows: TaskRow[], type: TaskType): TaskRow[] {
  return rows.filter((r) => r.type === type);
}

/** 事件通知：跨日先重置，目标任务计数 +1 */
export function notifyTask(daily: DailyTasks, today: string, rows: TaskRow[], type: TaskType): void {
  if (daily.dateKey !== today) {
    daily.dateKey = today;
    daily.tasks = {};
    daily.claimedBoxes = [];
  }
  for (const r of tasksByType(rows, type)) {
    daily.tasks[r.id] = (daily.tasks[r.id] ?? 0) + 1;
  }
}

export interface TaskProgressView {
  id: string;
  name: string;
  current: number;
  target: number;
  done: boolean;
  active: number;
}

export function progressView(daily: DailyTasks, today: string, rows: TaskRow[]): TaskProgressView[] {
  if (daily.dateKey !== today) {
    daily.dateKey = today;
    daily.tasks = {};
    daily.claimedBoxes = [];
  }
  return rows.map((r) => {
    const current = Math.min(daily.tasks[r.id] ?? 0, r.target);
    return { id: r.id, name: r.name, current, target: r.target, done: current >= r.target, active: r.active };
  });
}

/** 今日已得活跃度（已完成任务计分，不重复累计超目标） */
export function activeToday(daily: DailyTasks, today: string, rows: TaskRow[]): number {
  return progressView(daily, today, rows).reduce((sum, v) => sum + (v.done ? v.active : 0), 0);
}

/** 领取活跃宝箱：阈值达标且未领取 → 铜钱入账 */
export function claimBox(
  daily: DailyTasks,
  today: string,
  rows: TaskRow[],
  boxes: TaskBoxRow[],
  wallet: { copper: number },
  threshold: number,
): boolean {
  const box = boxes.find((b) => b.threshold === threshold);
  if (!box) throw new Error(`无此活跃宝箱档位：${threshold}`);
  if (activeToday(daily, today, rows) < threshold) throw new Error(`活跃度不足（需 ${threshold}）`);
  if (daily.claimedBoxes.includes(threshold)) throw new Error('该档位宝箱已领取');
  wallet.copper += box.copper;
  daily.claimedBoxes.push(threshold);
  return true;
}
