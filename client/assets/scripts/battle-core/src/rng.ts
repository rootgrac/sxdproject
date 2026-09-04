/**
 * 确定性随机数（种子回放的基础设施，开发文档 §3.4）。
 * 使用 mulberry32：纯函数式 PRNG，任意整数种子 → 可复现的 [0,1) 序列。
 * 数值为占位实现，M1 前按数值定稿决定是否替换（同一输入必须产生同一结果）。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** 下一个 [0, 1) 均匀随机数 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [0, n) 整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** 以概率 p 命中 */
  chance(p: number): boolean {
    return this.next() < p;
  }
}
