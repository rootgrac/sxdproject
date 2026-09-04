/**
 * 导表内核（开发文档 §3.6）：
 * - 表头三行：字段名 / 类型 / 注释；首列为主键；行首 `#` 为注释（表级说明）
 * - 类型：str | int | float | bool | str[] | int[] | ref:<table>.<col>（跨表引用校验）
 * - 数组单元格用 `;` 分隔；空单元格取类型默认值（str''/int 0/float 0/bool false/[]）
 * - 校验：列数、类型、主键非空且唯一、ref 引用存在
 * - 输出：每表一个 JSON 数组（字段序 = 表头序），写入导出目录
 */

export interface TableField {
  name: string;
  type: string; // 原始类型文本
  comment: string;
  primary: boolean; // 首列即主键
}

export type TypeSpec =
  | { kind: 'scalar'; t: string }
  | { kind: 'array'; t: string }
  | { kind: 'ref'; table: string; col: string };

export interface Row {
  /** 数据行序号（用于报错定位，1 起） */
  rowNo: number;
  values: Record<string, unknown>;
}

export interface Sheet {
  name: string;
  fields: TableField[];
  rows: Row[];
  errors: string[];
}

export function parseTypeSpec(text: string): TypeSpec | null {
  const v = text.trim();
  const refM = v.match(/^ref:(.+?)\.(.+)$/);
  if (refM) return { kind: 'ref', table: refM[1], col: refM[2] };
  if (v.endsWith('[]')) {
    const t = v.slice(0, -2);
    return t === 'str' || t === 'int' ? { kind: 'array', t } : null;
  }
  return ['str', 'int', 'float', 'bool'].includes(v) ? { kind: 'scalar', t: v } : null;
}

function defaultOf(spec: TypeSpec | null): unknown {
  if (!spec) return null;
  if (spec.kind === 'array') return [];
  if (spec.kind === 'ref') return '';
  return spec.t === 'str' ? '' : spec.t === 'bool' ? false : 0;
}

function convertScalar(raw: string, t: string, ctx: string): unknown {
  if (t === 'str') return raw;
  if (t === 'int') {
    if (!/^-?\d+$/.test(raw)) throw new Error(`${ctx}：不是整数「${raw}」`);
    return Number(raw);
  }
  if (t === 'float') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${ctx}：不是数值「${raw}」`);
    return n;
  }
  if (t === 'bool') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    throw new Error(`${ctx}：不是布尔「${raw}」（true/false）`);
  }
  throw new Error(`${ctx}：未知类型 ${t}`);
}

function convertCell(raw: string, spec: TypeSpec, ctx: string): unknown {
  if (spec.kind === 'ref') {
    // 支持 `a;b;c` 形式的引用列表：单元素存字符串，多元素存数组（buildCheck 阶段统一校验）
    const parts = raw
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return parts.length > 1 ? parts : (parts[0] ?? '');
  }
  if (spec.kind === 'array') {
    return raw
      .split(';')
      .filter((s) => s.length > 0)
      .map((s) => convertScalar(s.trim(), spec.t, ctx));
  }
  return convertScalar(raw, spec.t, ctx);
}

/** 解析一张表文本（TSV/CSV 均可，调用方按分隔符切行即可统一为 tab 传入） */
export function parseSheet(name: string, text: string): Sheet {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    // 注意：不能 trim 行本身——行尾的 tab 是空单元格的一部分（如 'a\tb\t\t' 表示 4 列）
    .filter((l) => {
      const t = l.trim();
      return t !== '' && !t.startsWith('#');
    });

  const fail = (msg: string): Sheet => ({ name, fields: [], rows: [], errors: [...errors, msg] });

  if (lines.length < 3) return fail(`${name}: 表头必须 3 行（字段名/类型/注释）`);
  const cells = (l: string): string[] => l.split('\t').map((c) => c.trim());
  const nameRow = cells(lines[0]);
  const typeRow = cells(lines[1]);
  const commentRow = cells(lines[2]);
  if (nameRow.length === 0 || nameRow.some((n) => n === '')) {
    return fail(`${name}: 第 1 行字段名不能为空`);
  }
  if (typeRow.length !== nameRow.length || commentRow.length !== nameRow.length) {
    return fail(`${name}: 表头三行列数不一致（${nameRow.length}/${typeRow.length}/${commentRow.length}）`);
  }

  const fields: TableField[] = nameRow.map((n, i) => ({
    name: n,
    type: typeRow[i] ?? '',
    comment: commentRow[i] ?? '',
    primary: i === 0,
  }));
  for (const f of fields) {
    if (!parseTypeSpec(f.type)) errors.push(`${name}: 字段「${f.name}」类型非法「${f.type}」`);
  }

  const rows: Row[] = [];
  const seenPrimary = new Map<string, number>();
  const primaryName = fields[0]?.name ?? '';

  for (let li = 0; li < lines.length - 3; li++) {
    const rowNo = li + 1;
    const c = cells(lines[li + 3]);
    if (c.length !== nameRow.length) {
      errors.push(`${name}: 数据行 ${rowNo} 列数 ${c.length} ≠ ${nameRow.length}`);
      continue;
    }
    const values: Record<string, unknown> = {};
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const spec = parseTypeSpec(f.type);
      const raw = c[i] ?? '';
      if (raw === '') {
        values[f.name] = defaultOf(spec);
        continue;
      }
      try {
        values[f.name] = convertCell(raw, spec as TypeSpec, `${name} 行${rowNo} ${f.name}`);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        values[f.name] = defaultOf(spec);
      }
    }
    if (primaryName) {
      const pk = String(values[primaryName]);
      if (pk === '' || pk === '0') {
        errors.push(`${name}: 数据行 ${rowNo} 主键「${primaryName}」为空`);
      } else if (seenPrimary.has(pk)) {
        errors.push(`${name}: 主键重复「${pk}」（行 ${seenPrimary.get(pk)} 与 ${rowNo}）`);
      } else {
        seenPrimary.set(pk, rowNo);
      }
    }
    rows.push({ rowNo, values });
  }
  return { name, fields, rows, errors };
}

/** 跨表引用校验：ref:<table>.<col> 的单元格值必须存在于目标表（支持单值与数组值） */
export function buildCheck(tables: Record<string, Sheet>): string[] {
  const errors: string[] = [];
  for (const sheet of Object.values(tables)) {
    for (const f of sheet.fields) {
      const spec = parseTypeSpec(f.type);
      if (!spec || spec.kind !== 'ref') continue;
      const target = tables[spec.table];
      if (!target) {
        errors.push(`${sheet.name}: 字段「${f.name}」引用了不存在的表「${spec.table}」`);
        continue;
      }
      if (!target.fields.some((tf) => tf.name === spec.col)) {
        errors.push(`${sheet.name}: 字段「${f.name}」引用列「${spec.table}.${spec.col}」不存在`);
        continue;
      }
      const idSet = new Set(target.rows.map((r) => String(r.values[spec.col])));
      for (const r of sheet.rows) {
        const v = r.values[f.name];
        const vals = Array.isArray(v) ? v : v === '' || v === null || v === undefined ? [] : [v];
        for (const x of vals) {
          if (!idSet.has(String(x))) {
            errors.push(`${sheet.name}: 行${r.rowNo} 「${f.name}」引用不存在「${spec.table}.${spec.col}: ${String(x)}」`);
          }
        }
      }
    }
  }
  return errors;
}

/** 导出：每表一个 JSON 数组（行内字段序 = 表头序） */
export function sheetToJson(sheet: Sheet): string {
  return JSON.stringify(sheet.rows.map((r) => r.values), null, 2);
}
