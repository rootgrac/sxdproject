/**
 * 招贤阁招募核心（M2-2，§2.1 S4：声望门槛 + 单抽/十连 + 保底规则原创）。
 *
 * 规则（原创，数值表驱动可调）：
 * - 门槛：伙伴 recruit_level ≤ 主角等级才可被抽中（表驱动）
 * - 消耗：单抽 cost_single / 十连 cost_ten（铜钱，表驱动）
 * - 抽卡：按稀有度权重抽取 → 同稀有度内按权重取伙伴；已拥有的伙伴从池中排除
 * - 保底（原创）：十连的第 10 抽必中「当前可用最高稀有度」的未拥有伙伴
 * - 池空（可用稀有度均无可抽）时抛错，由 UI 提示「伙伴已集齐 / 等级不足」
 *
 * 随机源由调用方注入（rand: () => number ∈ [0,1)），战斗/招募共用确定性种子体系。
 * 纯函数、零 cc 依赖。
 */
export interface RecruitCfgRow {
  cost_single: number;
  cost_ten: number;
  guarantee_rarity: number;
}

export interface RecruitEntryRow {
  unit: string;
  weight: number;
  rarity: number;
}

/** unit 表行中招募门槛（部分字段即可） */
export interface UnitRecruitInfo {
  id: string;
  recruit_level: number;
}

export interface RecruitResult {
  unit: string;
  rarity: number;
}

export interface RecruitOutcome {
  results: RecruitResult[];
  cost: number;
  mode: 'single' | 'ten';
  /** 十连保底是否触发（第 10 抽强制最高稀有） */
  guaranteedHit: boolean;
}

export interface RecruitContext {
  copper: number;
  playerLevel: number;
  ownedUnitIds: ReadonlySet<string>;
  rand: () => number;
}

export class RecruitHall {
  private readonly cfg: RecruitCfgRow;
  private readonly pool: RecruitEntryRow[];
  /** unitId → 招募解锁等级（来自 unit 表 recruit_level） */
  private readonly levelOf: ReadonlyMap<string, number>;

  constructor(cfg: RecruitCfgRow, pool: RecruitEntryRow[], levelOf: ReadonlyMap<string, number>) {
    this.cfg = cfg;
    this.pool = pool;
    this.levelOf = levelOf;
  }

  /** 当前可用的池条目：门槛 ≤ 等级 且 未拥有 */
  private available(ctx: RecruitContext): RecruitEntryRow[] {
    return this.pool.filter((e) => {
      if (ctx.ownedUnitIds.has(e.unit)) return false;
      const need = this.levelOf.get(e.unit) ?? 0;
      return ctx.playerLevel >= need;
    });
  }

  /** 抽取单次；forcedRarity 非空时在该稀有度内抽取（保底用），否则按权重 */
  private drawOne(ctx: RecruitContext, avail: RecruitEntryRow[], forcedRarity: number | null): RecruitResult {
    if (forcedRarity !== null) {
      const bucket = avail.filter((e) => e.rarity === forcedRarity);
      if (bucket.length > 0) return this.pickByWeight(bucket, ctx.rand());
    }
    return this.pickByRarity(ctx.rand(), avail);
  }

  /** 按稀有度权重分层：先定稀有度（权重累计），再在稀有度内按权重取伙伴 */
  private pickByRarity(roll: number, avail: RecruitEntryRow[]): RecruitResult {
    const byRarity = new Map<number, RecruitEntryRow[]>();
    let total = 0;
    for (const e of avail) {
      const list = byRarity.get(e.rarity) ?? [];
      list.push(e);
      byRarity.set(e.rarity, list);
      total += e.weight;
    }
    if (total <= 0) throw new Error('招募池无可用条目');
    let cursor = roll * total;
    const rarities = [...byRarity.keys()].sort((a, b) => a - b);
    for (const r of rarities) {
      const list = byRarity.get(r) as RecruitEntryRow[];
      const sum = list.reduce((s, e) => s + e.weight, 0);
      if (cursor < sum) return this.pickByWeight(list, roll);
      cursor -= sum;
    }
    // 浮点兜底：取最高稀有
    const top = rarities[rarities.length - 1];
    return this.pickByWeight(byRarity.get(top) as RecruitEntryRow[], roll);
  }

  private pickByWeight(list: RecruitEntryRow[], roll: number): RecruitResult {
    const total = list.reduce((s, e) => s + e.weight, 0);
    let cursor = roll * total;
    for (const e of list) {
      if (cursor < e.weight) return { unit: e.unit, rarity: e.rarity };
      cursor -= e.weight;
    }
    const last = list[list.length - 1];
    return { unit: last.unit, rarity: last.rarity };
  }

  /** 最高可用稀有度（保底目标；无可抽条目返回 null） */
  private topRarity(avail: RecruitEntryRow[]): number | null {
    if (avail.length === 0) return null;
    let top = -Infinity;
    for (const e of avail) if (e.rarity > top) top = e.rarity;
    return top;
  }

  /**
   * 招募：mode = single（1 抽）/ ten（10 抽，第 10 抽保底最高稀有）。
   * 校验：铜钱足够、池中有可抽条目（等级门槛过滤后非空）。
   */
  recruit(ctx: RecruitContext, mode: 'single' | 'ten'): RecruitOutcome {
    const cost = mode === 'ten' ? this.cfg.cost_ten : this.cfg.cost_single;
    if (ctx.copper < cost) throw new Error(`铜钱不足（需 ${cost}）`);
    const avail = this.available(ctx);
    if (avail.length === 0) throw new Error('招贤阁暂无可用招募（伙伴已集齐或等级不足）');
    // 一次操作内不重复抽取（尚无重复转化机制），十连要求可用伙伴 ≥ 10
    if (mode === 'ten' && avail.length < 10) {
      throw new Error(`可用伙伴不足十位（当前 ${avail.length}），无法十连；请先单抽或提升等级`);
    }

    const count = mode === 'ten' ? 10 : 1;
    const results: RecruitResult[] = [];
    let guaranteedHit = false;
    for (let i = 0; i < count; i++) {
      // 每抽后从可用集移除已抽中者（一次操作内不重复）
      const still = avail.filter((e) => !results.some((r) => r.unit === e.unit));
      const isGuarantee = mode === 'ten' && i === count - 1;
      const forced = isGuarantee ? this.topRarity(still) : null;
      const pick = this.drawOne(ctx, still, forced);
      results.push(pick);
      if (isGuarantee && pick.rarity === this.topRarity(still)) guaranteedHit = true;
    }
    ctx.copper -= cost;
    return { results, cost, mode, guaranteedHit };
  }
}
