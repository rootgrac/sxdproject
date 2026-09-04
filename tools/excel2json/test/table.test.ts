import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheck, parseSheet, sheetToJson } from '../src/core.ts';

// TSV 文本构造：每行一个单行字符串（含显式 \t 转义），运行时 join 出真实换行
const tsv = (...lines: string[]): string => lines.join('\n');

const HEADER = tsv(
  'id\tname\thp\tatk\tacc\tcrit\tskills',
  'str\tstr\tint\tint\tfloat\tfloat\tstr[]',
  'ID\t名\t血\t攻\t命中\t暴击\t技能',
);

test('解析：类型转换 / 数组拆分 / 空值默认', () => {
  // 数据行 2：name 之后全部为空单元格 → 取类型默认值
  const text = tsv(HEADER, '# 注释行忽略', 'a1\t青玄\t1000\t120\t1\t0.15\tsk1;sk2', 'a2\t云瑶\t\t\t\t\t');
  const s = parseSheet('t', text);
  assert.deepEqual(s.errors, []);
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[0].values.id, 'a1');
  assert.equal(s.rows[0].values.hp, 1000);
  assert.equal(s.rows[0].values.crit, 0.15);
  assert.deepEqual(s.rows[0].values.skills, ['sk1', 'sk2']);
  // 空单元格默认值
  const r2 = s.rows[1].values;
  assert.equal(r2.name, '云瑶');
  assert.equal(r2.hp, 0);
  assert.equal(r2.acc, 0);
  assert.equal(r2.crit, 0);
  assert.deepEqual(r2.skills, []);
});

test('校验：主键重复报错', () => {
  const text = tsv(HEADER, 'a1\t甲\t1\t1\t1\t0\t', 'a1\t乙\t2\t2\t2\t0\t');
  const s = parseSheet('t', text);
  assert.ok(s.errors.some((e) => e.includes('主键重复')));
});

test('校验：类型错误与列数不符报错', () => {
  const badInt = tsv(HEADER, 'a1\t甲\tabc\t1\t1\t0\t');
  const s1 = parseSheet('t', badInt);
  assert.ok(s1.errors.some((e) => e.includes('不是整数')));
  const badCols = tsv(HEADER, 'a1\t甲\t1\t1\t1');
  const s2 = parseSheet('t', badCols);
  assert.ok(s2.errors.some((e) => e.includes('列数')));
});

test('校验：非法类型声明与表头行数不足', () => {
  const s1 = parseSheet('t', tsv('id\tname', 'str\tstr')); // 只有 2 行表头
  assert.ok(s1.errors.some((e) => e.includes('表头必须 3 行')));
  const s2 = parseSheet('t', tsv('id\twhen', 'int\tdate', 'ID\t时间', 'a\t2026'));
  assert.ok(s2.errors.some((e) => e.includes('类型非法')));
});

test('引用校验：ref 跨表存在性', () => {
  const unitHeader = tsv('id\tname\thp\tskills', 'str\tstr\tint\tref:skill.id', 'ID\t名\t血\t技能');
  const skill = tsv('id\tname', 'str\tstr', '技能ID\t名', 'sk1\t普攻', 'sk2\t绝技');
  const unit = tsv(unitHeader, 'a1\t甲\t1\tsk1;sk2', 'a2\t乙\t1\tsk9');
  const tables = { skill: parseSheet('skill', skill), unit: parseSheet('unit', unit) };
  const errs = buildCheck(tables);
  assert.equal(tables.unit.errors.length, 0);
  assert.equal(errs.length, 1);
  assert.ok(errs[0].includes('sk9'));
});

test('导出 JSON 内容与字段序', () => {
  const s = parseSheet('t', tsv(HEADER, 'a1\t青玄\t1000\t120\t1\t0.15\tsk1;sk2'));
  const json = JSON.parse(sheetToJson(s)) as Array<Record<string, unknown>>;
  assert.equal(json.length, 1);
  assert.deepEqual(Object.keys(json[0]), ['id', 'name', 'hp', 'atk', 'acc', 'crit', 'skills']);
  assert.equal(json[0].name, '青玄');
  assert.deepEqual(json[0].skills, ['sk1', 'sk2']);
});
