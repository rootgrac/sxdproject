/**
 * 仙途 HD — M0 核心链路 CLI 演示（无引擎环境即可运行）
 *
 * 展示两条核心链路（对应 M0 验收 demo 的纯逻辑部分）：
 *   1. battle-core：3v3 确定性战斗 → 人类可读回放摘要（同 seed 必同结果）
 *   2. save-prototype：多槽位存档 → 自动档快照 → 文件损坏 → 自动回退修复
 *
 * 运行：node tools/m0-demo/run.ts
 */
import { runBattle } from '../../battle-core/src/engine.ts';
import { buildUnits } from '../../battle-core/src/setup.ts';
import type { SkillRow, UnitRow } from '../../battle-core/src/setup.ts';
import type { BattleEvent } from '../../battle-core/src/model.ts';
import { REALM_NAMES } from '../../client/assets/scripts/modules/role/role-core.ts';
import { clearStage, findStage } from '../../client/assets/scripts/modules/stage/stage-core.ts';
import type { StageClearContext, StageRow } from '../../client/assets/scripts/modules/stage/stage-core.ts';
import { AUTO_SLOT, SlotManager } from '../save-prototype/src/slots.ts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 1. 战斗回放演示（阵容由导出的配置表驱动，M1-3：改表 → 重导 → 本 demo 随之变化）──

const SEED = 20260904;
const HERE = dirname(fileURLToPath(import.meta.url));

function loadTables(): { unitRows: unknown[]; skillRows: unknown[]; stageRows: unknown[] } {
  const read = (name: string): unknown[] =>
    JSON.parse(readFileSync(join(HERE, '..', '..', 'config', 'export', `${name}.json`), 'utf8')) as unknown[];
  return { unitRows: read('unit'), skillRows: read('skill'), stageRows: read('stage') };
}

function demoBattle(): void {
  const { unitRows, skillRows } = loadTables();
  const units = buildUnits(unitRows as UnitRow[], skillRows as SkillRow[], 'ally'); // 先以 ally 侧构建全部，随后按序分队
  const allies = units.slice(0, 3).map((u) => ({ ...u, side: 'ally' as const }));
  const enemies = buildUnits(unitRows.slice(3) as UnitRow[], skillRows as SkillRow[], 'enemy');
  const names = (us: { name: string }[]) => us.map((u) => u.name).join('/');

  console.log(`[1] 战斗回放（3v3 · seed = ${SEED} · 配置源 config/export/unit.json + skill.json）`);
  console.log(`    我方 ${names(allies)} vs 敌方 ${names(enemies)}`);
  const result = runBattle({ seed: SEED, allies, enemies });
  let qiNote: Record<string, number> = {};
  const nameOf: Record<string, string> = {};
  for (const u of [...allies, ...enemies]) nameOf[u.id] = u.name;

  for (const ev of result.events) {
    const line = describeEvent(ev, qiNote, nameOf);
    if (line) console.log(line);
  }
  const verdict =
    result.winner === 'ally' ? '我方获胜' : result.winner === 'enemy' ? '敌方获胜' : '平局（超过回合上限）';
  console.log(`  战斗结束：${verdict}，共 ${result.rounds} 回合，事件 ${result.events.length} 条`);

  // 确定性复跑校验
  const again = runBattle({ seed: SEED, allies, enemies });
  const same = JSON.stringify(again.events) === JSON.stringify(result.events);
  console.log(`  同种子复跑结果一致性：${same ? '✅ 完全一致（可回放）' : '❌ 不一致！'}`);
}

function describeEvent(ev: BattleEvent, qiNote: Record<string, number>, nameOf: Record<string, string>): string | null {
  const nm = (id: string): string => nameOf[id] ?? id;
  switch (ev.type) {
    case 'round':
      return `\n── 第 ${ev.round} 回合 ──`;
    case 'attack':
      if (!ev.hit) return `  ${nm(ev.actor)} 出手，被 ${nm(ev.target)} 闪避！`;
      qiNote[ev.actor] = ev.actorQi;
      qiNote[ev.target] = ev.targetQi;
      return `  ${nm(ev.actor)} 普攻 ${nm(ev.target)}，造成 ${ev.damage} 伤害${ev.crit ? '【暴击】' : ''}（气 ${ev.actorQi}）`;
    case 'skill':
      qiNote[ev.actor] = ev.actorQi;
      qiNote[ev.target] = ev.targetQi;
      return `  ⚡ ${nm(ev.actor)} 绝技迸发！命中 ${nm(ev.target)}，造成 ${ev.damage} 伤害${ev.crit ? '【暴击】' : ''}`;
    case 'death':
      return `  ☠ ${nm(ev.unit)} 倒下了`;
    case 'end':
      return null;
  }
}

// ── 2. 存档可靠性演示 ───────────────────────────────────────

function demoSave(): void {
  const dir = mkdtempSync(join(tmpdir(), 'xiantu-demo-'));
  try {
    const mgr = new SlotManager(dir);
    console.log('\n[2] 存档可靠性（多槽位 + 原子写 + 校验 + 备份轮换 + 自动恢复）');
    console.log(`  存档目录：${dir}`);

    const s1 = mgr.create('slot1', '云骞'); // v0：铜钱 0
    s1.player.copper = 8888; // 首战奖励
    mgr.write('slot1', s1); // v1：8888（v0 轮换进 backup-1）
    s1.player.copper = 9999; // 关卡奖励
    mgr.write('slot1', s1); // v2：9999（v1 轮换进 backup-1）
    console.log('  ① 创建新档 slot1（云骞），经历两次写档：铜钱 0 → 8888 → 9999');
    mgr.autosave('slot1'); // 模拟关键节点自动存档
    console.log('  ② 关键节点自动存档 → auto 槽快照（9999）');
    dump(mgr);

    // 模拟损坏
    writeFileSync(join(dir, 'slot1.json'), '{"data": 坏档', 'utf8');
    console.log('  ③ 模拟文件损坏（截断 slot1.json）……');
    dump(mgr);

    const r = mgr.read('slot1');
    console.log(
      r
        ? `  ④ 读取存档 → 自动回退最近备份并修复主档 ✅（${r.data.player.name}，铜钱 ${r.data.player.copper}）`
        : '  ④ 读取存档 → 无可用数据 ❌',
    );
    console.log('     ↑ 回退到 backup-1（铜钱 8888）：按设计仅丢失最后一次写盘，关键节点即写可把损失窗口缩到最小（§3.5）');
    dump(mgr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    console.log('  ⑤ 演示目录已清理');
  }
}

function dump(mgr: SlotManager): void {
  const summary = mgr
    .list()
    .map((i) => `    ${i.slot.padEnd(6)} ${i.state.padEnd(11)} ${i.name ?? '—'}`)
    .join('\n');
  console.log(`  ── 槽位状态 ──\n${summary}`);
}

// ── 3. 主线推进演示（M1-8：关卡表驱动，battle → 通关结算 → 经验/铜钱/进度）──

function demoStage(): void {
  console.log('\n[3] 主线推进（第一章 10 关 · 配置 config/export/stage.json · 数值占位）');
  const { unitRows, skillRows, stageRows } = loadTables();
  const allies = buildUnits(unitRows.slice(0, 3) as UnitRow[], skillRows as SkillRow[], 'ally');
  const ctx: StageClearContext = {
    player: { name: '云骞', level: 1, exp: 0, realm: 0, copper: 0 },
    progress: { chapter: 1, node: 1, towerBest: 0 },
  };
  let seed = 1000;
  while (ctx.progress.node > 0) {
    const stage = findStage(stageRows as StageRow[], ctx.progress.chapter, ctx.progress.node);
    if (!stage) {
      console.log('  关卡表缺失，止步');
      return;
    }
    const enemyIds = Array.isArray(stage.enemies) ? stage.enemies : [stage.enemies];
    const enemies = buildUnits(
      (unitRows as UnitRow[]).filter((u) => enemyIds.includes(u.id)),
      skillRows as SkillRow[],
      'enemy',
    );
    // 单机推图允许反复挑战当前关（每次新种子；成长数值定稿后失败率会显著下降）
    let r = runBattle({ seed: seed++, allies, enemies });
    let attempts = 1;
    while (r.winner !== 'ally' && attempts < 50) {
      r = runBattle({ seed: seed++, allies, enemies });
      attempts++;
    }
    if (r.winner !== 'ally') {
      console.log(`  ✗ ${stage.id}「${stage.name}」挑战 ${attempts} 次未胜，止步于 Lv${ctx.player.level}`);
      return;
    }
    const retryNote = attempts > 1 ? `（第 ${attempts} 次挑战成功）` : '';
    const res = clearStage(ctx, stageRows as StageRow[], stage);
    const realmName = REALM_NAMES[ctx.player.realm] ?? '?';
    const levelUp = res.grow.levelUps > 0 ? `（升 ${res.grow.levelUps} 级${res.grow.realmUps > 0 ? `·突破${realmName}` : ''}！）` : '';
    console.log(
      `  ✓ ${stage.id}「${stage.name}」通关${retryNote}（${r.rounds} 回合）：+${stage.exp_reward} 经验 +${stage.copper_reward} 铜钱${levelUp} → Lv${ctx.player.level} ${realmName}，铜钱 ${ctx.player.copper}`,
    );
  }
  console.log(`  第一章通关 ✅（最终 Lv${ctx.player.level} ${REALM_NAMES[ctx.player.realm]}，铜钱 ${ctx.player.copper}）`);
}

demoBattle();
demoSave();
demoStage();
console.log('\n演示完成 ✅（本 demo 不产生任何持久文件）');
