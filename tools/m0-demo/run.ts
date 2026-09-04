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
import { AUTO_SLOT, SlotManager } from '../save-prototype/src/slots.ts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 1. 战斗回放演示（阵容由导出的配置表驱动，M1-3：改表 → 重导 → 本 demo 随之变化）──

const SEED = 20260904;
const HERE = dirname(fileURLToPath(import.meta.url));

function loadConfig(): { unitRows: unknown[]; skillRows: unknown[] } {
  const unitJson = JSON.parse(readFileSync(join(HERE, '..', '..', 'config', 'export', 'unit.json'), 'utf8')) as unknown[];
  const skillJson = JSON.parse(readFileSync(join(HERE, '..', '..', 'config', 'export', 'skill.json'), 'utf8')) as unknown[];
  return { unitRows: unitJson, skillRows: skillJson };
}

function demoBattle(): void {
  const { unitRows, skillRows } = loadConfig();
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

demoBattle();
demoSave();
console.log('\n演示完成 ✅（本 demo 不产生任何持久文件）');
