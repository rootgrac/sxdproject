/**
 * 游戏会话控制器（M1-4 引擎联调核心，纯逻辑、Cocos 外可测）。
 *
 * 职责：把「存档（KV + SaveManager）→ 角色养成 → 主线推进 → 战斗」串成引擎可直接调用的会话：
 *  - 主界面：slotList() 展示槽位
 *  - newGame(slot, name) / continue(slot)：加载存档到内存（单一数据源）
 *  - currentStage() 当前目标关；buildBattle() 构造战斗双方（配置驱动 + 布阵）
 *  - onBattleWin()：奖励结算 + 进度推进 + 标脏（引擎周期性 tick / 关键节点 flushNow 落盘）
 *  - onBattleLose()：无奖励（当前关可重试）
 *
 * 存储：每槽一组键（KvSaveStore + 备份轮换 + 校验迁移）；写盘调度见 SaveManager（§3.5-1）。
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

/** 游戏所需全部配置行（由 Cocos resources 或测试注入） */
export interface GameConfigs {
  units: UnitRow[];
  skills: SkillRow[];
  effectRows: SkillEffectRow[];
  stages: StageRow[];
}

/** 我方出战初始队规模：unit 表前 3 名（伙伴上阵 M2 扩展） */
export const PARTY_SIZE = 3;

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

export class GameSession {
  private readonly storage: KeyValueStorage;
  private readonly configs: GameConfigs;
  private readonly skillEffects: Record<string, SkillEffectDef[]>;
  private readonly now: () => number;
  private readonly slots: SlotManager;
  private manager: SaveManager | null = null;
  private data: SaveData | null = null;
  private currentSlot: ManualSlot = 'slot1';

  constructor(storage: KeyValueStorage, configs: GameConfigs, now?: () => number) {
    this.storage = storage;
    this.configs = configs;
    this.now = now ?? Date.now;
    this.slots = new SlotManager(storage);
    this.skillEffects = buildEffects(configs.effectRows);
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

  /** 新游戏：槽位占用时拒绝（UI 需先确认删除） */
  newGame(slot: ManualSlot, name: string): SessionSnapshot {
    this.slots.create(slot, name); // 立即落盘初始档（create 自带保护）
    if (!this.enter(slot)) throw new Error(`槽位 ${slot} 初始化失败`);
    return this.snapshot();
  }

  /** 继续游戏：无可用档返回 null（含损坏且无备份场景） */
  continue(slot: ManualSlot): SessionSnapshot | null {
    return this.enter(slot) ? this.snapshot() : null;
  }

  /**
   * 载入槽位为当前会话。数据唯一来源 = SaveManager 持有的内存档
   * （load 内含迁移/损坏回退语义），业务修改直接作用于 getData() 对象。
   */
  private enter(slot: ManualSlot): boolean {
    const manager = new SaveManager({
      store: new KvSaveStore(this.storage, slot),
      now: this.now,
    });
    const data = manager.load();
    if (!data) return false;
    this.currentSlot = slot;
    this.manager = manager;
    this.data = data;
    return true;
  }

  /** 周期性节拍：脏数据满 30s 批量写盘（引擎主循环调用） */
  tick(): boolean {
    return this.manager?.tick(this.now()) ?? false;
  }

  /** 关键节点立即写盘（结算后 / 退后台） */
  flushNow(): boolean {
    return this.manager?.flushNow() ?? false;
  }

  /** 当前目标关卡（node=0 表示章节已完成） */
  currentStage(): StageRow | null {
    if (!this.data) throw new Error('未进入游戏');
    const { chapter, node } = this.data.progress;
    return node === 0 ? null : (findStage(this.configs.stages, chapter, node) ?? null);
  }

  /** 构造战斗：我方 = 初始队（按 0..2 站位），敌方 = 关卡敌阵（前排 0，后列按序） */
  buildBattle(): { allies: Unit[]; enemies: Unit[] } | null {
    const stage = this.currentStage();
    if (!stage) return null;
    const party = this.configs.units.slice(0, PARTY_SIZE);
    const allies = buildUnits(party, this.configs.skills, 'ally').map((u, i) => ({ ...u, position: i }));
    const enemyIds = Array.isArray(stage.enemies) ? stage.enemies : [stage.enemies];
    const enemies = buildUnits(
      this.configs.units.filter((u) => enemyIds.includes(u.id)),
      this.configs.skills,
      'enemy',
    ).map((u, i) => ({ ...u, position: i === 0 ? 0 : i === 1 ? 1 : 2 }));
    return { allies, enemies };
  }

  skillEffectsOf(): Record<string, SkillEffectDef[]> {
    return this.skillEffects;
  }

  /** 通关结算：奖励 + 进度推进 + 标脏（随后 tick/flushNow 落盘） */
  onBattleWin(): void {
    if (!this.data) throw new Error('未进入游戏');
    const stage = this.currentStage();
    if (!stage) throw new Error('无可结算关卡（章节已完成或目标缺失）');
    const player = this.data.player as RoleState & { copper: number };
    clearStage({ player, progress: this.data.progress }, this.configs.stages, stage);
    this.manager?.markDirty();
    this.flushNow(); // 关键节点立即写盘（§3.5-1）
  }

  /** 战败：无奖励（当前关可重试） */
  onBattleLose(): void {
    // 无状态变化；UI 引导重试
  }
}
