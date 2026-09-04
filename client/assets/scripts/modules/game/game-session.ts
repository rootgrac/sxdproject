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
import { claimAllMail, claimMail, listMail, sendMail } from '../mail/mail-core';
import type { MailboxState, MailEntry } from '../mail/mail-core';
import { claimBox, notifyTask, progressView } from '../task/task-core';
import type { DailyTasks, TaskBoxRow, TaskRow, TaskType } from '../task/task-core';
import { rewardOf, signIn, signInStatusOf } from '../task/signin-core';
import type { SignInRow } from '../task/signin-core';
import { addFateOrEvolve, autoEquip, equippedFates, sumFateBonus } from '../fate/fate-core';
import { sumBonus } from '../equip/equip-core';
import type { EquipDefRow } from '../equip/equip-core';
import { arenaRemaining, arenaWinsToday, recordArenaWin, scaleUnitRows } from '../arena/arena-core';
import type { ArenaRow } from '../arena/arena-core';
import { scanAchievements } from '../achievement/achievement-core';
import type { AchievementRow, AchievementStats } from '../achievement/achievement-core';
import type { FateCfgRow, FateDefRow, FateSetRow, FateState } from '../fate/fate-core';
import type { EquipState } from '../equip/equip-core';

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
  tasks: TaskRow[];
  taskBox: TaskBoxRow[];
  signIn: SignInRow[];
  fate: FateDefRow[];
  fateSet: FateSetRow[];
  fateCfg: FateCfgRow;
  arena: ArenaRow[];
  achievements: AchievementRow[];
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
  honor: number;
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
  private readonly fateHall: RecruitHall;
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
    // 观星池：命格表行直接作为抽取条目（无等级门槛）
    this.fateHall = new RecruitHall(
      configs.fateCfg,
      configs.fate.map((f) => ({ unit: f.id, weight: f.weight, rarity: f.rarity })),
      new Map<string, number>(),
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
      honor: player.honor,
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

  /** daily 视图（v5 全字段） */
  private dailyOf(): DailyTasks {
    return this.guardData().daily as unknown as DailyTasks;
  }

  /** 每日任务事件通知（跨日惰性重置由 task-core 处理） */
  private notifyToday(type: TaskType): void {
    notifyTask(this.dailyOf(), this.dateKeyOf(), this.configs.tasks, type);
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

  /** 我方出阵（含主角装备/命格加成）——主线与竞技场共用 */
  private battleAllies(): Unit[] {
    const allyRows = this.partyUnitRows();
    const heroB = this.heroBonuses();
    const first = allyRows[0];
    const boosted = first
      ? [{ ...first, hp: first.hp + heroB.hp, atk: first.atk + heroB.atk, def: first.def + heroB.def }, ...allyRows.slice(1)]
      : allyRows;
    return buildUnits(boosted, this.configs.skills, 'ally').map((u, i) => ({ ...u, position: i }));
  }

  buildBattle(): { allies: Unit[]; enemies: Unit[] } | null {
    const stage = this.currentStage();
    if (!stage) return null;
    const enemyIds = Array.isArray(stage.enemies) ? stage.enemies : [stage.enemies];
    return { allies: this.battleAllies(), enemies: this.enemyUnits(enemyIds) };
  }

  /** 主角养成加成（已穿装备 + 装配命格） */
  heroBonuses(): { atk: number; def: number; hp: number } {
    const data = this.guardData();
    const equipB = sumBonus(this.configs.equip, data.equips as EquipState[], 'hero');
    const fateB = sumFateBonus(
      this.configs.fate,
      this.configs.fateSet,
      data.fates as FateState[],
      data.fateParty.slots as (string | null)[],
    );
    return { atk: equipB.atk + fateB.atk, def: equipB.def + fateB.def, hp: equipB.hp + fateB.hp };
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
    this.notifyToday('stage_win');
    this.maybeScanAchievements();
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
    this.notifyToday('recruit');
    this.manager?.markDirty();
    this.flushNow();
    this.maybeScanAchievements();
    return { results: outcome.results, joined };
  }

  // ── 商店 / 打造 / 强化（M2-3~5）───────────────────────────

  shopBuy(itemId: string, count = 1): { cost: number } {
    const data = this.guardData();
    const r = buy(this.configs.shop, data.bag as BagItem[], data.player, itemId, count);
    this.notifyToday('shop');
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
    this.notifyToday('craft');
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
    this.notifyToday('enhance');
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
    this.notifyToday('elite_win');
    this.maybeScanAchievements();
    this.manager?.markDirty();
    this.flushNow();
  }

  /** 精英战败：不扣次数不发掉落 */
  onEliteLose(): void {
    // 无状态变化
  }

  // ── 任务 / 签到 / 信箱（M3）──────────────────────────────

  taskView(): { id: string; name: string; current: number; target: number; done: boolean; active: number }[] {
    return progressView(this.dailyOf(), this.dateKeyOf(), this.configs.tasks);
  }

  activeToday(): number {
    return this.taskView().reduce((s, v) => s + (v.done ? v.active : 0), 0);
  }

  /** 领取活跃宝箱档位（copper 入账） */
  claimActiveBox(threshold: number): boolean {
    const data = this.guardData();
    const r = claimBox(this.dailyOf(), this.dateKeyOf(), this.configs.tasks, this.configs.taskBox, data.player, threshold);
    this.manager?.markDirty();
    this.flushNow();
    return r;
  }

  signInStatus(): { signedToday: boolean; streak: number; nextDay: number } {
    return signInStatusOf(this.dailyOf(), this.dateKeyOf());
  }

  /** 签到：按表发放当日奖励（连续天数 1..7 循环，断签重置） */
  signInNow(): { day: number; streak: number; copper: number; item: string } {
    const data = this.guardData();
    const today = this.dateKeyOf();
    const r = signIn(this.dailyOf(), today);
    const reward = rewardOf(this.configs.signIn, r.day);
    data.player.copper += reward.copper;
    if (reward.item) addItem(data.bag as BagItem[], reward.item, 1);
    this.manager?.markDirty();
    this.flushNow();
    this.maybeScanAchievements();
    return { day: r.day, streak: r.streak, copper: reward.copper, item: reward.item };
  }

  /** 信箱摘要（未读标记） */
  mailView(): { id: string; title: string; unclaimed: boolean }[] {
    const mb = this.guardData().mailbox as MailEntry[];
    const now = this.now();
    return listMail({ mailbox: mb }, now).map((m) => ({ id: m.id, title: m.title, unclaimed: m.claimedAt === null }));
  }

  /** 系统发放一封奖励邮件（任务/活动/补偿入口） */
  sendRewardMail(id: string, title: string, attachments: { kind: 'item' | 'copper'; itemId?: string; count: number }[]): void {
    const mb = this.guardData().mailbox as MailEntry[];
    const now = this.now();
    sendMail({ mailbox: mb }, { id, title, body: '', attachments, claimedAt: null, expiresAt: null, createdAt: now });
    this.manager?.markDirty();
    this.flushNow();
  }

  /** 批量领取全部附件（返回领取封数） */
  claimMailsAll(): number {
    const data = this.guardData();
    const n = claimAllMail({ mailbox: data.mailbox as MailEntry[] }, data.bag as BagItem[], data.player, this.now());
    if (n > 0) {
      this.manager?.markDirty();
      this.flushNow();
    }
    return n;
  }

  // ── 观星 / 命格（M3-4）───────────────────────────────────

  /**
   * 观星：单抽/十连（十连保底最高稀有，机制同招贤）；
   * 结果处理：新命格 → 入收藏并自动装配；已拥有 → 自动精进同名 +1 级。
   */
  observeFate(mode: 'single' | 'ten'): { results: { fateId: string; rarity: number }[]; events: { kind: 'new' | 'evolve'; name: string; level: number }[]; cost: number } {
    const data = this.guardData();
    const wallet = { copper: data.player.copper };
    const outcome = this.fateHall.recruit({ copper: wallet.copper, playerLevel: 1, ownedUnitIds: new Set(), rand: this.rand }, mode);
    wallet.copper -= outcome.cost;
    data.player.copper = wallet.copper;
    const fates = data.fates as FateState[];
    const slots = data.fateParty.slots as (string | null)[];
    const byId = new Map(this.configs.fate.map((f) => [f.id, f]));
    const events: { kind: 'new' | 'evolve'; name: string; level: number }[] = [];
    for (const r of outcome.results) {
      const def = byId.get(r.unit);
      if (!def) continue;
      const ev = addFateOrEvolve(fates, def, this.nextUid());
      events.push({ kind: ev.kind, name: def.name, level: ev.level });
      if (ev.kind === 'new') {
        try {
          autoEquip(slots, ev.uid); // 自动装配（满槽忽略，UI 可卸）
        } catch {
          // 槽满：仅收藏
        }
      }
    }
    this.manager?.markDirty();
    this.flushNow();
    this.maybeScanAchievements();
    return { results: outcome.results.map((x) => ({ fateId: x.unit, rarity: x.rarity })), events, cost: outcome.cost };
  }

  /** 命格视图：装配槽 + 总加成 */
  fateView(): { equipped: { name: string; level: number }[]; empty: number; bonus: { atk: number; def: number; hp: number } } {
    const data = this.guardData();
    const byId = new Map(this.configs.fate.map((f) => [f.id, f]));
    const equipped = equippedFates(data.fates as FateState[], data.fateParty.slots as (string | null)[])
      .map((f) => ({ name: byId.get(f.fateId)?.name ?? f.fateId, level: f.level }));
    const empty = (data.fateParty.slots as (string | null)[]).filter((s) => s === null).length;
    return { equipped, empty, bonus: this.heroBonuses() };
  }

  /** 卸下指定槽命格 */
  unequipFateSlot(index: number): void {
    const data = this.guardData();
    const slots = data.fateParty.slots as (string | null)[];
    if (index < 0 || index >= slots.length) throw new Error(`命格槽位越界：${index}`);
    slots[index] = null;
    this.manager?.markDirty();
    this.flushNow();
  }

  // ── 竞技场（M3-5）────────────────────────────────────────

  arenaStatus(): { id: string; name: string; scale: number; rewardCopper: number; honor: number }[] {
    return this.configs.arena.map((a) => ({
      id: a.id,
      name: a.name,
      scale: a.scale,
      rewardCopper: a.reward_copper,
      honor: a.honor,
    }));
  }

  arenaRemainingToday(): number {
    const daily = this.dailyOf();
    rollDay(daily as DailyState, this.dateKeyOf());
    return arenaRemaining(daily.elites);
  }

  /** 挑战镜像：返回战斗双方（次数不足抛错；胜负结算见 arenaWin/arenaLose） */
  arenaBattle(id: string): { allies: Unit[]; enemies: Unit[] } {
    const row = this.configs.arena.find((a) => a.id === id);
    if (!row) throw new Error(`竞技场镜像不存在：${id}`);
    if (this.arenaRemainingToday() <= 0) throw new Error('今日胜场已满，明日再来');
    const ids = Array.isArray(row.units) ? row.units : [row.units];
    const scaled = scaleUnitRows(this.configs.units, ids, row.scale);
    const enemies = buildUnits(scaled, this.configs.skills, 'enemy').map((u, i) => ({ ...u, position: Math.min(i, 2) }));
    return { allies: this.battleAllies(), enemies };
  }

  /** 竞技胜利：记录胜场 + 铜钱/荣誉奖励 + 成就扫描 */
  arenaWin(id: string): { copper: number; honor: number; achievements: string[] } {
    const data = this.guardData();
    const row = this.configs.arena.find((a) => a.id === id);
    if (!row) throw new Error(`竞技场镜像不存在：${id}`);
    const daily = this.dailyOf();
    rollDay(daily as DailyState, this.dateKeyOf());
    recordArenaWin(daily.elites); // 上限校验
    data.player.copper += row.reward_copper;
    data.player.honor += row.honor;
    const names = this.achievementScan();
    this.manager?.markDirty();
    this.flushNow();
    return { copper: row.reward_copper, honor: row.honor, achievements: names };
  }

  arenaLose(): void {
    // 败不扣胜场（可重试，同精英语义）
  }

  // ── 成就（M3-6）──────────────────────────────────────────

  private achievementStats(): AchievementStats {
    const data = this.guardData();
    return {
      level: data.player.level,
      realm: data.player.realm,
      partnerCount: (data.partners as PartnerState[]).length,
      fateCount: (data.fates as FateState[]).length,
      honor: data.player.honor,
    };
  }

  /** 轻量成就扫描（关键操作后自动调用；仅新解锁发邮件，幂等） */
  private maybeScanAchievements(): void {
    try {
      this.achievementScan();
    } catch {
      // 扫描失败不影响主流程
    }
  }

  /** 扫描并解锁新达标成就：奖励以系统邮件发放（邮箱领取），返回新达成名称 */
  achievementScan(): string[] {
    const data = this.guardData();
    const unlocked = data.achievements.unlocked as string[];
    const newly = scanAchievements(this.configs.achievements, unlocked, this.achievementStats());
    const names: string[] = [];
    for (const a of newly) {
      unlocked.push(a.id);
      names.push(a.name);
      this.sendRewardMail(`ach_${a.id}`, `成就达成：${a.name}`, [{ kind: 'copper', count: a.reward_copper }]);
    }
    if (newly.length > 0) {
      this.manager?.markDirty();
      this.flushNow();
    }
    return names;
  }

  achievementView(): { id: string; name: string; desc: string; unlocked: boolean; done: boolean }[] {
    const data = this.guardData();
    const unlocked = data.achievements.unlocked as string[];
    const stats = this.achievementStats();
    return this.configs.achievements.map((a) => ({
      id: a.id,
      name: a.name,
      desc: a.desc,
      unlocked: unlocked.includes(a.id),
      done: scanAchievements([a], [], stats).length > 0,
    }));
  }

  /** 图鉴视图（伙伴=可招募单位/装备/命格三类） */
  collectionView(): { key: string; title: string; progress: { owned: number; total: number; pct: number }; entries: { id: string; name: string; owned: boolean }[] }[] {
    const data = this.guardData();
    const partnerIds = new Set((data.partners as PartnerState[]).map((p) => p.unitId));
    const equipIds = new Set((data.equips as EquipState[]).map((e) => e.equipId));
    const fateIds = new Set((data.fates as FateState[]).map((f) => f.fateId));
    const recruitUnits = this.configs.units.filter((u) => (u.recruit_level ?? 0) > 0);
    const sets: { key: string; title: string; owned: ReadonlySet<string>; entries: { id: string; name: string }[] }[] = [
      { key: 'partner', title: '伙伴', owned: partnerIds, entries: recruitUnits.map((u) => ({ id: u.id, name: u.name })) },
      { key: 'equip', title: '装备', owned: equipIds, entries: this.configs.equip.map((e) => ({ id: e.id, name: e.name })) },
      { key: 'fate', title: '命格', owned: fateIds, entries: this.configs.fate.map((f) => ({ id: f.id, name: f.name })) },
    ];
    const countOwned = (owned: ReadonlySet<string>, all: { id: string }[]): number => all.filter((e) => owned.has(e.id)).length;
    return sets.map((s) => {
      const ownedCount = countOwned(s.owned, s.entries);
      return {
        key: s.key,
        title: s.title,
        progress: { owned: ownedCount, total: s.entries.length, pct: s.entries.length === 0 ? 0 : Math.round((ownedCount / s.entries.length) * 100) },
        entries: s.entries.map((e) => ({ ...e, owned: s.owned.has(e.id) })),
      };
    });
  }
}
