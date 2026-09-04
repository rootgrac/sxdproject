/**
 * 配置 → 战斗单位（M1-3：导表数据接入内核，§3.6）。
 * 纯函数、零 IO：输入导表 JSON 的行结构，构造 battle-core 的 Unit[]。
 * 文件加载由调用方负责（CLI demo 读 config/export/*.json；Cocos 走 resources 层）。
 * 技能引用（skills 列表 → skill 表）经导表工具校验（ref:skill.id），运行时再做防御性兜底。
 */
import { makeUnit } from './model';
import type { SkillEffectDef, Unit, UnitStats } from './model';

/** config/export/unit.json 行结构 */
export interface UnitRow {
  id: string;
  name: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  acc: number;
  eva: number;
  crit: number;
  skills: string[] | string;
  /** 招募解锁等级（0/缺省 = 不可招募；M2 招贤阁） */
  recruit_level?: number;
}

/** config/export/skill.json 行结构（ratio 仅作无效果器时的回退倍率） */
export interface SkillRow {
  id: string;
  name: string;
  kind: string; // 'normal' | 'ultimate'（效果器体系扩展后继续沿用 kind 分类）
  ratio?: number;
}

/** config/export/skill_effect.json 行结构 */
export interface SkillEffectRow {
  id: string;
  skill: string;
  kind: string;
  target: string;
  ratio: number;
  stat: string;
  value: number;
  duration: number;
}

/** 构造一方阵容：绝技 = 首个 kind=ultimate 技能，其 ratio 注入单位（表现层可显示技能名） */
export function buildUnits(rows: UnitRow[], skills: SkillRow[], side: 'ally' | 'enemy'): Unit[] {
  const skillById = new Map(skills.map((s) => [s.id, s]));
  return rows.map((r) => {
    const ids = Array.isArray(r.skills) ? r.skills : r.skills ? [r.skills] : [];
    const ultimate = ids
      .map((id) => skillById.get(id))
      .find((s): s is SkillRow => s !== undefined && s.kind === 'ultimate');
    const stats: UnitStats = {
      atk: r.atk,
      def: r.def,
      spd: r.spd,
      acc: r.acc,
      eva: r.eva,
      crit: r.crit,
    };
    return makeUnit({
      id: r.id,
      side,
      name: r.name,
      hp: r.hp,
      stats,
      skillId: ultimate?.id ?? '',
      skillRatio: ultimate?.ratio,
    });
  });
}

/** 读取导表 JSON（数组行），类型化返回（调用方提供已 parse 的对象） */
export function isUnitRowArray(v: unknown): v is UnitRow[] {
  return Array.isArray(v) && v.every((r) => typeof r === 'object' && r !== null && typeof (r as UnitRow).id === 'string');
}

export function isSkillRowArray(v: unknown): v is SkillRow[] {
  return Array.isArray(v) && v.every((r) => typeof r === 'object' && r !== null && typeof (r as SkillRow).id === 'string');
}

/**
 * 由 skill_effect 表构造技能效果器表（skillId → 效果器列表），
 * 空单元格默认值（0/''）在构造时归一化为 undefined。
 */
export function buildEffects(rows: SkillEffectRow[]): Record<string, SkillEffectDef[]> {
  const out: Record<string, SkillEffectDef[]> = {};
  for (const r of rows) {
    const fx: SkillEffectDef = {
      id: r.id,
      kind: r.kind === 'heal' || r.kind === 'buff' || r.kind === 'debuff' || r.kind === 'damage' ? r.kind : 'damage',
      target: r.target === 'self' ? 'self' : 'enemy',
      ratio: r.ratio > 0 ? r.ratio : undefined,
      stat: r.stat === 'atk' || r.stat === 'def' ? r.stat : undefined,
      value: r.value !== 0 ? r.value : undefined,
      duration: r.duration > 0 ? r.duration : undefined,
    };
    (out[r.skill] ??= []).push(fx);
  }
  return out;
}
