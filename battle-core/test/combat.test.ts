import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattle } from '../src/engine.ts';
import { makeUnit } from '../src/model.ts';
import type { Side, Unit } from '../src/model.ts';

interface TeamOpts {
  hp?: number;
  atk?: number;
  def?: number;
  spd?: number;
  acc?: number;
  eva?: number;
  crit?: number;
  count?: number;
}

function makeTeam(prefix: string, side: Side, o: TeamOpts = {}): Unit[] {
  const stats = {
    atk: o.atk ?? 100,
    def: o.def ?? 50,
    spd: o.spd ?? 100,
    acc: o.acc ?? 1,
    eva: o.eva ?? 0,
    crit: o.crit ?? 0,
  };
  const count = o.count ?? 3;
  return Array.from({ length: count }, (_, i) =>
    makeUnit({ id: `${prefix}${i}`, side, hp: o.hp ?? 1000, stats, name: `${prefix}${i}` }),
  );
}

test('确定性：同种子两次战斗的事件流完全一致', () => {
  const mk = () => ({
    seed: 20260904,
    allies: makeTeam('a', 'ally', { atk: 150, def: 30, spd: 110, crit: 0.2, hp: 900 }),
    enemies: makeTeam('e', 'enemy', { hp: 800, atk: 90, def: 20, spd: 90, eva: 0.4, crit: 0.1 }),
  });
  const r1 = runBattle(mk());
  const r2 = runBattle(mk());
  assert.equal(r1.winner, r2.winner);
  assert.deepEqual(r1.events, r2.events);
});

test('按速度降序行动：高速方先手', () => {
  const allies = makeTeam('a', 'ally', { spd: 999, atk: 0 });
  const enemies = makeTeam('e', 'enemy', { spd: 1, atk: 0, hp: 1_000_000 });
  const r = runBattle({ seed: 5, allies, enemies });
  const firstAction = r.events.find((e) => e.type === 'attack' || e.type === 'skill');
  assert.ok(firstAction);
  assert.equal(firstAction.type, 'attack');
  assert.equal(firstAction.actor, 'a0');
});

test('普攻积气势（+qiGainAttack），气势满后下一行动释放绝技并清零', () => {
  const allies = makeTeam('a', 'ally', { spd: 100, atk: 10 });
  const enemies = makeTeam('e', 'enemy', { spd: 90, hp: 200_000, atk: 0 });
  const r = runBattle({ seed: 7, allies, enemies, config: { qiGainAttack: 100, qiMax: 100 } });

  const firstAttack = r.events.find((e) => e.type === 'attack' && e.actor === 'a0');
  assert.ok(firstAttack && firstAttack.type === 'attack');
  assert.equal(firstAttack.hit, true);
  assert.equal(firstAttack.actorQi, 100); // 一击即满（占位参数）
  assert.ok(firstAttack.targetQi > 0); // 被击方获得气势

  const skill = r.events.find((e) => e.type === 'skill' && e.actor === 'a0');
  assert.ok(skill && skill.type === 'skill');
  assert.equal(skill.round, 2); // 第一回合普攻攒气，第二回合开绝技
  assert.equal(skill.actorQi, 0); // 绝技后气势清零
  // 伤害段由 effect 事件承载（默认技能回退单段伤害）
  const eff = r.events.find((e) => e.type === 'effect' && e.actor === 'a0' && e.kind === 'damage');
  assert.ok(eff && eff.type === 'effect');
  assert.ok((eff.damage ?? 0) > 0);
});

test('全灭判定：强方一轮获胜', () => {
  const allies = makeTeam('a', 'ally', { atk: 999, def: 0 });
  const enemies = makeTeam('e', 'enemy', { hp: 30, atk: 999, def: 0, spd: 50 });
  const r = runBattle({ seed: 11, allies, enemies });
  assert.equal(r.winner, 'ally');
  assert.equal(r.rounds, 1);
  const deaths = r.events.filter((e) => e.type === 'death');
  assert.equal(deaths.length, 3);
});

test('敌方先手强攻时判敌方获胜', () => {
  const allies = makeTeam('a', 'ally', { hp: 30, atk: 999, def: 0, spd: 50 });
  const enemies = makeTeam('e', 'enemy', { atk: 999, def: 0, spd: 999 });
  const r = runBattle({ seed: 13, allies, enemies });
  assert.equal(r.winner, 'enemy');
});

test('30 回合未分胜负判平', () => {
  const allies = makeTeam('a', 'ally', { hp: 100_000, atk: 1, def: 0 });
  const enemies = makeTeam('e', 'enemy', { hp: 100_000, atk: 1, def: 0 });
  const r = runBattle({ seed: 1, allies, enemies });
  assert.equal(r.winner, 'draw');
  assert.equal(r.rounds, 30);
  assert.equal(r.events.filter((e) => e.type === 'death').length, 0);
});

test('暴击：crit=1 必暴且伤害 = floor(atk×1.5)（占位公式）', () => {
  const allies = makeTeam('a', 'ally', { atk: 100, def: 0, spd: 200, hp: 99_999, crit: 1 });
  const enemies = makeTeam('e', 'enemy', { hp: 99_999, atk: 0, def: 0, spd: 1 });
  const r = runBattle({ seed: 3, allies, enemies });
  const ev = r.events.find((e) => e.type === 'attack' && e.actor === 'a0');
  assert.ok(ev && ev.type === 'attack');
  assert.equal(ev.hit, true);
  assert.equal(ev.crit, true);
  assert.equal(ev.damage, 150);
});

test('防御减伤占位公式：dmg = floor(atk − def×0.6)', () => {
  const allies = makeTeam('a', 'ally', { atk: 100, def: 0, spd: 200, hp: 99_999 });
  const enemies = makeTeam('e', 'enemy', { hp: 99_999, atk: 0, def: 100, spd: 1 });
  const r = runBattle({ seed: 3, allies, enemies });
  const ev = r.events.find((e) => e.type === 'attack' && e.actor === 'a0');
  assert.ok(ev && ev.type === 'attack');
  assert.equal(ev.damage, 40); // 100 - 100*0.6 = 40
});

test('闪避：命中率存在下限，大样本下必出现未命中事件', () => {
  const mkSolo = (id: string, side: Side): Unit =>
    makeUnit({
      id,
      side,
      hp: 1_000_000_000,
      stats: { atk: 1, def: 0, spd: 1, acc: 0, eva: 1000, crit: 0 },
    });
  const allies = [mkSolo('solo-a', 'ally')];
  const enemies = [mkSolo('solo-e', 'enemy')];
  const r = runBattle({ seed: 99, allies, enemies, config: { maxRounds: 800 } });
  assert.ok(r.events.some((e) => e.type === 'attack' && e.hit === false));
  assert.equal(r.winner, 'draw');
});
