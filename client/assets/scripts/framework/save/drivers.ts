/**
 * KeyValueStorage 驱动（Cocos 运行时用）。
 * - 浏览器预览：localStorage（带前缀，避免与其他键冲突）
 * - 原生端（jsb）：将来接 sys.localStorage 或文件实现（接口不变）
 * node 单测使用内存实现（见 tools/client-core-test 内 MemoryKV）。
 */
import type { KeyValueStorage } from './save-core';

/** 浏览器 localStorage 驱动（预览/微信小游戏适用） */
export class LocalStorageKV implements KeyValueStorage {
  private readonly prefix: string;
  private readonly store: Storage;

  constructor(prefix = 'xiantu.save.', store?: Storage) {
    this.prefix = prefix;
    this.store = store ?? globalThis.localStorage;
    if (!this.store) {
      throw new Error('当前环境无 localStorage（原生端请接入 jsb 驱动）');
    }
  }

  private k(key: string): string {
    return this.prefix + key;
  }

  get(key: string): string | null {
    return this.store.getItem(this.k(key));
  }

  set(key: string, value: string): void {
    this.store.setItem(this.k(key), value);
  }

  remove(key: string): void {
    this.store.removeItem(this.k(key));
  }

  keys(): readonly string[] {
    const out: string[] = [];
    for (let i = 0; i < this.store.length; i++) {
      const full = this.store.key(i);
      if (full && full.startsWith(this.prefix)) out.push(full.slice(this.prefix.length));
    }
    return out;
  }
}
