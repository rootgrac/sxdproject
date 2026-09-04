/**
 * 伙伴核心（M2-1，§2.1 S4）：伙伴实例 / 成长 / 上阵管理。
 * - 实例：uid 唯一标识（存档内持久），unitId 引用 config unit 表
 * - 成长：复用 role-core（level/exp/realm 同构），品质 quality 为进阶占位（0..2，乘区后续接入）
 * - 上阵：SaveData.party.partnerSlots（主角常驻不占位）；防重复/越界由本模块保证
 * - equips/词条、招募（M2-2）在后续模块扩展
 * 纯逻辑、零 cc 依赖。
 */
import { addExp } from '../role/role-core';
import type { GrowResult, RoleState } from '../role/role-core';

export interface PartnerState {
  uid: string;
  unitId: string;
  name: string;
  level: number;
  exp: number;
  realm: number;
  /** 进阶品质 0..2（占位：表/乘区在数值轮定稿） */
  quality: number;
  joinAt: number;
}

export interface PartyState {
  partnerSlots: (string | null)[];
}

export function createPartner(opts: { uid: string; unitId: string; name: string; quality?: number; joinAt: number }): PartnerState {
  return {
    uid: opts.uid,
    unitId: opts.unitId,
    name: opts.name,
    level: 1,
    exp: 0,
    realm: 0,
    quality: opts.quality ?? 0,
    joinAt: opts.joinAt,
  };
}

/** 伙伴升级：经验入账（自动连升/境界，同主角规则） */
export function partnerGainExp(p: PartnerState, amount: number): GrowResult {
  return addExp(p as RoleState, amount);
}

/** 查找伙伴实例 */
export function findPartner(partners: PartnerState[], uid: string): PartnerState | undefined {
  return partners.find((p) => p.uid === uid);
}

/** 新增伙伴（uid 唯一约束） */
export function addPartner(partners: PartnerState[], partner: PartnerState): void {
  if (findPartner(partners, partner.uid)) throw new Error(`伙伴 uid 重复：${partner.uid}`);
  partners.push(partner);
}

/**
 * 上阵/下阵：把 uid 放入指定槽位（null = 下阵）。
 * 校验：槽位范围、伙伴存在、同一伙伴不得重复上阵（跨槽）。
 */
export function setPartnerSlot(party: PartyState, partners: PartnerState[], index: number, uid: string | null): void {
  if (index < 0 || index >= party.partnerSlots.length) {
    throw new Error(`上阵槽位越界：${index}`);
  }
  if (uid !== null && !findPartner(partners, uid)) {
    throw new Error(`伙伴不存在：${uid}`);
  }
  if (uid !== null && party.partnerSlots.includes(uid)) {
    throw new Error(`伙伴已上阵其他槽位：${uid}`);
  }
  party.partnerSlots[index] = uid;
}

/** 当前上阵伙伴（按槽序；数据损坏（引用丢失）时跳过该槽） */
export function equippedPartners(party: PartyState, partners: PartnerState[]): (PartnerState | null)[] {
  return party.partnerSlots.map((uid) => (uid === null ? null : (findPartner(partners, uid) ?? null)));
}

/** 出战伙伴数（主角不计；供战斗组队使用） */
export function equippedCount(party: PartyState): number {
  return party.partnerSlots.filter((u) => u !== null).length;
}
