/**
 * 七日签到核心（M3-3，§2.1 S10 签到）。
 * 规则（原创，表驱动奖励）：连续签到按 day 1..7 循环发放（第 7 天为大奖日）；
 * 中断（昨天未签）→ 从第 1 天重新开始。状态存 daily.signIn（v5）。
 * 纯逻辑、零 cc 依赖。
 */
import type { DailyTasks } from './task-core';

export interface SignInRow {
  day: number;
  copper: number;
  item: string; // '' = 无道具
}

export interface SignInResult {
  day: number;
  copper: number;
  item: string;
  streak: number;
}

export const SIGNIN_DAYS = 7;

/** 日期键的昨天（YYYY-MM-DD） */
export function prevDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

export function signedToday(daily: DailyTasks, today: string): boolean {
  return daily.signIn.lastKey === today;
}

export interface SignInStatus {
  signedToday: boolean;
  streak: number;
  /** 明天可领的第几天（模式） */
  nextDay: number;
}

export function signInStatusOf(daily: DailyTasks, today: string): SignInStatus {
  const s = daily.signIn;
  const nextStreak = s.lastKey === today ? s.streak : s.lastKey === prevDayKey(today) ? s.streak + 1 : 1;
  return { signedToday: s.lastKey === today, streak: s.streak, nextDay: ((nextStreak - 1) % SIGNIN_DAYS) + 1 };
}

/**
 * 签到：已签抛错；昨天未签则 streak 重置为 1；返回当日奖励（模式 day=(streak-1)%7+1）。
 */
export function signIn(daily: DailyTasks, today: string): { day: number; streak: number } {
  if (signedToday(daily, today)) throw new Error('今日已签到');
  const s = daily.signIn;
  const streak = s.lastKey === prevDayKey(today) ? s.streak + 1 : 1;
  s.streak = streak;
  s.lastKey = today;
  return { day: ((streak - 1) % SIGNIN_DAYS) + 1, streak };
}

/** 按表查第 day 天奖励（表缺行 → 空奖励） */
export function rewardOf(rows: SignInRow[], day: number): { copper: number; item: string } {
  const r = rows.find((x) => x.day === day);
  return r ? { copper: r.copper, item: r.item } : { copper: 0, item: '' };
}
