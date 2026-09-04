/**
 * 装备核心（M2-3，§2.1 S5）：6 部位 / 穿戴 / 属性汇总。
 * - 装备定义来自 config/export/equip.json（equip.tsv 导出行）
 * - 实例：uid 唯一；owner = 'hero'（主角）或伙伴 uid；enhance = 强化等级
 * - 强化：每级属性 ×(1 + 0.1×enhance)（向下取整）；上限随境界（enhanceCapOf，占位曲线，表驱动改造后置）
 * - 同 owner 每部位一件：换装自动卸下旧件（旧件 owner=null 闲置，可再给他人穿）
 * 纯逻辑、零 cc 依赖。
 */
export const EQUIP_SLOTS = ['weapon', 'armor', 'head', 'boots', 'charm', 'orb'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** equip.json 行 */
export interface EquipDefRow {
  id: string;
  slot: string;
  name: string;
  atk: number;
  def: number;
  hp: number;
}

export interface EquipState {
  uid: string;
  equipId: string;
  owner: string | null; // 'hero' | 伙伴 uid
  enhance: number;
}

export interface StatBonus {
  atk: number;
  def: number;
  hp: number;
}

export function defOf(defs: EquipDefRow[], equipId: string): EquipDefRow {
  const d = defs.find((x) => x.id === equipId);
  if (!d) throw new Error(`装备定义不存在：${equipId}`);
  return d;
}

export function createEquip(uid: string, equipId: string): EquipState {
  return { uid, equipId, owner: null, enhance: 0 };
}

/** 单件装备属性（含强化成长；占位：+10%/级 向下取整） */
export function bonusOf(def: EquipDefRow, enhance: number): StatBonus {
  const mul = 1 + 0.1 * enhance;
  return { atk: Math.floor(def.atk * mul), def: Math.floor(def.def * mul), hp: Math.floor(def.hp * mul) };
}

/** 装备到 owner：同 owner 同部位旧件自动卸下（闲置），然后装备新件 */
export function equipTo(equips: EquipState[], item: EquipState, defs: EquipDefRow[], owner: string): void {
  const def = defOf(defs, item.equipId);
  if (item.owner !== null && item.owner !== owner) {
    throw new Error(`装备 ${item.uid} 正被 ${item.owner} 使用，需先卸下`);
  }
  // 同 owner 同部位换装：旧件卸下
  for (const other of equips) {
    const od = defs.find((x) => x.id === other.equipId);
    if (other.uid !== item.uid && other.owner === owner && od && od.slot === def.slot && other.enhance >= 0) {
      other.owner = null;
    }
  }
  item.owner = owner;
}

/** 卸下：owner 置空 */
export function unequip(item: EquipState): void {
  item.owner = null;
}

/** 强化上限（占位：随主角境界提升；表驱动改造后置） */
export function enhanceCapOf(realm: number): number {
  return Math.min(30, 5 + realm * 5);
}

/** 强化到下一级所需铜钱（占位曲线） */
export function enhanceCost(nextEnhance: number): number {
  return 100 + nextEnhance * 120;
}

/** 执行强化：校验上限 → 返回新等级（费用由调用方按 enhanceCost 扣除与入账） */
export function enhanceItem(item: EquipState, realm: number): number {
  if (item.enhance >= enhanceCapOf(realm)) {
    throw new Error(`强化已达上限（境界 ${realm} 上限 +${enhanceCapOf(realm)}）`);
  }
  item.enhance += 1;
  return item.enhance;
}

/** 汇总 owner 全部装备属性加成 */
export function sumBonus(defs: EquipDefRow[], equips: EquipState[], owner: string): StatBonus {
  const out: StatBonus = { atk: 0, def: 0, hp: 0 };
  for (const e of equips) {
    if (e.owner !== owner) continue;
    const d = defs.find((x) => x.id === e.equipId);
    if (!d) continue; // 数据损坏容错
    const b = bonusOf(d, e.enhance);
    out.atk += b.atk;
    out.def += b.def;
    out.hp += b.hp;
  }
  return out;
}
