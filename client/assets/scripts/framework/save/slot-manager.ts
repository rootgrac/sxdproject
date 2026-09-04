/**
 * 多槽位存档管理（Cocos 客户端 KV 版；§2.1 S1）。
 * 移植自 tools/save-prototype/src/slots.ts（语义一致），存储走 KeyValueStorage
 * （浏览器预览 localStorage / 原生端 jsb，见 drivers.ts）。
 * 覆盖确认（删除/覆盖槽位）属于 UI 层职责，本层提供明确抛错的保护式 API 与 *Overwrite 变体。
 */
import { KvSaveStore } from './save-core';
import type { KeyValueStorage, SaveData, SlotSummary } from './save-core';

export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3'] as const;
export const AUTO_SLOT = 'auto';

export type ManualSlot = (typeof MANUAL_SLOTS)[number];
export type SlotId = ManualSlot | typeof AUTO_SLOT;

export interface SlotInfo extends SlotSummary {
  slot: SlotId;
}

export class SlotManager {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage) {
    this.storage = storage;
  }

  private storeOf(slot: SlotId): KvSaveStore {
    return new KvSaveStore(this.storage, slot);
  }

  /** 槽位总览（3 手动 + 1 自动，只读） */
  list(): SlotInfo[] {
    const ids: SlotId[] = [...MANUAL_SLOTS, AUTO_SLOT];
    return ids.map((slot) => {
      const sm = this.storeOf(slot).summary();
      return { slot, state: sm.state, name: sm.name, level: sm.level, lastSavedAt: sm.lastSavedAt };
    });
  }

  /** 新游戏（仅手动槽）；目标占用（含更高版本档）时拒绝覆盖 */
  create(slot: ManualSlot, name?: string): SaveData {
    return this.storeOf(slot).create(name);
  }

  /** 读取：自动迁移版本 / 损坏自动回退并修复主键；无可用数据返回 null */
  read(slot: SlotId): { data: SaveData; migrated: boolean; recovered: boolean } | null {
    return this.storeOf(slot).read();
  }

  /** 直接写档（正常存档动作） */
  write(slot: SlotId, data: SaveData): void {
    this.storeOf(slot).write(data);
  }

  /** 删除槽位（含备份与迁移快照）；UI 必须先确认 */
  remove(slot: SlotId): void {
    this.storeOf(slot).remove();
  }

  /** 复制槽位：目标为空才允许（手动槽 ↔ 自动档恢复等） */
  copy(from: SlotId, to: SlotId): void {
    this.copyImpl(from, to, false);
  }

  /** 覆盖式复制：UI 确认后调用 */
  copyOverwrite(from: SlotId, to: SlotId): void {
    this.copyImpl(from, to, true);
  }

  /** 自动存档：指定手动槽快照 → auto（强制覆盖，保留备份链） */
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
      throw new Error(`目标槽位 ${to} 由更高版本写出（too-new），禁止复制覆盖；如需处理请先删除该槽位`);
    }
    if (!overwrite && (state === 'ok' || state === 'recoverable')) {
      throw new Error(`目标槽位 ${to} 已有存档（${state}），需要确认覆盖`);
    }
    // 目标为损坏/仅备份可用状态：清空后再写，防止损坏文件被轮换进新备份链
    if (state === 'corrupt' || state === 'recoverable') dst.remove();
    dst.write(src.data); // 目标已有有效档 + overwrite：write 自行轮换备份链，保留历史
  }
}
