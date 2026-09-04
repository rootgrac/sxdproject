/**
 * 命格「观星」核心（M3-4，§2.1 S6 观星/星命原创包装）。
 * - 抽取：复用招贤池机制（权重 + 稀有度 + 十连第 10 抽保底最高稀有，规则同 RecruitHall）
 * - 重复处理（原创）：抽到已拥有命格 → 自动「精进」同名命格 +1 级（素材语义）
 * - 装配：8 槽；每槽放一个实例；主角独享（owner = hero，战斗加成）
 * - 套装：同 set_id 装配件数 ≥ need 时追加套装加成（fate_set.tsv）
 * - 属性：每件加成 stat × level（value 为每级值）
 * 纯逻辑、零 cc 依赖。
 */
export interface FateDefRow {
  id: string;
  name: string;
  stat: string; // atk | def | hp
  value: number;
  set_id: number;
  weight: number;
  rarity: number;
}

export interface FateSetRow {
  id: string;
  set_id: number;
  need: number;
  stat: string;
  value: number;
}

export interface FateCfgRow {
  cost_single: number;
  cost_ten: number;
  guarantee_rarity: number;
}

export interface FateState {
  uid: string;
  fateId: string;
  level: number; // ≥1
}

export const FATE_SLOT_COUNT = 8;

export function findFate(fates: FateState[], uid: string): FateState | undefined {
  return fates.find((x) => x.uid === uid);
}

export function fateDefOf(defs: FateDefRow[], fateId: string): FateDefRow {
  const d = defs.find((x) => x.id === fateId);
  if (!d) throw new Error(`命格不存在：${fateId}`);
  return d;
}

/** 同名已有 → 精进 +1 级；否则新增 level 1。返回事件描述 */
export function addFateOrEvolve(
  fates: FateState[],
  def: FateDefRow,
  newUid: string,
): { kind: 'new' | 'evolve'; uid: string; fateId: string; level: number } {
  const existing = fates.find((x) => x.fateId === def.id);
  if (existing) {
    existing.level += 1;
    return { kind: 'evolve', uid: existing.uid, fateId: existing.fateId, level: existing.level };
  }
  const inst: FateState = { uid: newUid, fateId: def.id, level: 1 };
  fates.push(inst);
  return { kind: 'new', uid: inst.uid, fateId: inst.fateId, level: inst.level };
}

/** 装配到指定槽（槽越界/占用抛错）；null = 卸下 */
export function setSlot(slots: (string | null)[], index: number, uid: string | null): void {
  if (index < 0 || index >= slots.length) throw new Error(`命格槽位越界：${index}`);
  slots[index] = uid;
}

/** 自动装入第一个空槽（满槽抛错由 UI 提示卸下） */
export function autoEquip(slots: (string | null)[], uid: string): void {
  const idx = slots.indexOf(null);
  if (idx < 0) throw new Error('命格槽已满（8/8），请先卸下一件');
  slots[idx] = uid;
}

/** 当前装配实例（损坏引用容错） */
export function equippedFates(fates: FateState[], slots: (string | null)[]): FateState[] {
  return slots
    .map((uid) => (uid === null ? null : (findFate(fates, uid) ?? null)))
    .filter((x): x is FateState => x !== null);
}

/** 主角命格总加成（单件 value×level 累加 + 套装件数达标追加） */
export function sumFateBonus(
  defs: FateDefRow[],
  setRows: FateSetRow[],
  fates: FateState[],
  slots: (string | null)[],
): { atk: number; def: number; hp: number } {
  const out = { atk: 0, def: 0, hp: 0 };
  const equipped = equippedFates(fates, slots);
  const setCount = new Map<number, number>();
  for (const f of equipped) {
    const d = defs.find((x) => x.id === f.fateId);
    if (!d) continue;
    const v = d.value * f.level;
    if (d.stat === 'atk') out.atk += v;
    else if (d.stat === 'def') out.def += v;
    else if (d.stat === 'hp') out.hp += v;
    if (d.set_id > 0) setCount.set(d.set_id, (setCount.get(d.set_id) ?? 0) + 1);
  }
  for (const row of setRows) {
    if ((setCount.get(row.set_id) ?? 0) >= row.need) {
      if (row.stat === 'atk') out.atk += row.value;
      else if (row.stat === 'def') out.def += row.value;
      else if (row.stat === 'hp') out.hp += row.value;
    }
  }
  return out;
}
