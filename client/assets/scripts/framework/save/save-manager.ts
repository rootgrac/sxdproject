/**
 * 存档运行时调度层（开发文档 §3.5-1）：
 * 「内存数据模型为单一数据源；变脏后 30 秒批量写盘，关键节点（战斗结束/内购到账/关卡通关/退后台）立即写盘」
 *
 * 职责边界：
 *  - 本类只管「何时写」：脏标记合并、30s 节拍批量写、flushNow 立即写、meta.lastSavedAt 维护
 *  - 数据读写仍走 KvSaveStore（原子写/校验/备份轮换/迁移）
 *  - 业务修改必须直接作用于 getData() 返回的内存对象，然后调用 markDirty()
 *
 * Cocos 接入点（移植时）：
 *  - 主循环 / director 定时器周期性调用 tick()
 *  - 关卡结算、战斗结束、内购到账后调用 flushNow()
 *  - 应用退后台/切出事件（game.EVENT_HIDE / 生命周期）调用 flushNow()
 * 时钟通过 now() 注入：游戏运行时用 Date.now()，单测用假时钟。
 */
import { KvSaveStore } from './save-core';
import type { SaveData } from './save-core';

export interface SaveManagerOptions {
  store: KvSaveStore;
  /** 批量写盘间隔，默认 30_000ms（§3.5-1） */
  flushIntervalMs?: number;
  /** 时钟源（默认 Date.now），测试注入用 */
  now?: () => number;
}

export class SaveManager {
  private readonly store: KvSaveStore;
  private readonly flushIntervalMs: number;
  private readonly now: () => number;
  private data: SaveData | null = null;
  private dirty = false;
  private lastFlushAt: number;

  constructor(opts: SaveManagerOptions) {
    this.store = opts.store;
    this.flushIntervalMs = opts.flushIntervalMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.lastFlushAt = this.now();
  }

  /** 读取存档到内存（含迁移/损坏回退语义，见 KvSaveStore.read）；无可用档返回 null */
  load(): SaveData | null {
    const r = this.store.read();
    this.data = r ? r.data : null;
    this.dirty = false;
    this.lastFlushAt = this.now();
    return this.data;
  }

  /** 新游戏：立即落盘初始档，内存态清零 */
  create(name?: string): SaveData {
    this.data = this.store.create(name);
    this.dirty = false;
    this.lastFlushAt = this.now();
    return this.data;
  }

  getData(): SaveData | null {
    return this.data;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  /** 业务修改完成后的统一通知（修改需直接作用于 getData() 对象） */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * 周期性节拍（主循环调用）：脏数据且距上次写盘 ≥ flushIntervalMs 时批量写盘。
   * @returns 本次是否发生写盘
   */
  tick(nowMs: number = this.now()): boolean {
    if (!this.dirty || !this.data) return false;
    if (nowMs - this.lastFlushAt < this.flushIntervalMs) return false;
    return this.flush(nowMs);
  }

  /** 关键节点立即写盘（战斗结束 / 内购到账 / 关卡通关 / 退后台） */
  flushNow(): boolean {
    return this.flush(this.now());
  }

  private flush(nowMs: number): boolean {
    if (!this.dirty || !this.data) return false;
    this.data.meta.lastSavedAt = nowMs;
    this.store.write(this.data);
    this.dirty = false;
    this.lastFlushAt = nowMs;
    return true;
  }
}
