import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPartner,
  createPartner,
  equippedCount,
  equippedPartners,
  findPartner,
  partnerGainExp,
  setPartnerSlot,
} from '../../../client/assets/scripts/modules/partner/partner-core.ts';
import type { PartyState, PartnerState } from '../../../client/assets/scripts/modules/partner/partner-core.ts';

function mkParty(): PartyState {
  return { partnerSlots: [null, null] };
}

function p(uid: string, unitId = 'u002', name = '洛璃'): PartnerState {
  return createPartner({ uid, unitId, name, joinAt: 0 });
}

test('创建/查找/重复拒绝', () => {
  const partners: PartnerState[] = [];
  addPartner(partners, p('pa1'));
  addPartner(partners, p('pa2', 'u003', '沈砚'));
  assert.equal(partners.length, 2);
  assert.equal(findPartner(partners, 'pa1')?.unitId, 'u002');
  assert.throws(() => addPartner(partners, p('pa1')), /uid 重复/);
});

test('伙伴升级：经验入账自动连升', () => {
  const partner = p('pa1');
  const g = partnerGainExp(partner, 450); // 100+150+200 → 升 3 级
  assert.equal(g.levelUps, 3);
  assert.equal(partner.level, 4);
  assert.equal(partner.exp, 0);
});

test('上阵管理：设置/下阵/防重复/防越界', () => {
  const partners = [p('pa1'), p('pa2')];
  const party = mkParty();
  setPartnerSlot(party, partners, 0, 'pa1');
  setPartnerSlot(party, partners, 1, 'pa2');
  assert.deepEqual(party.partnerSlots, ['pa1', 'pa2']);
  assert.equal(equippedCount(party), 2);
  // 重复上阵拒绝
  assert.throws(() => setPartnerSlot(party, partners, 1, 'pa1'), /已上阵其他槽位/);
  // 不存在伙伴拒绝
  assert.throws(() => setPartnerSlot(party, partners, 0, 'nope'), /伙伴不存在/);
  // 越界拒绝
  assert.throws(() => setPartnerSlot(party, partners, 2, 'pa1'), /槽位越界/);
  // 下阵
  setPartnerSlot(party, partners, 0, null);
  assert.deepEqual(party.partnerSlots, [null, 'pa2']);
});

test('equippedPartners：按槽序返回、引用丢失槽位为 null', () => {
  const partners = [p('pa1')];
  const party = { partnerSlots: ['pa1', 'pa2'] }; // pa2 数据损坏丢失
  const eq = equippedPartners(party, partners);
  assert.equal(eq[0]?.uid, 'pa1');
  assert.equal(eq[1], null);
});
