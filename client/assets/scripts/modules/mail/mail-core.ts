/**
 * 本地信箱核心（M3-1，§2.1 S10 系统信箱：本地发放补偿与奖励、附件领取/批量领取）。
 * - SaveData.mailbox（v2 起已有占位数组）定型为 MailEntry[]
 * - 附件 = 物品（itemId+count）或直接铜钱；领取防重复（claimedAt 标记）
 * - 单机无远端，发放方 = 本地系统（签到/任务/成就/补偿等模块）
 * 纯逻辑、零 cc 依赖。
 */
import { addItem } from '../item/item-core';
import type { BagItem } from '../item/item-core';

export interface MailAttachment {
  kind: 'item' | 'copper';
  itemId?: string;
  count: number;
}

export interface MailEntry {
  id: string;
  title: string;
  body?: string;
  attachments: MailAttachment[];
  /** 领取时间戳；null = 未领取 */
  claimedAt: number | null;
  /** 过期时间戳；null = 永久 */
  expiresAt: number | null;
  createdAt: number;
}

export interface MailboxState {
  mailbox: MailEntry[];
}

export function sendMail(mb: MailboxState, mail: MailEntry): void {
  if (mb.mailbox.some((m) => m.id === mail.id)) throw new Error(`邮件 id 重复：${mail.id}`);
  mb.mailbox.push(mail);
}

export function listMail(mb: MailboxState, now: number): MailEntry[] {
  // 过滤过期；新→旧
  return mb.mailbox
    .filter((m) => m.expiresAt === null || m.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function unclaimedOf(mb: MailboxState, now: number): MailEntry[] {
  return listMail(mb, now).filter((m) => m.claimedAt === null);
}

/**
 * 领取单封邮件：附件入包/入账（防重复：已领取抛错；过期邮件抛错）。
 */
export function claimMail(mb: MailboxState, bag: BagItem[], wallet: { copper: number }, mailId: string, now: number): MailEntry {
  const mail = mb.mailbox.find((m) => m.id === mailId);
  if (!mail) throw new Error(`邮件不存在：${mailId}`);
  if (mail.expiresAt !== null && mail.expiresAt <= now) throw new Error('邮件已过期');
  if (mail.claimedAt !== null) throw new Error('该邮件已领取');
  for (const att of mail.attachments) {
    if (att.kind === 'copper') {
      wallet.copper += att.count;
    } else if (att.itemId) {
      addItem(bag, att.itemId, att.count);
    }
  }
  mail.claimedAt = now;
  return mail;
}

/** 批量领取全部未领取邮件；返回成功数量（单封失败跳过——防止一封坏邮件卡死批量） */
export function claimAllMail(mb: MailboxState, bag: BagItem[], wallet: { copper: number }, now: number): number {
  let n = 0;
  for (const m of unclaimedOf(mb, now)) {
    try {
      claimMail(mb, bag, wallet, m.id, now);
      n++;
    } catch {
      // 跳过异常邮件
    }
  }
  return n;
}
