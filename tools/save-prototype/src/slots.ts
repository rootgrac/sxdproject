/**
 * 多槽位存档管理（§2.1 S1「多槽位存档」）：3 个手动槽 + 1 个自动档。
 * 每个槽位 = 一组文件（slotN.json + 备份链 + 迁移快照），见 core.ts SaveStore。
 * 覆盖确认（删除/覆盖槽位）属于 UI 层职责，本层提供明确抛错的保护式 API 与 *Overwrite 变体。
 */
import { SaveStore } from './core.ts';
import type { ReadResult, SaveData, SlotSummary } from './core.ts';

export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3'] as const;
export const AUTO_SLOT = 'auto';

export type ManualSlot = (typeof MANUAL_SLOTS)[number];
export type SlotId = ManualSlot | typeof AUTO_SLOT;

export interface SlotInfo extends SlotSummary {
  slot: SlotId;
}

export class SlotManager {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private storeOf(slot: SlotId): SaveStore {
    return new SaveStore(this.dir, slot);
  }

  /** 槽位总览（3 手动 + 1 自动，只读） */
  list(): SlotInfo[] {
    return [...MANUAL_SLOTS, AUTO_SLOT].map((slot) => {
      const sm = this.storeOf(slot).summary();
      return { slot, state: sm.state, name: sm.name, level: sm.level, lastSavedAt: sm.lastSavedAt };
    });
  }

  /** 新游戏（仅手动槽）；目标占用（含更高版本档）时拒绝覆盖 */
  create(slot: ManualSlot, name?: string): SaveData {
    return this.storeOf(slot).create(name);
  }

  /** 读取：自动迁移版本 / 损坏自动回退并修复主档；无可用数据返回 null */
  read(slot: SlotId): ReadResult | null {
    return this.storeOf(slot).read();
  }

  /** 直接写档（正常存档动作：通关/战斗结束等关键节点） */
  write(slot: SlotId, data: SaveData): void {
    this.storeOf(slot).write(data);
  }

  /** 删除槽位（含备份与迁移快照）；UI 必须先确认 */
  remove(slot: SlotId): void {
    this.storeOf(slot).remove();
  }

  /** 复制槽位：目标为空才允许；可用于 手动槽→自动档 恢复等场景 */
  copy(from: SlotId, to: SlotId): void {
    this.copyImpl(from, to, false);
  }

  /** 覆盖式复制：UI 确认后调用 */
  copyOverwrite(from: SlotId, to: SlotId): void {
    this.copyImpl(from, to, true);
  }

  /** 自动存档：把指定槽位快照写入自动档（强制覆盖，关键节点由调度层调用） */
  autosave(from: ManualSlot): void {
    this.copyImpl(from, AUTO_SLOT, true);
  }

  private copyImpl(from: SlotId, to: SlotId, overwrite: boolean): void {
    if (from === to) throw new Error('源与目标不能是同一槽位');
    const src = this.storeOf(from).read();
    if (!src) throw new Error(`源槽位 ${from} 没有可用存档（空/损坏且无备份）`);
    const dst = this.storeOf(to);
    const state = dst.summary().state;
    if (state === 'too-new') {
      // 更高版本写出的档：一律拒绝覆盖（防数据丢失），需用户先删除该槽位
      throw new Error(`目标槽位 ${to} 由更高版本写出（too-new），禁止复制覆盖；如需处理请先删除该槽位`);
    }
    if (!overwrite && (state === 'ok' || state === 'recoverable')) {
      throw new Error(`目标槽位 ${to} 已有存档（${state}），需要确认覆盖`);
    }
    // 目标为损坏/仅备份可用状态：清空后再写，防止损坏文件被轮换进新备份链
    if (state === 'corrupt' || state === 'recoverable') dst.remove();
    // 目标已有有效档 + overwrite：直接 write（SaveStore 自行轮换备份链，保留历史）
    dst.write(src.data);
  }
}
