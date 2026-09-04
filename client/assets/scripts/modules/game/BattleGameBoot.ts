/**
 * BattleGameBoot — M1 可玩循环入口（占位美术版）：主菜单选档/新档 → 角色面板 → 挑战主线 → 结算写档。
 *
 * 装配步骤（一次性）：
 *   1. 在 Main.scene：把原挂载组件从 Demo 节点换成 BattleGameBoot（或在 Canvas 下新建空节点挂载，移除/停用旧 BattleDemoBoot 避免同屏）
 *   2. Ctrl+S → ▶ 预览（浏览器）
 *
 * 玩法验证（M1 DoD）：
 *   - 主菜单 3 槽：点「新档」输入名字（默认 青玄/云瑶/沈砚）或点「继续」进入
 *   - 面板显示 等级/境界/经验/铜钱/当前关卡；点「挑战」自动战斗（确定性 seed=关卡序号）
 *   - 胜利 → 奖励+推进+**flushNow 立即写盘**；战败可重试
 *   - 刷新页面（模拟杀进程）→「继续」→ 进度/铜钱/等级仍在（存档可靠性闭环）
 *
 * 数据流：BattleGameBoot(GUI) → GameSession(逻辑) → KvSaveStore+SaveManager(localStorage)（浏览器预览；
 * 原生端换 drivers.ts 的 jsb 实现）。
 */
import { _decorator, Color, Component, Graphics, JsonAsset, Label, Node, NodeEventType, resources, UITransform } from 'cc';
import { GameSession } from './game-session';
import type { GameConfigs, SessionSnapshot } from './game-session';
import type { ManualSlot } from '../../framework/save/slot-manager';
import { LocalStorageKV } from '../../framework/save/drivers';
import { runBattle } from '../../battle-core/src/engine';
import type { BattleEvent } from '../../battle-core/src/model';
import { REALM_NAMES } from '../role/role-core';
import { needsOf } from '../equip/craft-core';
import type { ItemDefRow } from '../item/item-core';

function itemNameOf(items: ItemDefRow[], itemId: string): string {
  return items.find((i) => i.id === itemId)?.name ?? itemId;
}

const { ccclass } = _decorator;

const BG_COLOR = new Color(24, 26, 38, 255);
const PANEL_COLOR = new Color(40, 44, 60, 255);
const BTN_COLOR = new Color(60, 84, 130, 255);
const BTN_HI = new Color(80, 120, 180, 255);
const TEXT_COLOR = new Color(240, 235, 225, 255);
const DIM_COLOR = new Color(170, 165, 155, 255);
const WIN_COLOR = new Color(120, 220, 140, 255);
const LOSE_COLOR = new Color(230, 120, 110, 255);

@ccclass('BattleGameBoot')
export class BattleGameBoot extends Component {
  private session: GameSession | null = null;
  private uiRoot: Node | null = null; // 动态 UI 全部挂此节点，切换视图时整树重建
  private busy = false;
  private logLabel: Label | null = null;
  private playButtons: Array<{ label: string; cb: () => void }> = [];

  start(): void {
    this.buildBackground();
    const loading = this.makeLabel(0, 0, '加载配置中…', 22);
    this.loadConfigs()
      .then((cfg) => {
        if (!this.isValid) return; // 组件销毁后不再继续
        loading.destroy();
        this.session = new GameSession(new LocalStorageKV(), cfg);
        this.renderMenu();
      })
      .catch((e: unknown) => {
        loading.string = `配置加载失败：${e instanceof Error ? e.message : String(e)}`;
      });
    // 30s 批量写盘节拍（脏数据落盘兜底）
    this.schedule(this.sessionTick, 5);
  }

  onDisable(): void {
    this.unschedule(this.sessionTick);
    this.flush();
  }

  private sessionTick = (): void => {
    this.session?.tick();
  };

  private flush(): void {
    try {
      this.session?.flushNow();
    } catch {
      // 兜底：写盘失败不打断退出
    }
  }

  private loadConfigs(): Promise<GameConfigs> {
    const load = (path: string): Promise<unknown> =>
      new Promise((resolve, reject) => {
        resources.load(path, JsonAsset, (err, asset) => {
          if (err) reject(err);
          else resolve((asset as JsonAsset).json);
        });
      });
    // 全部配置表（与 config/export 同步，共 12 个）
    return Promise.all([
      load('config/unit'),
      load('config/skill'),
      load('config/skill_effect'),
      load('config/stage'),
      load('config/recruit'),
      load('config/recruit_cfg'),
      load('config/equip'),
      load('config/item'),
      load('config/craft'),
      load('config/shop'),
      load('config/elite'),
      load('config/elite_reward'),
    ]).then(
      ([units, skills, effectRows, stages, recruit, recruitCfg, equip, item, craft, shop, elite, eliteReward]) => ({
        units: units as GameConfigs['units'],
        skills: skills as GameConfigs['skills'],
        effectRows: effectRows as GameConfigs['effectRows'],
        stages: stages as GameConfigs['stages'],
        recruit: recruit as GameConfigs['recruit'],
        recruitCfg: recruitCfg as GameConfigs['recruitCfg'],
        equip: equip as GameConfigs['equip'],
        item: item as GameConfigs['item'],
        craft: craft as GameConfigs['craft'],
        shop: shop as GameConfigs['shop'],
        elite: elite as GameConfigs['elite'],
        eliteReward: eliteReward as GameConfigs['eliteReward'],
      }),
    );
  }

  // ── UI 基建 ───────────────────────────────────────────────

  private buildBackground(): void {
    const n = new Node('bg');
    n.parent = this.node;
    n.setPosition(0, 0, 0);
    n.addComponent(UITransform);
    const g = n.addComponent(Graphics);
    g.fillColor = BG_COLOR;
    g.rect(-800, -450, 1600, 900);
    g.fill();
  }

  private makeLabel(x: number, y: number, text: string, fontSize: number, color: Color = TEXT_COLOR): Label {
    const n = new Node(`label@${y}`);
    n.parent = this.node;
    n.setPosition(x, y, 0);
    n.addComponent(UITransform);
    const l = n.addComponent(Label);
    l.fontSize = fontSize;
    l.lineHeight = Math.round(fontSize * 1.25);
    l.color = color;
    l.string = text;
    return l;
  }

  private makeButton(x: number, y: number, w: number, h: number, text: string, cb: () => void, color: Color = BTN_COLOR): Node {
    const n = new Node(`btn-${text}`);
    n.parent = this.node;
    n.setPosition(x, y, 0);
    const t = n.addComponent(UITransform);
    t.setContentSize(w, h);
    const g = n.addComponent(Graphics);
    const draw = (c: Color): void => {
      g.clear();
      g.fillColor = c;
      g.roundRect(-w / 2, -h / 2, w, h, 6);
      g.fill();
    };
    draw(color);
    const l = n.addComponent(Label);
    l.fontSize = 18;
    l.color = TEXT_COLOR;
    l.string = text;
    const down = (): void => draw(color === BTN_COLOR ? BTN_HI : color);
    const up = (): void => {
      draw(color);
      if (!this.busy) cb();
    };
    n.on(NodeEventType.TOUCH_START, down);
    n.on(NodeEventType.TOUCH_END, up);
    return n;
  }

  private clearUi(): void {
    for (const child of [...this.node.children]) {
      if (child.name !== 'bg') child.destroy();
    }
    this.playButtons = [];
    this.logLabel = null;
  }

  // ── 主菜单 ────────────────────────────────────────────────

  private renderMenu(): void {
    this.clearUi();
    const s = this.session;
    if (!s) return;
    this.makeLabel(0, 300, '仙途 HD · M1 主线闭环演示（存档+养成+推图）', 20);
    this.makeLabel(0, 268, '选择存档：没有有效档时点「新档」创建（同名槽位请先删除）', 14, DIM_COLOR);

    const slots = s.slotList();
    const slotNames: Record<string, string> = { slot1: '槽位一', slot2: '槽位二', slot3: '槽位三' };
    const manual = slots.filter((x) => x.slot !== 'auto');
    manual.forEach((info, i) => {
      const y = 180 - i * 80;
      const desc =
        info.state === 'ok'
          ? `${info.name} · Lv${info.level} · ${info.name ? `铜钱见详情` : ''}`
          : info.state === 'recoverable'
            ? '存档损坏（可自动恢复，点继续）'
            : info.state === 'corrupt'
              ? '存档损坏且无备份'
              : '空';
      this.makeLabel(-220, y, `${slotNames[info.slot]}：${desc}`, 16, info.state === 'ok' ? TEXT_COLOR : DIM_COLOR);
      const slot = info.slot as ManualSlot;
      this.makeButton(-40, y, 150, 44, '继续', () => this.tryContinue(slot));
      if (info.state !== 'ok' && info.state !== 'too-new') {
        this.makeButton(130, y, 150, 44, '新档', () => this.tryNewGame(slot));
      }
    });
    const auto = slots.find((x) => x.slot === 'auto');
    this.makeLabel(
      0,
      -100,
      auto && auto.state === 'ok' ? `自动档快照：${auto.name} Lv${auto.level}（通关后自动更新）` : '自动档：空',
      14,
      DIM_COLOR,
    );
  }

  private tryContinue(slot: ManualSlot): void {
    if (!this.session) return;
    const snap = this.session.continue(slot);
    if (!snap) {
      this.flashText('该槽位没有可用存档');
      this.renderMenu();
      return;
    }
    this.renderPlay(snap, '已读档，进度已恢复 ✅（含自动修复语义）');
  }

  private tryNewGame(slot: ManualSlot): void {
    if (!this.session) return;
    const names: Record<ManualSlot, string> = { slot1: '青玄', slot2: '云瑶', slot3: '沈砚' };
    const snap = this.session.newGame(slot, names[slot]);
    this.renderPlay(snap, '新旅途开始！');
  }

  private flashText(msg: string): void {
    if (this.logLabel) this.logLabel.string = msg;
  }

  // ── 游戏内面板 ────────────────────────────────────────────

  private renderPlay(snap: SessionSnapshot, note: string): void {
    this.clearUi();
    this.renderPlayView(snap, note);
  }

  /** 游戏内面板：进入本视图前总是清理旧 UI（防叠加；renderPlay/openHub 返回等入口共用） */
  private renderPlayView(snap: SessionSnapshot, note: string): void {
    this.clearUi();
    const s = this.session;
    if (!s) return;
    const done = snap.node === 0;
    const realmName = REALM_NAMES[snap.realm] ?? '?';
    this.makeLabel(0, 300, `【${snap.name}】Lv${snap.level} · ${realmName}`, 24);
    this.makeLabel(0, 268, `经验 ${snap.exp}/下一级 · 铜钱 ${snap.copper} · ${snap.slot}`, 15, DIM_COLOR);
    this.logLabel = this.makeLabel(0, 100, note, 16);
    const stage = s.currentStage();
    if (!stage) {
      this.makeLabel(0, 40, done ? '🏆 第一章已通关！' : '当前没有可挑战的关卡', 22, WIN_COLOR);
      this.makeButton(-120, -60, 200, 50, '回到主菜单', () => {
        this.flush();
        this.renderMenu();
      });
      return;
    }
    this.makeLabel(0, 40, `当前关卡：${stage.id}「${stage.name}」`, 20);
    this.makeButton(-230, -80, 180, 56, '⚔ 挑战', () => this.startBattle());
    this.makeButton(-20, -80, 160, 56, '🧘 修行', () => this.openHub('recruit'));
    this.makeButton(210, -80, 180, 56, '回主菜单', () => {
      this.flush();
      this.renderMenu();
    });
  }

  // ── 修行 Hub（M2：招贤/装备/精英/商店）───────────────────

  private hubErr: Label | null = null;

  private flash(msg: string): void {
    if (this.hubErr) this.hubErr.string = msg;
  }

  private openHub(tab: 'recruit' | 'equip' | 'elite' | 'shop'): void {
    const s = this.session;
    if (!s) return;
    this.clearUi();
    this.makeLabel(0, 306, '🧘 修行 · 养成（M2 演示）', 20);
    const snap = s.snapshot();
    const realmName = REALM_NAMES[snap.realm] ?? '?';
    const bag = s.bagView().map((b) => `${b.name}×${b.count}`).join(' ') || '（空）';
    const mates = s.partnerView().map((p) => (p.onField ? `★${p.name}` : p.name)).join('、') || '无';
    this.makeLabel(0, 276, `铜钱 ${snap.copper} · Lv${snap.level} ${realmName}`, 15, DIM_COLOR);
    this.makeLabel(0, 254, `伙伴：${mates} ｜ 背包：${bag}`, 13, DIM_COLOR);
    // 顶栏 Tab
    const tabs: Array<{ id: 'recruit' | 'equip' | 'elite' | 'shop'; label: string }> = [
      { id: 'recruit', label: '招贤' },
      { id: 'equip', label: '装备' },
      { id: 'elite', label: '精英' },
      { id: 'shop', label: '商店' },
    ];
    const xs = [-240, -80, 80, 240];
    tabs.forEach((t, i) => {
      const active = t.id === tab;
      this.makeButton(xs[i] ?? 0, 218, 140, 46, t.label, () => this.openHub(t.id), active ? BTN_HI : BTN_COLOR);
    });
    this.hubErr = this.makeLabel(0, -250, '', 15, LOSE_COLOR);
    this.makeButton(240, -306, 130, 44, '返回', () => this.renderPlayView(s.snapshot(), ''));
    if (tab === 'recruit') this.renderHubRecruit();
    else if (tab === 'equip') this.renderHubEquip();
    else if (tab === 'elite') this.renderHubElite();
    else this.renderHubShop();
  }

  private hubRow(y: number, text: string, btn: string | null, cb: (() => void) | null): void {
    this.makeLabel(-110, y, text, 15);
    if (btn && cb) this.makeButton(250, y, 170, 42, btn, cb);
  }

  private renderHubRecruit(): void {
    const s = this.session;
    if (!s) return;
    const cfg = s.configsOf();
    const rows: Array<{ text: string; btn: string | null; cb: (() => void) | null }> = [];
    rows.push({ text: `单抽 ${cfg.recruitCfg.cost_single} 铜 / 十连 ${cfg.recruitCfg.cost_ten} 铜（十连保底）`, btn: null, cb: null });
    for (const p of s.partnerView()) {
      rows.push({ text: `${p.onField ? '★' : ''}${p.name} Lv${p.level}${p.onField ? '（上阵）' : '（待命）'}`, btn: null, cb: null });
    }
    rows.push({ text: '单抽', btn: '单抽 1 次', cb: () => this.doRecruit('single') });
    rows.push({ text: '十连（第 10 抽保底高稀有）', btn: '十连', cb: () => this.doRecruit('ten') });
    this.renderHubList(rows);
  }

  private doRecruit(mode: 'single' | 'ten'): void {
    if (this.busy) return;
    this.busy = true;
    let msg = '';
    try {
      const r = this.session?.recruit(mode);
      msg = `招到：${r?.joined.join('、') ?? ''}${mode === 'ten' ? '（含保底）' : ''}`;
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    this.busy = false;
    this.openHub('recruit'); // 重绘刷新伙伴/铜钱
    this.flash(msg);
  }

  private renderHubEquip(): void {
    const s = this.session;
    if (!s) return;
    const cfg = s.configsOf();
    const rows: Array<{ text: string; btn: string | null; cb: (() => void) | null }> = [];
    for (const e of s.heroEquipsView()) {
      rows.push({ text: `${e.name}（${e.slot}）+${e.enhance}`, btn: e.slot === 'weapon' ? '强化武器' : null, cb: e.slot === 'weapon' ? () => this.doEnhance() : null });
    }
    for (const craftId of [...new Set(cfg.craft.map((c) => c.craft))]) {
      const def = cfg.equip.find((d) => d.id === craftId);
      if (!def) continue;
      const need = needsOf(cfg.craft, craftId).map((n) => `${itemNameOf(cfg.item, n.itemId)}×${n.count}`).join(' ');
      rows.push({ text: `${def.name}（${need}）`, btn: '打造并穿戴', cb: () => this.doCraft(craftId) });
    }
    this.renderHubList(rows);
  }

  private doCraft(equipId: string): void {
    if (this.busy) return;
    this.busy = true;
    let msg = '';
    try {
      const made = this.session?.craftAndEquipHero(equipId);
      msg = `打造成功：${made?.equipId}（已穿戴主角）`;
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    this.busy = false;
    this.openHub('equip');
    this.flash(msg);
  }

  private doEnhance(): void {
    if (this.busy) return;
    this.busy = true;
    let msg = '';
    try {
      const r = this.session?.enhanceHeroWeapon();
      msg = `强化成功 → +${r?.enhance}（花费 ${r?.cost} 铜）`;
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    this.busy = false;
    this.openHub('equip');
    this.flash(msg);
  }

  private renderHubElite(): void {
    const s = this.session;
    if (!s) return;
    const rows: Array<{ text: string; btn: string | null; cb: (() => void) | null }> = [];
    for (const e of s.eliteStatus()) {
      rows.push({
        text: `${e.name}（今日 ${e.remaining}/${e.limit} 次）`,
        btn: e.remaining > 0 ? '⚔ 挑战' : null,
        cb: e.remaining > 0 ? () => this.startElite(e.id) : null,
      });
    }
    this.renderHubList(rows);
  }

  private renderHubShop(): void {
    const s = this.session;
    if (!s) return;
    const cfg = s.configsOf();
    const rows: Array<{ text: string; btn: string | null; cb: (() => void) | null }> = [];
    for (const sh of cfg.shop) {
      rows.push({ text: `${itemNameOf(cfg.item, sh.item)}（${sh.cost} 铜）`, btn: '购买', cb: () => this.doBuy(sh.item) });
    }
    this.renderHubList(rows);
  }

  private doBuy(itemId: string): void {
    if (this.busy) return;
    this.busy = true;
    let msg = '';
    try {
      const r = this.session?.shopBuy(itemId, 1);
      msg = `已购买（花费 ${r?.cost} 铜）`;
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    this.busy = false;
    this.openHub('shop');
    this.flash(msg);
  }

  private renderHubList(rows: Array<{ text: string; btn: string | null; cb: (() => void) | null }>): void {
    const max = 8;
    const show = rows.slice(0, max);
    show.forEach((row, i) => {
      const y = 168 - i * 52;
      this.hubRow(y, row.text, row.btn, row.cb);
    });
    if (rows.length > max) this.hubRow(168 - max * 52 - 8, `…另有 ${rows.length - max} 项`, null, null);
  }

  // ── 战斗（自动播报）───────────────────────────────────────

  private startElite(eliteId: string): void {
    const s = this.session;
    if (!s || this.busy) return;
    const battle = s.buildEliteBattle(eliteId);
    const elite = s.configsOf().elite.find((e) => e.id === eliteId);
    if (!battle || !elite) return;
    this.busy = true;
    this.clearUi();
    this.makeLabel(0, 300, `挑战精英「${elite.name}」（今日剩余次数：${s.eliteStatus().find((x) => x.id === eliteId)?.remaining ?? '?'}）`, 18);
    this.logLabel = this.makeLabel(0, 40, '开战！', 18);
    const result = runBattle({
      seed: 8000 + eliteId.length * 17,
      allies: battle.allies,
      enemies: battle.enemies,
      skillEffects: s.skillEffectsOf(),
    });
    const win = result.winner === 'ally';
    const nameOf: Record<string, string> = {};
    for (const u of [...battle.allies, ...battle.enemies]) nameOf[u.id] = u.name;
    const lines = result.events.map((ev) => this.eventToText(ev, nameOf)).filter((t): t is string => t !== null);
    const show = lines.length > 30 ? [...lines.slice(0, 15), '…（战况激烈，略）…', ...lines.slice(-13)] : lines;

    let i = 0;
    const onTick = (): void => {
      if (!this.isValid) return;
      if (i < show.length) {
        this.logLabel!.string = show[i];
        i++;
        return;
      }
      this.unschedule(onTick);
      let msg = '战败…（不扣次数，可再战）';
      if (win) {
        try {
          s.onEliteWin(eliteId);
          const got = s.configsOf().eliteReward.filter((r) => r.elite === eliteId);
          msg = `胜利！获得：${got.map((r) => `${itemNameOf(s.configsOf().item, r.item)}×${r.count}`).join('、')}（次数 -1）`;
        } catch (e) {
          msg = `结算异常：${e instanceof Error ? e.message : String(e)}`;
        }
      }
      this.logLabel!.color = win ? WIN_COLOR : LOSE_COLOR;
      this.logLabel!.string = msg;
      this.busy = false;
      this.makeButton(0, -140, 260, 52, '返回修行', () => {
        this.openHub('elite');
      });
    };
    this.schedule(onTick, 0.3);
  }

  private startBattle(): void {
    const s = this.session;
    if (!s || this.busy) return;
    const battle = s.buildBattle();
    const stage = s.currentStage();
    if (!battle || !stage) return;
    this.busy = true;
    this.clearUi();

    this.makeLabel(0, 300, `挑战 ${stage.id}「${stage.name}」…`, 20);
    const seed = 1000 + stage.chapter * 100 + stage.node;
    this.logLabel = this.makeLabel(0, 40, '开战！', 18);

    // 战斗结算先行（确定性内核）
    const result = runBattle({ seed, allies: battle.allies, enemies: battle.enemies, skillEffects: s.skillEffectsOf() });
    const win = result.winner === 'ally';
    const nameOf: Record<string, string> = {};
    for (const u of [...battle.allies, ...battle.enemies]) nameOf[u.id] = u.name;
    const lines = result.events
      .map((ev) => this.eventToText(ev, nameOf))
      .filter((t): t is string => t !== null);
    // 每关最多播报 40 条，过长截取首尾
    const show = lines.length > 40 ? [...lines.slice(0, 20), '…（战况激烈，略）…', ...lines.slice(-18)] : lines;

    let i = 0;
    const onTick = (): void => {
      if (!this.isValid) return;
      if (i < show.length) {
        this.logLabel!.string = show[i];
        i++;
        return;
      }
      this.unschedule(onTick);
      if (win) {
        s.onBattleWin();
        const snap = s.snapshot();
        const realmName = REALM_NAMES[snap.realm] ?? '';
        const up = snap.level > 1 ? ` Lv${snap.level}` : '';
        this.logLabel!.color = WIN_COLOR;
        this.logLabel!.string = `胜利！+${stage.exp_reward} 经验 +${stage.copper_reward} 铜钱${up}（${realmName}）→ 已写档`;
      } else {
        this.logLabel!.color = LOSE_COLOR;
        this.logLabel!.string = '战败…（可再次挑战）';
      }
      this.busy = false; // 结算完成，解锁按钮（此前 busy 屏蔽全部触摸）
      this.makeButton(-120, -140, 220, 52, win ? '下一关 / 再战' : '再战', () => {
        this.busy = false;
        const s2 = this.session;
        if (s2) {
          const snap = s2.snapshot();
          this.renderPlayView(snap, win ? '进度已保存 ✅' : '重整旗鼓！');
        }
      });
      this.makeButton(140, -140, 180, 52, '回主菜单', () => {
        this.flush();
        this.busy = false;
        this.renderMenu();
      });
    };
    this.schedule(onTick, 0.3);
  }

  private eventToText(ev: BattleEvent, nameOf: Record<string, string>): string | null {
    const nm = (id: string): string => nameOf[id] ?? id;
    switch (ev.type) {
      case 'round':
        return `── 第 ${ev.round} 回合 ──`;
      case 'attack':
        if (!ev.hit) return `${nm(ev.actor)} 出手被 ${nm(ev.target)} 闪避！`;
        return `${nm(ev.actor)} 普攻 ${nm(ev.target)} -${ev.damage}${ev.crit ? '【暴击】' : ''}`;
      case 'skill':
        return `⚡ ${nm(ev.actor)} 释放绝技`;
      case 'effect':
        if (ev.kind === 'damage') return `  → ${nm(ev.target)} 受 ${ev.damage} 伤害${ev.crit ? '【暴击】' : ''}`;
        if (ev.kind === 'heal') return `  → ✚ ${nm(ev.target)} 回复 ${ev.healing}`;
        return `  → ${ev.kind === 'buff' ? '↑' : '↓'} ${nm(ev.target)} ${ev.stat} ${Math.round(Math.abs(ev.mult ?? 0) * 100)}%`;
      case 'death':
        return `☠ ${nm(ev.unit)} 阵亡`;
      case 'end':
        return null;
    }
  }
}
