/**
 * BattleDemoBoot — M0 3v3 战斗演出 Demo 入口（占位美术版，开发文档 §4.1 M0 验收项）。
 *
 * 装配步骤（一次性，编辑器内操作，无需任何美术资源）：
 *   1. assets/scenes 右键 → 创建 → 场景，命名 Main，双击打开
 *   2. 层级管理器右键 → 创建 → UI 组件 → Canvas（若场景无 Canvas）
 *   3. 右键 Canvas → 创建空节点，命名 Demo
 *   4. 选中 Demo → 属性检查器 → 添加组件 → 自定义脚本 → BattleDemoBoot
 *   5. Ctrl+S 保存 → 点击顶部「预览」按钮（浏览器），自动播放一场 3v3 战斗
 *
 * 说明：
 *   - 结算由 battle-core（确定性内核）完成，本组件只消费事件流渲染（§3.4 表现/结算分离）
 *   - 全部 UI 运行时代码创建（无美术、无预制体），替换正式美术时仅改渲染层
 *   - 若编辑器报「找不到模块」，请确认 assets/scripts/battle-core 存在（tools/sync-battle-core.mjs 生成）
 */
import { _decorator, Color, Component, Graphics, Label, Node, UITransform } from 'cc';
import { runBattle } from '../../battle-core/src/engine';
import { makeUnit } from '../../battle-core/src/model';
import type { BattleEvent, Unit } from '../../battle-core/src/model';

const { ccclass } = _decorator;

const SEED = 20260904;
const STEP_SEC = 0.35;

const ALLY_COLOR = new Color(70, 130, 200, 255);
const ENEMY_COLOR = new Color(210, 80, 80, 255);
const DEAD_COLOR = new Color(120, 120, 120, 255);
const BG_COLOR = new Color(26, 24, 38, 255);
const TEXT_COLOR = new Color(240, 235, 225, 255);

@ccclass('BattleDemoBoot')
export class BattleDemoBoot extends Component {
  private blocks: Record<string, { g: Graphics; label: Label }> = {};
  private hpOf: Record<string, number> = {};
  private maxHpOf: Record<string, number> = {};
  private events: BattleEvent[] = [];
  private cursor = 0;
  private logLabels: Label[] = [];
  private logLines: string[] = [];
  private bigLabel: Label | null = null;
  private footLabel: Label | null = null;

  start(): void {
    this.buildBackground();
    this.buildTitle();
    this.logLabels = this.buildLogArea();
    this.bigLabel = this.buildBigLabel();
    this.footLabel = this.buildFooter();

    const allies = this.makeTeam('ally');
    const enemies = this.makeTeam('enemy');
    for (const u of [...allies, ...enemies]) {
      this.maxHpOf[u.id] = u.maxHp;
      this.hpOf[u.id] = u.maxHp;
    }
    // 敌方在屏幕上方一行（x 站位拉开），我方在下方一行
    this.spawnBlocks(enemies, ENEMY_COLOR, 160);
    this.spawnBlocks(allies, ALLY_COLOR, -160);

    this.events = runBattle({ seed: SEED, allies, enemies }).events;
    this.log(`✎ 种子 ${SEED} · 事件 ${this.events.length} 条，自动播放中…`);
    this.schedule(this.step, STEP_SEC);
  }

  private makeTeam(side: 'ally' | 'enemy'): Unit[] {
    const defs =
      side === 'ally'
        ? [
            { id: '云骞', hp: 1000, stats: { atk: 120, def: 60, spd: 110, acc: 1, eva: 0.05, crit: 0.15 } },
            { id: '洛璃', hp: 850, stats: { atk: 150, def: 40, spd: 125, acc: 0.95, eva: 0.1, crit: 0.05 } },
            { id: '沈砚', hp: 1200, stats: { atk: 90, def: 90, spd: 95, acc: 1, eva: 0.05, crit: 0.1 } },
          ]
        : [
            { id: '枯木妖', hp: 900, stats: { atk: 110, def: 50, spd: 100, acc: 0.9, eva: 0.15, crit: 0.05 } },
            { id: '赤目妖', hp: 800, stats: { atk: 130, def: 35, spd: 130, acc: 0.95, eva: 0.05, crit: 0.2 } },
            { id: '黑风妖', hp: 1000, stats: { atk: 100, def: 70, spd: 90, acc: 0.95, eva: 0.1, crit: 0.05 } },
          ];
    return defs.map((d) => makeUnit({ id: d.id, side, hp: d.hp, stats: d.stats }));
  }

  private spawnBlocks(units: Unit[], color: Color, rowY: number): void {
    const xs = [-240, 0, 240];
    units.forEach((u, i) => {
      const block = this.makeBlock(xs[i] ?? 0, rowY, u.id, color);
      this.blocks[u.id] = block;
      this.refreshBlock(u.id);
    });
  }

  private makeBlock(x: number, y: number, name: string, color: Color): { g: Graphics; label: Label } {
    const n = new Node(`block-${name}`);
    n.parent = this.node;
    n.setPosition(x, y, 0);
    n.addComponent(UITransform);
    const g = n.addComponent(Graphics);
    g.fillColor = color;
    g.rect(-32, -52, 64, 104);
    g.fill();
    const label = n.addComponent(Label);
    label.fontSize = 18;
    label.lineHeight = 22;
    label.color = TEXT_COLOR;
    return { g, label };
  }

  private refreshBlock(id: string): void {
    const b = this.blocks[id];
    if (!b) return;
    const hp = this.hpOf[id] ?? 0;
    if (hp <= 0) {
      b.label.string = `${id}\n☠ 已阵亡`;
      b.g.fillColor = DEAD_COLOR;
      b.g.clear();
      b.g.rect(-32, -52, 64, 104);
      b.g.fill();
    } else {
      b.label.string = `${id}\n${hp}/${this.maxHpOf[id]}`;
    }
  }

  private buildBackground(): void {
    const n = new Node('bg');
    n.parent = this.node;
    n.setPosition(0, 0, 0);
    n.addComponent(UITransform);
    const g = n.addComponent(Graphics);
    g.fillColor = BG_COLOR;
    g.rect(-800, -450, 1600, 900); // 大过常见设计分辨率，超出部分被裁剪
    g.fill();
  }

  private makeLabel(x: number, y: number, text: string, fontSize: number): Label {
    const n = new Node(`label-${y}`);
    n.parent = this.node;
    n.setPosition(x, y, 0);
    n.addComponent(UITransform);
    const l = n.addComponent(Label);
    l.fontSize = fontSize;
    l.lineHeight = Math.round(fontSize * 1.2);
    l.color = TEXT_COLOR;
    l.string = text;
    return l;
  }

  private buildTitle(): Label {
    return this.makeLabel(0, 306, '仙途 HD · M0 3v3 战斗演示（占位美术，数值未定稿）', 20);
  }

  private buildLogArea(): Label[] {
    // 3 行日志，位于敌方块上方
    const labels: Label[] = [];
    for (let i = 0; i < 3; i++) {
      labels.push(this.makeLabel(0, 250 - i * 22, '', 18));
    }
    return labels;
  }

  private buildBigLabel(): Label {
    return this.makeLabel(0, 0, '…', 30);
  }

  private buildFooter(): Label {
    return this.makeLabel(0, -306, '', 16);
  }

  private log(text: string): void {
    this.logLines.push(text);
    if (this.logLines.length > 6) this.logLines.splice(0, this.logLines.length - 6);
    const from = Math.max(0, this.logLines.length - 3);
    this.logLabels.forEach((l, i) => {
      l.string = this.logLines[from + i] ?? '';
    });
  }

  private setBig(text: string): void {
    if (this.bigLabel) this.bigLabel.string = text;
  }

  private step = (): void => {
    if (this.cursor >= this.events.length) {
      this.unschedule(this.step);
      const last = this.events[this.events.length - 1];
      const verdict =
        last.type === 'end'
          ? last.winner === 'ally'
            ? '我方获胜'
            : last.winner === 'enemy'
              ? '敌方获胜'
              : '平局（30 回合上限）'
          : '';
      this.setBig(`战斗结束：${verdict}（共 ${this.events.length} 条事件）`);
      if (this.footLabel) this.footLabel.string = '演示结束 · 刷新页面可重播（同种子结果一致）';
      return;
    }
    const ev = this.events[this.cursor++];
    if (ev.type === 'round') {
      this.log(`── 第 ${ev.round} 回合 ──`);
      return;
    }
    if (ev.type === 'end') {
      return; // end 由上面的收尾分支处理
    }
    if (ev.type === 'death') {
      this.log(`☠ ${ev.unit} 倒下了`);
      this.setBig(`☠ ${ev.unit} 倒下`);
      this.refreshBlock(ev.unit);
      return;
    }
    if (ev.type === 'skill') {
      this.log(`⚡ ${ev.actor} 释放绝技`);
      this.setBig(`⚡ ${ev.actor} 绝技迸发！`);
      return;
    }
    if (ev.type === 'effect') {
      if (ev.kind === 'damage') {
        this.hpOf[ev.target] = Math.max(0, (this.hpOf[ev.target] ?? 0) - (ev.damage ?? 0));
        this.log(`${ev.actor} 绝技命中 ${ev.target}，-${ev.damage}${ev.crit ? '【暴击】' : ''}`);
        this.setBig(`${ev.target} 受到 ${ev.damage} 点伤害${ev.crit ? ' 暴击！' : ''}`);
        this.refreshBlock(ev.target);
      } else if (ev.kind === 'heal') {
        const hp = Math.min(this.maxHpOf[ev.target] ?? 0, (this.hpOf[ev.target] ?? 0) + (ev.healing ?? 0));
        this.hpOf[ev.target] = hp;
        this.log(`✚ ${ev.target} 恢复 ${ev.healing} 点生命`);
        this.setBig(`✚ ${ev.target} 回春 +${ev.healing}`);
        this.refreshBlock(ev.target);
      } else if (ev.kind === 'buff' || ev.kind === 'debuff') {
        const sign = ev.kind === 'buff' ? '↑' : '↓';
        const pct = Math.round(Math.abs(ev.mult ?? 0) * 100);
        this.log(`${sign} ${ev.target} ${ev.stat} ${ev.kind === 'buff' ? '+' : '-'}${pct}%（持续 ${ev.untilRound !== undefined ? `至第 ${ev.untilRound - 1} 回合` : ''}）`);
        this.setBig(`${sign} ${ev.target} ${ev.kind === 'buff' ? '强化' : '弱化'} ${ev.stat} ${pct}%`);
      }
      return;
    }
    if (ev.type === 'attack') {
      if (!ev.hit) {
        this.log(`${ev.actor} 出手，被 ${ev.target} 闪避`);
        this.setBig(`☁ ${ev.target} 闪避了 ${ev.actor} 的攻击`);
      } else {
        this.hpOf[ev.target] = Math.max(0, (this.hpOf[ev.target] ?? 0) - ev.damage);
        this.log(`${ev.actor} 普攻 ${ev.target}，-${ev.damage}${ev.crit ? '【暴击】' : ''}`);
        this.setBig(`${ev.actor} → ${ev.target}：${ev.damage}${ev.crit ? ' 暴击！' : ''}`);
        this.refreshBlock(ev.target);
      }
      return;
    }
  };
}
