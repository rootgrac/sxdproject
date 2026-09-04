/**
 * 存档内核 — Cocos 客户端适配版（M0 原型级，开发文档 §3.5）。
 *
 * 移植自 tools/save-prototype/src/core.ts（同一数据模型 / 版本 / 迁移链 / 可靠性语义），
 * 差异：
 *  - IO 走 KeyValueStorage 抽象：浏览器预览用 localStorage，原生端将来接 jsb（接口不变）
 *  - 哈希用自研同步实现 sha256.ts（Node crypto / WebCrypto 不可直接用于两端同步接口）
 *
 * 可靠性语义（与原型一致，原型 13 项测试在 tools/client-core-test 对拍）：
 *  - 写入先轮换备份（保留最近 keepBackups 份），再写主键（先 tmp 后 main，避免半写覆盖）
 *  - 主档损坏/被篡改（SHA-256 不匹配）→ 自动回退最近备份并修复主键
 *  - saveVersion 迁移链逐级升级；迁移前另存 backup_v{n}，迁移后立即写盘
 *  - 更高版本（too-new）档只读保护，create 拒绝覆盖
 */
import { sha256Hex } from './sha256';

export const CURRENT_SAVE_VERSION = 2;

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
  progress: { chapter: number; node: number; towerBest: number };
  achievements: { unlocked: string[]; claimed: string[] };
  mailbox: unknown[];
}

export function createSaveData(name = '无名散修'): SaveData {
  const now = Date.now();
  return {
    saveVersion: CURRENT_SAVE_VERSION,
    meta: { createdAt: now, playtimeSec: 0, lastSavedAt: now },
    player: { name, level: 1, exp: 0, realm: 0, copper: 0, gold: 0, stamina: 0, staminaTs: now },
    partners: [],
    equips: [],
    bag: [],
    progress: { chapter: 1, node: 1, towerBest: 0 },
    achievements: { unlocked: [], claimed: [] },
    mailbox: [],
  };
}

// ── 序列化与校验 ────────────────────────────────────────────

export function canonicalJson(data: unknown): string {
  return JSON.stringify(data);
}

/** 文件内容 = { data, sha256 }，sha256 为 data 规范化 JSON 的摘要 */
export function encodeFile(data: unknown): string {
  return JSON.stringify({ data, sha256: sha256Hex(canonicalJson(data)) });
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
  const actual = sha256Hex(canonicalJson(box.data));
  if (actual !== box.sha256) {
    throw new Error('存档校验和不匹配（文件损坏或被篡改）');
  }
  return { data: box.data as SaveData };
}

// ── 版本迁移链 ─────────────────────────────────────────────

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** key = 迁移前版本号，升级到 v+1；只加字段/改结构，不删旧字段（§5.5） */
const migrations: Record<number, Migration> = {
  // v1 → v2：新增 mailbox（本地系统信箱，§2.1 S10）
  1: (raw) => {
    const next = { ...raw, saveVersion: 2 };
    if (!Array.isArray(next.mailbox)) next.mailbox = [];
    return next;
  },
};

// ── 存储抽象 ───────────────────────────────────────────────

export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): readonly string[];
}

export type InspectState = 'ok' | 'empty' | 'corrupt' | 'recoverable' | 'too-new';

export interface SlotSummary {
  state: InspectState;
  name: string | null;
  level: number | null;
  lastSavedAt: number | null;
}

export interface ReadResult {
  data: SaveData;
  migrated: boolean;
  recovered: boolean;
}

/** 单槽位存取。一个槽位占一组键：slot.json / slot.backup-N.json / slot.backup_vN.json */
export class KvSaveStore {
  private readonly slot: string;
  private readonly keepBackups: number;
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage, slot = 'slot1', keepBackups = 2) {
    this.storage = storage;
    this.slot = slot;
    this.keepBackups = keepBackups;
  }

  private mainKey(): string {
    return `${this.slot}.json`;
  }

  private backupKey(i: number): string {
    return `${this.slot}.backup-${i}.json`;
  }

  private tmpKey(): string {
    return `${this.slot}.json.tmp`;
  }

  private snapshotKey(version: number): string {
    return `${this.slot}.backup_v${version}.json`;
  }

  private classify(key: string): { status: 'ok' | 'corrupt' | 'too-new' | 'absent'; data?: SaveData } {
    const raw = this.storage.get(key);
    if (raw === null) return { status: 'absent' };
    try {
      const { data } = decodeFile(raw);
      if (data.saveVersion > CURRENT_SAVE_VERSION) return { status: 'too-new', data };
      return { status: 'ok', data };
    } catch {
      return { status: 'corrupt' };
    }
  }

  exists(): boolean {
    return this.classify(this.mainKey()).status === 'ok';
  }

  summary(): SlotSummary {
    const main = this.classify(this.mainKey());
    const hasUsableBackup = (): boolean => {
      for (let i = 1; i <= this.keepBackups; i++) {
        if (this.classify(this.backupKey(i)).status === 'ok') return true;
      }
      return false;
    };
    const none = { name: null as string | null, level: null as number | null, lastSavedAt: null as number | null };
    if (main.status === 'ok' && main.data) {
      return {
        state: 'ok',
        name: main.data.player.name,
        level: main.data.player.level,
        lastSavedAt: main.data.meta.lastSavedAt,
      };
    }
    if (main.status === 'too-new') return { state: 'too-new', ...none };
    if (main.status === 'corrupt') return { state: hasUsableBackup() ? 'recoverable' : 'corrupt', ...none };
    return { state: hasUsableBackup() ? 'recoverable' : 'empty', ...none };
  }

  /** 写前轮换：主档 → backup-1 → backup-2 …（最旧淘汰） */
  private rotate(): void {
    if (this.storage.get(this.mainKey()) === null) return;
    for (let i = this.keepBackups; i >= 1; i--) {
      const to = this.backupKey(i);
      if (i === this.keepBackups) this.storage.remove(to);
      const from = i === 1 ? this.mainKey() : this.backupKey(i - 1);
      const val = this.storage.get(from);
      if (val !== null) {
        this.storage.set(to, val);
        if (i > 1) this.storage.remove(from);
      }
    }
  }

  /** 原子写入（近似）：先写 tmp 成功，再覆盖主键，最后清理 tmp */
  write(data: SaveData): void {
    this.rotate();
    const text = encodeFile(data);
    this.storage.set(this.tmpKey(), text);
    this.storage.set(this.mainKey(), text);
    this.storage.remove(this.tmpKey());
  }

  read(): ReadResult | null {
    const main = this.classify(this.mainKey());
    if (main.status === 'too-new') return null; // 更高版本写出的档：等升级版本读取，防降级
    if (main.status === 'ok' && main.data) return this.finalize(this.mainKey(), main.data, false);
    if (main.status === 'corrupt') this.storage.remove(this.mainKey()); // 损坏主档移出链路

    for (let i = 1; i <= this.keepBackups; i++) {
      const key = this.backupKey(i);
      const c = this.classify(key);
      if (c.status === 'corrupt') {
        this.storage.remove(key);
        continue;
      }
      if (c.status === 'ok' && c.data) return this.finalize(key, c.data, true);
    }
    return null;
  }

  private finalize(srcKey: string, data: SaveData, recovered: boolean): ReadResult {
    let migrated = false;
    if (data.saveVersion < CURRENT_SAVE_VERSION) {
      const fromV = data.saveVersion;
      const snap = this.snapshotKey(fromV);
      if (this.storage.get(snap) === null) {
        this.storage.set(snap, encodeFile(data)); // 迁移前自动另存原始档（§3.5-3）
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

  create(name?: string): SaveData {
    const c = this.classify(this.mainKey());
    if (c.status === 'ok' || c.status === 'too-new') {
      throw new Error('槽位已有存档，禁止直接覆盖（如需开新档请先确认删除）');
    }
    this.remove();
    const data = createSaveData(name);
    this.write(data);
    return data;
  }

  remove(): void {
    const prefix = this.slot + '.';
    for (const k of this.storage.keys()) {
      if (k === `${this.slot}.json` || (k.startsWith(prefix) && k.includes('.backup'))) {
        this.storage.remove(k);
      }
    }
  }
}
