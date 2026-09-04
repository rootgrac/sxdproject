/**
 * 游戏会话控制器（M1-4 核心 + M2 养成操作层；纯逻辑、Cocos 外可测）。
 *
 * 职责：把「存档（KV + SaveManager）→ 养成系统 → 战斗」串成引擎可直接调用的会话：
 *  - 主界面：slotList()；newGame / continue 进出游戏
 *  - 主线：currentStage() / buildBattle() / onBattleWin|Lose()
 *  - M2：招募（单抽/十连+自动入队上阵）、打造并穿戴、强化主角武器、商店购买、
 *        精英副本（次数/掉落）；全部操作落内存档并 flushNow（§3.5-1 关键节点即写）
 *  - 出阵组队：主角(固定 u001) + 伙伴槽（空槽回退默认同伴 u002/u003）
 *
 * 随机源 rand 注入（默认 Math.random）；日期键按本地时区（每日状态惰性重置）。
 */
import { KvSaveStore } from '../../framework/save/save-core';
import type { KeyValueStorage, SaveData } from '../../framework/save/save-core';
import { SaveManager } from '../../framework/save/save-manager';
import { SlotManager } from '../../framework/save/slot-manager';
import type { ManualSlot } from '../../framework/save/slot-manager';
import { buildEffects, buildUnits } from '../../battle-core/src/setup';
import type { SkillEffectDef, Unit } from '../../battle-core/src/model';
import type { SkillEffectRow, SkillRow, UnitRow } from '../../battle-core/src/setup';
import type { RoleState } from '../role/role-core';
import { clearStage, findStage } from '../stage/stage-core';
import type { StageRow } from '../stage/stage-core';
import { addPartner, findPartner, setPartnerSlot } from '../partner/partner-core';
import type { PartnerState, PartyState } from '../partner/partner-core';
import { RecruitHall } from '../partner/recruit-core';
import type { RecruitCfgRow, RecruitEntryRow } from '../partner/recruit-core';
import { addItem, countOf } from '../item/item-core';
import type { BagItem, ItemDefRow } from '../item/item-core';
import { craft, canCraft } from '../equip/craft-core';
import type { CraftRow } from '../equip/craft-core';
import { enhanceCost, enhanceItem, equipTo } from '../equip/equip-core';
import type { EquipDefRow, EquipState } from '../equip/equip-core';
import { buy } from '../shop/shop-core';
import type { ShopRow } from '../shop/shop-core';
import { grantRewards, recordChallenge, remainingToday, rollDay } from '../stage/elite-core';
import type { DailyState, EliteRewardRow, EliteRow } from '../stage/elite-core';

/** 游戏所需全部配置行（Cocos resources / 测试注入） */
export interface GameConfigs {
  units: UnitRow[];
  skills: SkillRow[];
  effectRows: SkillEffectRow[];
  stages: StageRow[];
  recruit: RecruitEntryRow[];
  recruitCfg: RecruitCfgRow;
  equip: EquipDefRow[];
  item: ItemDefRow[];
  craft: CraftRow[];
  shop: ShopRow[];
  elite: EliteRow[];
  eliteReward: EliteRewardRow[];
}

/** 主角固定 unit */
export const HERO_UNIT = 'u001';
/** 默认同伴（伙伴槽空时的回退出战） */
export const FALLBACK_PARTNERS = ['u002', 'u003'];

export interface SessionSnapshot {
  slot: ManualSlot;
  name: string;
  level: number;
  realm: number;
  exp: number;
  copper: number;
  chapter: number;
  node: number;
}

export interface RecruitDone {
  results: { unit: string; rarity: number }[];
  joined: string[]; // 新伙伴展示名
}

export class GameSession {
  private readonly storage: KeyValueStorage;
  private readonly configs: GameConfigs;
  private readonly skillEffects: Record<string, SkillEffectDef[]>;
  private readonly now: () => number;
  private readonly rand: () => number;
  private readonly slots: SlotManager;
  private readonly recruitHall: RecruitHall;
  private manager: SaveManager | null = null;
  private data: SaveData | null = null;
  private currentSlot: ManualSlot = 'slot1';
  private uidSeq = 0;

  constructor(storage: KeyValueStorage, configs: GameConfigs, now?: () => number, rand?: () => number) {
    this.storage = storage;
    this.configs = configs;
    this.now = now ?? Date.now;
    this.rand = rand ?? Math.random;
    this.slots = new SlotManager(storage);
    this.skillEffects = buildEffects(configs.effectRows);
    this.recruitHall = new RecruitHall(
      configs.recruitCfg,
      configs.recruit,
      new Map(configs.units.map((u) => [u.id, u.recruit_level ?? 0])),
    );
  }

  configsOf(): GameConfigs {
    return this.configs;
  }

  slotList(): ReturnType<SlotManager['list']> {
    return this.slots.list();
  }

  isInGame(): boolean {
    return this.data !== null;
  }

  snapshot(): SessionSnapshot {
    if (!this.data) throw new Error('未进入游戏');
    const { player, progress } = this.data;
    return {
      slot: this.currentSlot,
      name: player.name,
      level: player.level,
      realm: player.realm,
      exp: player.exp,
      copper: player.copper,
      chapter: progress.chapter,
      node: progress.node,
    };
  }

  newGame(slot: ManualSlot, name: string): SessionSnapshot {
    this.slots.create(slot, name);
    if (!this.enter(slot)) throw new Error(`槽位 ${slot} 初始化失败`);
    return this.snapshot();
  }

  continue(slot: ManualSlot): SessionSnapshot | null {
    return this.enter(slot) ? this.snapshot() : null;
  }

  private enter(slot: ManualSlot): boolean {
    const manager = new SaveManager({ store: new KvSaveStore(this.storage, slot), now: this.now });
    const data = manager.load();
    if (!data) return false;
    this.currentSlot = slot;
    this.manager = manager;
    this.data = data;
    return true;
  }

  tick(): boolean {
    return this.manager?.tick(this.now()) ?? false;
  }

  flushNow(): boolean {
    return this.manager?.flushNow() ?? false;
  }

  private guardData(): SaveData {
    if (!this.data) throw new Error('未进入游戏');
    return this.data;
  }

  private nextUid(): string {
    this.uidSeq += 1;
    return `p${this.uidSeq}`;
  }

  /** 本地日期键（YYYY-MM-DD） */
  private dateKeyOf(): string {
    const d = new Date(this.now());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  // ── 主线（M1）──────────────────────────────────────────────

  currentStage(): StageRow | null {
    const data = this.guardData();
    const { chapter, node } = data.progress;
    return node === 0 ? null : (findStage(this.configs.stages, chapter, node) ?? null);
  }

  /** 出战队伍：主角 + 伙伴槽（空槽回退默认同伴） */
  private partyUnitRows(): UnitRow[] {
    const data = this.guardData();
    const byId = new Map(this.configs.units.map((u) => [u.id, u]));
    const slots = (data.party as PartyState).partnerSlots ?? [];
    const rows: UnitRow[] = [];
    const hero = byId.get(HERO_UNIT);
    if (hero) rows.push(hero);
    const partners = data.partners as PartnerState[];
    slots.forEach((uid, i) => {
      if (uid) {
        const p = findPartner(partners, uid);
        const def = p ? byId.get(p.unitId) : undefined;
        if (def) rows.push(def);
        else {
          const fb = byId.get(FALLBACK_PARTNERS[i] ?? '');
          if (fb) rows.push(fb);
        }
      } else {
        const fb = byId.get(FALLBACK_PARTNERS[i] ?? '');
        if (fb) rows.push(fb);
      }
    });
    return rows;
  }

  /** 由 unitId 列表构造敌方（带布阵：0 前排/1 中/2+ 后排） */
  private enemyUnits(ids: string[]): Unit[] {
    const byId = new Map(this.configs.units.map((u) => [u.id, u]));
    const rows = ids.map((id) => byId.get(id)).filter((u): u is UnitRow => u !== undefined);
    return buildUnits(rows, this.configs.skills, 'enemy').map((u, i) => ({ ...u, position: Math.min(i, 2) }));
  }

  buildBattle(): { allies: Unit[]; enemies: Unit[] } | null {
    const stage = this.currentStage();
    if (!stage) return null;
    const allyRows = this.partyUnitRows();
    const allies = buildUnits(allyRows, this.configs.skills, 'ally').map((u, i) => ({ ...u, position: i }));
    const enemyIds = Array.isArray(stage.enemies) ? stage.enemies : [stage.enemies];
    return { allies, enemies: this.enemyUnits(enemyIds) };
  }

  skillEffectsOf(): Record<string, SkillEffectDef[]> {
    return this.skillEffects;
  }

  onBattleWin(): void {
    const data = this.guardData();
    const stage = this.currentStage();
    if (!stage) throw new Error('无可结算关卡（章节已完成或目标缺失）');
    const player = data.player as RoleState & { copper: number };
    clearStage({ player, progress: data.progress }, this.configs.stages, stage);
    this.manager?.markDirty();
    this.flushNow();
  }

  onBattleLose(): void {
    // 无奖励，可重试
  }

  // ── 招募（M2-2）────────────────────────────────────────────

  recruit(mode: 'single' | 'ten'): RecruitDone {
    const data = this.guardData();
    const copper = data.player.copper;
    const outcome = this.recruitHall.recruit(
      {
        copper,
        playerLevel: data.player.level,
        ownedUnitIds: new Set((data.partners as PartnerState[]).map((p) => p.unitId)),
        rand: this.rand,
      },
      mode,
    );
    data.player.copper = outcome.cost === 0 ? copper : copper - outcome.cost;
    const byId = new Map(this.configs.units.map((u) => [u.id, u]));
    const joined: string[] = [];
    const partners = data.partners as PartnerState[];
    const party = data.party as PartyState;
    for (const r of outcome.results) {
      const def = byId.get(r.unit);
      const inst = {
        uid: this.nextUid(),
        unitId: r.unit,
        name: def?.name ?? r.unit,
        level: 1,
        exp: 0,
        realm: 0,
        quality: r.rarity - 1,
        joinAt: this.now(),
      } satisfies PartnerState;
      addPartner(partners, inst);
      joined.push(inst.name);
      // 自动放入第一个空槽（上阵）
      for (let i = 0; i < party.partnerSlots.length; i++) {
        if (party.partnerSlots[i] === null) {
          try {
            setPartnerSlot(party, partners, i, inst.uid);
          } catch {
            /* 槽位已占用则跳过 */
          }
          break;
        }
      }
    }
    this.manager?.markDirty();
    this.flushNow();
    return { results: outcome.results, joined };
  }

  // ── 商店 / 打造 / 强化（M2-3~5）───────────────────────────

  shopBuy(itemId: string, count = 1): { cost: number } {
    const data = this.guardData();
    const r = buy(this.configs.shop, data.bag as BagItem[], data.player, itemId, count);
    this.manager?.markDirty();
    this.flushNow();
    return { cost: r.cost };
  }

  /** 打造并自动穿到主角对应部位（自动换装卸旧） */
  craftAndEquipHero(equipId: string): EquipState {
    const data = this.guardData();
    const bag = data.bag as BagItem[];
    if (!canCraft(this.configs.craft, bag, equipId)) {
      throw new Error('材料不足，无法打造（材料来自精英副本与推图）');
    }
    const inst = craft(this.configs.craft, bag, equipId, this.nextUid());
    const equips = data.equips as EquipState[];
    equips.push(inst);
    equipTo(equips, inst, this.configs.equip, 'hero');
    this.manager?.markDirty();
    this.flushNow();
    return inst;
  }

  /** 强化主角身上第一件武器（费用自动扣除，上限随境界） */
  enhanceHeroWeapon(): { uid: string; enhance: number; cost: number } {
    const data = this.guardData();
    const equips = data.equips as EquipState[];
    const defs = this.configs.equip;
    const item = equips.find(
      (e) => e.owner === 'hero' && defs.find((d) => d.id === e.equipId)?.slot === 'weapon',
    );
    if (!item) throw new Error('主角未装备武器');
    const next = item.enhance + 1;
    const cost = enhanceCost(item.enhance);
    if (data.player.copper < cost) throw new Error(`铜钱不足（强化需 ${cost}）`);
    enhanceItem(item, data.player.realm); // 上限校验
    data.player.copper -= cost;
    this.manager?.markDirty();
    this.flushNow();
    return { uid: item.uid, enhance: item.enhance, cost };
  }

  /** 主角已穿戴装备摘要（UI 展示用） */
  heroEquipsView(): { slot: string; name: string; enhance: number }[] {
    const data = this.guardData();
    const equips = data.equips as EquipState[];
    const out: { slot: string; name: string; enhance: number }[] = [];
    for (const e of equips) {
      if (e.owner !== 'hero') continue;
      const def = this.configs.equip.find((d) => d.id === e.equipId);
      if (def) out.push({ slot: def.slot, name: def.name, enhance: e.enhance });
    }
    return out;
  }

  bagView(): { itemId: string; name: string; count: number }[] {
    const data = this.guardData();
    const names = new Map(this.configs.item.map((i) => [i.id, i.name]));
    return (data.bag as BagItem[]).map((b) => ({ itemId: b.itemId, name: names.get(b.itemId) ?? b.itemId, count: b.count }));
  }

  partnerView(): { uid: string; name: string; level: number; onField: boolean }[] {
    const data = this.guardData();
    const slots = (data.party as PartyState).partnerSlots ?? [];
    return (data.partners as PartnerState[]).map((p) => ({
      uid: p.uid,
      name: p.name,
      level: p.level,
      onField: slots.includes(p.uid),
    }));
  }

  // ── 精英副本（M2-6）────────────────────────────────────────

  eliteStatus(): { id: string; name: string; remaining: number; limit: number }[] {
    const data = this.guardData();
    const daily = data.daily as DailyState;
    const today = this.dateKeyOf();
    return this.configs.elite.map((e) => ({
      id: e.id,
      name: e.name,
      limit: e.daily_limit,
      remaining: remainingToday(daily, today, e),
    }));
  }

  buildEliteBattle(eliteId: string): { allies: Unit[]; enemies: Unit[] } {
    const elite = this.configs.elite.find((e) => e.id === eliteId);
    if (!elite) throw new Error(`精英副本不存在：${eliteId}`);
    const allyRows = this.partyUnitRows();
    const allies = buildUnits(allyRows, this.configs.skills, 'ally').map((u, i) => ({ ...u, position: i }));
    const enemyIds = Array.isArray(elite.enemies) ? elite.enemies : [elite.enemies];
    return { allies, enemies: this.enemyUnits(enemyIds) };
  }

  /** 精英胜利结算：扣次数 + 掉落入包 + 写盘 */
  onEliteWin(eliteId: string): void {
    const data = this.guardData();
    const elite = this.configs.elite.find((e) => e.id === eliteId);
    if (!elite) throw new Error(`精英副本不存在：${eliteId}`);
    rollDay(data.daily as DailyState, this.dateKeyOf());
    recordChallenge(data.daily as DailyState, this.dateKeyOf(), elite);
    grantRewards(data.bag as BagItem[], this.configs.eliteReward, eliteId);
    this.manager?.markDirty();
    this.flushNow();
  }

  /** 精英战败：不扣次数不发掉落 */
  onEliteLose(): void {
    // 无状态变化
  }
}
