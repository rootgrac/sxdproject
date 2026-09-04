/**
 * 存档内核原型（开发文档 §3.5 的最小闭环：原子写入 / SHA-256 校验 / 备份轮换 / 版本迁移）。
 *
 * 对应 §3.5 的可靠性要求：
 *  2. 写临时文件 → rename 原子覆盖；覆盖前把当前档轮换进 backups/（保留最近 keepBackups 份）
 *  3. saveVersion 迁移函数链逐级升级；迁移前自动另存 backup_v{n} 原始档，迁移后立即写盘
 *  4. 校验和 + 损坏自动回退（备份链内逐份尝试，恢复后回写主档）
 *
 * 移植注意（client 端）：
 * - node:crypto / node:fs 在 Cocos 原生端不可用，需替换为引擎能力（jsb 文件系统 + 自实现 SHA-256）
 *   —— 届时本文件的接口应保持不变，仅替换 IO 与哈希实现。
 * - 30 秒批量写盘 / 关键节点立即写盘属于运行时调度层（SaveManager），不在本内核。
 * - 每日重置/时间回拨容错属本地日历服务，不在本内核。
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const CURRENT_SAVE_VERSION = 4;

export interface SaveMeta {
  createdAt: number;
  playtimeSec: number;
  lastSavedAt: number;
}

export interface PlayerData {
  name: string;
  level: number;
  exp: number;
  realm: number;
  copper: number;
  gold: number;
  stamina: number;
  staminaTs: number;
}

export interface SaveData {
  saveVersion: number;
  meta: SaveMeta;
  player: PlayerData;
  partners: unknown[];
  equips: unknown[];
  bag: unknown[];
  /** M2 上阵配置：伙伴位（主角常驻不占位）；值为伙伴实例 uid（v3 起） */
  party: { partnerSlots: (string | null)[] };
  /** M2 每日状态（精英次数等；v4 起，按本地日历 dateKey 惰性重置） */
  daily: { dateKey: string; elites: Record<string, number> };
  progress: { chapter: number; node: number; towerBest: number };
  achievements: { unlocked: string[]; claimed: string[] };
  mailbox: unknown[];
}

/** 上阵伙伴位数量（主角 + N 伙伴出战） */
export const PARTNER_SLOT_COUNT = 2;

export function createSaveData(name = '无名散修'): SaveData {
  const now = Date.now();
  return {
    saveVersion: CURRENT_SAVE_VERSION,
    meta: { createdAt: now, playtimeSec: 0, lastSavedAt: now },
    player: { name, level: 1, exp: 0, realm: 0, copper: 0, gold: 0, stamina: 0, staminaTs: now },
    partners: [],
    equips: [],
    bag: [],
    party: { partnerSlots: [null, null] },
    daily: { dateKey: '', elites: {} },
    progress: { chapter: 1, node: 1, towerBest: 0 },
    achievements: { unlocked: [], claimed: [] },
    mailbox: [],
  };
}

// ── 序列化与校验 ────────────────────────────────────────────

export function canonicalJson(data: unknown): string {
  return JSON.stringify(data);
}

export function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 文件内容 = { data, sha256 }，sha256 为 data 规范化 JSON 的摘要 */
export function encodeFile(data: unknown): string {
  return JSON.stringify({ data, sha256: sha256Of(canonicalJson(data)) });
}

/** 解析并校验文件内容；损坏 / 篡改一律抛错 */
export function decodeFile(text: string): { data: SaveData } {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('存档文件 JSON 解析失败');
  }
  const box = obj as { data?: unknown; sha256?: unknown } | null;
  if (!box || typeof box !== 'object' || box.data === undefined || typeof box.sha256 !== 'string') {
    throw new Error('存档文件结构无效');
  }
  const actual = sha256Of(canonicalJson(box.data));
  if (actual !== box.sha256) {
    throw new Error('存档校验和不匹配（文件损坏或被篡改）');
  }
  return { data: box.data as SaveData };
}

// ── 版本迁移链 ─────────────────────────────────────────────

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** key = 迁移前版本号，升级到 v+1；每个版本的迁移只加字段/改结构，不删旧字段（§5.5 硬性要求） */
const migrations: Record<number, Migration> = {
  // v1 → v2：新增 mailbox（本地系统信箱，§2.1 S10）
  1: (raw) => {
    const next = { ...raw, saveVersion: 2 };
    if (!Array.isArray(next.mailbox)) next.mailbox = [];
    return next;
  },
  // v2 → v3：新增 party 上阵配置（M2 伙伴系统）
  2: (raw) => {
    const next = { ...raw, saveVersion: 3 };
    const party = raw.party as { partnerSlots?: unknown } | undefined;
    const slots = party && Array.isArray(party.partnerSlots) ? party.partnerSlots : [null, null];
    while (slots.length < PARTNER_SLOT_COUNT) slots.push(null);
    next.party = { partnerSlots: slots.slice(0, PARTNER_SLOT_COUNT) };
    return next;
  },
  // v3 → v4：新增 daily 每日状态（精英次数等；dateKey 为本地日期串）
  3: (raw) => {
    const next = { ...raw, saveVersion: 4 };
    const daily = raw.daily as { dateKey?: unknown; elites?: unknown } | undefined;
    const elites = daily && typeof daily.elites === 'object' && daily.elites !== null ? { ...(daily.elites as Record<string, number>) } : {};
    next.daily = { dateKey: (daily && typeof daily.dateKey === 'string' ? daily.dateKey : ''), elites };
    return next;
  },
};

// ── 存储 ───────────────────────────────────────────────────

export type SlotFileStatus = 'ok' | 'corrupt' | 'too-new' | 'absent';

/** 槽位只读状态（列表 UI 用；损坏但备份可用 = recoverable，读取时会自动修复） */
export type InspectState = 'ok' | 'empty' | 'corrupt' | 'recoverable' | 'too-new';

export interface SlotSummary {
  state: InspectState;
  name: string | null;
  level: number | null;
  lastSavedAt: number | null;
}

export interface ReadResult {
  data: SaveData;
  /** 是否经历了版本迁移（已迁移到 CURRENT_SAVE_VERSION 并写盘） */
  migrated: boolean;
  /** 主档损坏/缺失时是否从备份恢复并回写主档 */
  recovered: boolean;
}

export class SaveStore {
  private readonly dir: string;
  private readonly slot: string;
  private readonly keepBackups: number;

  constructor(dir: string, slot = 'slot1', keepBackups = 2) {
    this.dir = dir;
    this.slot = slot;
    this.keepBackups = keepBackups;
  }

  private pathOf(name: string): string {
    return join(this.dir, name);
  }

  private mainPath(): string {
    return this.pathOf(`${this.slot}.json`);
  }

  private backupPath(i: number): string {
    return this.pathOf(`${this.slot}.backup-${i}.json`);
  }

  exists(): boolean {
    return this.classify(this.mainPath()).status === 'ok';
  }

  private classify(p: string): { status: SlotFileStatus; data?: SaveData } {
    if (!existsSync(p)) return { status: 'absent' };
    let text: string;
    try {
      text = readFileSync(p, 'utf8');
    } catch {
      return { status: 'corrupt' };
    }
    try {
      const { data } = decodeFile(text);
      if (data.saveVersion > CURRENT_SAVE_VERSION) return { status: 'too-new', data };
      return { status: 'ok', data };
    } catch {
      return { status: 'corrupt' };
    }
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  /**
   * 只读状态检查：不删除、不修复、不写盘（列表 UI 用）。
   * 主档缺失/损坏但备份链有可用档 → 'recoverable'（read() 时会自动恢复并回写主档）。
   */
  summary(): SlotSummary {
    const main = this.classify(this.mainPath());
    const hasUsableBackup = (): boolean => {
      for (let i = 1; i <= this.keepBackups; i++) {
        if (this.classify(this.backupPath(i)).status === 'ok') return true;
      }
      return false;
    };
    if (main.status === 'ok' && main.data) {
      return {
        state: 'ok',
        name: main.data.player.name,
        level: main.data.player.level,
        lastSavedAt: main.data.meta.lastSavedAt,
      };
    }
    if (main.status === 'too-new') {
      // 更高版本写出的档：结构未知，仅展示状态（等待升级版本读取）
      return { state: 'too-new', name: null, level: null, lastSavedAt: null };
    }
    if (main.status === 'corrupt') {
      return {
        state: hasUsableBackup() ? 'recoverable' : 'corrupt',
        name: null,
        level: null,
        lastSavedAt: null,
      };
    }
    return {
      state: hasUsableBackup() ? 'recoverable' : 'empty',
      name: null,
      level: null,
      lastSavedAt: null,
    };
  }

  /** 覆盖前把当前主档轮换进备份链（保留最近 keepBackups 份） */
  private rotate(): void {
    const main = this.mainPath();
    if (!existsSync(main)) return;
    for (let i = this.keepBackups; i >= 1; i--) {
      const from = i === 1 ? main : this.backupPath(i - 1);
      const to = this.backupPath(i);
      if (i === this.keepBackups) rmSync(to, { force: true });
      if (existsSync(from)) renameSync(from, to);
    }
  }

  /** 原子写入：临时文件 + rename 覆盖 */
  write(data: SaveData): void {
    this.ensureDir();
    this.rotate();
    const tmp = this.mainPath() + '.tmp';
    writeFileSync(tmp, encodeFile(data), 'utf8');
    renameSync(tmp, this.mainPath());
  }

  /**
   * 版本迁移（若有）+ 写盘；损坏恢复（若有）并回写主档。
   * 返回迁移/恢复后的数据；全部无效返回 null。
   */
  read(): ReadResult | null {
    const main = this.mainPath();
    const cMain = this.classify(main);

    if (cMain.status === 'too-new') {
      // 由更高版本写出的存档：不读旧备份（避免把新档"降级"成旧数据），等待升级版本的游戏读取
      return null;
    }
    if (cMain.status === 'ok' && cMain.data) {
      return this.finalize(main, cMain.data, false);
    }
    if (cMain.status === 'corrupt') {
      rmSync(main, { force: true }); // 主档损坏移出链路，尝试备份
    }

    for (let i = 1; i <= this.keepBackups; i++) {
      const p = this.backupPath(i);
      const c = this.classify(p);
      if (c.status === 'corrupt') {
        rmSync(p, { force: true });
        continue;
      }
      if (c.status === 'ok' && c.data) {
        return this.finalize(p, c.data, true); // 从备份恢复 → 回写主档
      }
    }
    return null;
  }

  /** 迁移前自动另存 backup_v{n}；迁移后立即写盘（§3.5-3/4）；恢复时回写主档（§3.5-2） */
  private finalize(srcPath: string, data: SaveData, recovered: boolean): ReadResult {
    let migrated = false;
    if (data.saveVersion < CURRENT_SAVE_VERSION) {
      const fromV = data.saveVersion;
      const snapshot = this.pathOf(`${this.slot}.backup_v${fromV}.json`);
      if (!existsSync(snapshot)) {
        copyFileSync(srcPath, snapshot); // 保留迁移前的原始档，事故时可回退重迁（§5.5）
      }
      let cur: unknown = data;
      while ((cur as SaveData).saveVersion < CURRENT_SAVE_VERSION) {
        const v = (cur as SaveData).saveVersion;
        const fn = migrations[v];
        if (!fn) throw new Error(`缺少存档迁移函数 v${v} → v${v + 1}`);
        cur = fn(cur as Record<string, unknown>);
      }
      data = cur as SaveData;
      migrated = true;
    }
    if (recovered || migrated) this.write(data);
    return { data, migrated, recovered };
  }

  /** 新游戏：槽位已占用（含更高版本档）时拒绝，防止误覆盖；先清残留再写 */
  create(name?: string): SaveData {
    const c = this.classify(this.mainPath());
    if (c.status === 'ok' || c.status === 'too-new') {
      throw new Error('槽位已有存档，禁止直接覆盖（如需开新档请先确认删除）');
    }
    this.remove();
    const data = createSaveData(name);
    this.write(data);
    return data;
  }

  /** 删除槽位全部文件（主档 + 备份 + 迁移快照 + 残留临时文件） */
  remove(): void {
    if (!existsSync(this.dir)) return;
    for (const f of readdirSync(this.dir)) {
      if (f === `${this.slot}.json` || f.startsWith(`${this.slot}.backup`)) {
        rmSync(this.pathOf(f), { force: true });
      }
    }
  }
}
