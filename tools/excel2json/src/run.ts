/**
 * 导表 CLI（§3.6）：config/tables/*.tsv|csv → config/export/*.json
 * 用法：node tools/excel2json/src/run.ts [源目录=config/tables] [导出目录=config/export]
 * 校验失败时打印全部错误并以退出码 1 结束（不写任何导出文件）。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCheck, parseSheet, sheetToJson } from './core.ts';
import type { Sheet } from './core.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function separatorOf(file: string): string {
  // 支持 TSV 与 CSV：统一转成 tab 后交给 parseSheet
  return file.toLowerCase().endsWith('.csv') ? ',' : '\t';
}

function tsvFrom(text: string, sep: string): string {
  return sep === ',' ? text.split(',').join('\t') : text;
}

function main(): void {
  const inDir = resolve(process.argv[2] ?? join(repoRoot, 'config', 'tables'));
  const outDir = resolve(process.argv[3] ?? join(repoRoot, 'config', 'export'));
  const files = readdirSync(inDir).filter((f) => /\.(tsv|csv)$/i.test(f));
  if (files.length === 0) {
    console.error(`[excel2json] 源目录无表文件：${inDir}`);
    process.exit(1);
  }

  const tables: Record<string, Sheet> = {};
  const allErrors: string[] = [];
  for (const file of files.sort()) {
    const name = file.replace(/\.(tsv|csv)$/i, '');
    const raw = readFileSync(join(inDir, file), 'utf8');
    const sheet = parseSheet(name, tsvFrom(raw, separatorOf(file)));
    tables[name] = sheet;
    allErrors.push(...sheet.errors);
  }
  allErrors.push(...buildCheck(tables));

  if (allErrors.length > 0) {
    console.error(`[excel2json] 校验失败（${allErrors.length} 条），未导出：`);
    for (const e of allErrors) console.error(`  - ${e}`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  for (const sheet of Object.values(tables)) {
    writeFileSync(join(outDir, `${sheet.name}.json`), sheetToJson(sheet), 'utf8');
  }
  const total = Object.values(tables).reduce((n, s) => n + s.rows.length, 0);
  console.log(`[excel2json] 导出成功：${Object.keys(tables).length} 张表 / ${total} 行 → ${outDir}`);
  for (const s of Object.values(tables)) console.log(`  - ${s.name}.json（${s.rows.length} 行）`);
}

main();
