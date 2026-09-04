import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, countOf } from '../../../client/assets/scripts/modules/item/item-core.ts';
import type { BagItem } from '../../../client/assets/scripts/modules/item/item-core.ts';
import {
  claimAllMail,
  claimMail,
  listMail,
  sendMail,
  unclaimedOf,
} from '../../../client/assets/scripts/modules/mail/mail-core.ts';
import type { MailEntry, MailboxState } from '../../../client/assets/scripts/modules/mail/mail-core.ts';
import {
  activeToday,
  claimBox,
  notifyTask,
  progressView,
} from '../../../client/assets/scripts/modules/task/task-core.ts';
import type { DailyTasks, TaskBoxRow, TaskRow } from '../../../client/assets/scripts/modules/task/task-core.ts';

const ROWS: TaskRow[] = [
  { id: 't_stage', name: '通关主线关卡', type: 'stage_win', target: 3, active: 10 },
  { id: 't_recruit', name: '招募伙伴', type: 'recruit', target: 1, active: 10 },
];
const BOXES: TaskBoxRow[] = [
  { threshold: 10, copper: 500 },
  { threshold: 20, copper: 1000 },
];

function mkDaily(): DailyTasks {
  return { dateKey: '', elites: {}, tasks: {}, claimedBoxes: [], signIn: { streak: 0, lastKey: '' } };
}

function mkMail(title = '测试奖励', id = 'm1'): MailEntry {
  return {
    id,
    title,
    body: 'test',
    attachments: [
      { kind: 'copper', count: 300 },
      { kind: 'item', itemId: 'it_iron', count: 2 },
    ],
    claimedAt: null,
    expiresAt: null,
    createdAt: 100,
  };
}

test('信箱：发送/列表排序/过期过滤', () => {
  const mb: MailboxState = { mailbox: [] };
  sendMail(mb, mkMail('第一封', 'm1'));
  sendMail(mb, { ...mkMail('第二封', 'm2'), createdAt: 200 });
  assert.throws(() => sendMail(mb, mkMail('重复', 'm1')), /重复/);
  const list = listMail(mb, 1000);
  assert.equal(list[0].title, '第二封'); // 新在前
  // 过期过滤
  const exp = mb.mailbox[0];
  exp.expiresAt = 500;
  assert.equal(listMail(mb, 1000).length, 1);
});

test('信箱：领取附件入包入账/防重复/批量领取', () => {
  const mb: MailboxState = { mailbox: [mkMail('A', 'm1'), mkMail('B', 'm2')] };
  const bag: BagItem[] = [];
  const wallet = { copper: 0 };
  claimMail(mb, bag, wallet, 'm1', 1000);
  assert.equal(wallet.copper, 300);
  assert.equal(countOf(bag, 'it_iron'), 2);
  assert.throws(() => claimMail(mb, bag, wallet, 'm1', 1000), /已领取/);
  assert.equal(unclaimedOf(mb, 1000).length, 1);
  const n = claimAllMail(mb, bag, wallet, 1000);
  assert.equal(n, 1);
  assert.equal(wallet.copper, 600);
  assert.equal(unclaimedOf(mb, 1000).length, 0);
});

test('每日任务：事件计数与跨日重置', () => {
  const d = mkDaily();
  notifyTask(d, '2026-09-04', ROWS, 'stage_win');
  notifyTask(d, '2026-09-04', ROWS, 'stage_win');
  const view = progressView(d, '2026-09-04', ROWS);
  assert.equal(view[0].current, 2);
  assert.equal(view[0].done, false);
  notifyTask(d, '2026-09-04', ROWS, 'stage_win');
  assert.equal(progressView(d, '2026-09-04', ROWS)[0].done, true);
  // 跨日重置
  assert.equal(progressView(d, '2026-09-05', ROWS)[0].current, 0);
  notifyTask(d, '2026-09-05', ROWS, 'recruit');
  assert.equal(progressView(d, '2026-09-05', ROWS)[1].current, 1);
});

test('活跃度与宝箱：累计/逐档领取/防重复/不足拒绝', () => {
  const d = mkDaily();
  assert.equal(activeToday(d, '2026-09-04', ROWS), 0);
  notifyTask(d, '2026-09-04', ROWS, 'stage_win');
  notifyTask(d, '2026-09-04', ROWS, 'stage_win');
  notifyTask(d, '2026-09-04', ROWS, 'stage_win'); // t_stage 完成 +10
  notifyTask(d, '2026-09-04', ROWS, 'recruit'); // +10 → 20
  const wallet = { copper: 0 };
  assert.equal(activeToday(d, '2026-09-04', ROWS), 20);
  assert.equal(claimBox(d, '2026-09-04', ROWS, BOXES, wallet, 10), true);
  assert.equal(wallet.copper, 500);
  assert.equal(claimBox(d, '2026-09-04', ROWS, BOXES, wallet, 20), true);
  assert.equal(wallet.copper, 1500);
  assert.throws(() => claimBox(d, '2026-09-04', ROWS, BOXES, wallet, 20), /已领取/);
  assert.throws(() => claimBox(d, '2026-09-04', ROWS, BOXES, wallet, 10), /已领取/);
  // 活跃不足场景（新的一天只做一半任务）
  const d2 = mkDaily();
  notifyTask(d2, '2026-09-05', ROWS, 'stage_win');
  assert.equal(activeToday(d2, '2026-09-05', ROWS), 0); // 未完成不计分
  const w2 = { copper: 0 };
  assert.throws(() => claimBox(d2, '2026-09-05', ROWS, BOXES, w2, 10), /活跃度不足/);
});
