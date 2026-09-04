/**
 * 同步 battle-core 源码到 client/assets/scripts/battle-core（Cocos 脚本编译用）。
 *
 * 为什么需要同步而非直接引用：
 * - Cocos Creator 只能编译 assets 目录内的脚本，无法 import monorepo 根目录的 battle-core 包
 * - Cocos 的 TS 编译不支持相对 import 带 ".ts" 扩展名（Node 24 直跑则需要），故同步时去除
 *
 * 维护规则：
 * - client/assets/scripts/battle-core/src 的 .ts 为**自动生成，禁止手改**
 * - 修改根 battle-core 后运行：node tools/sync-battle-core.mjs
 * - **保留 Cocos 的 .meta 文件**（脚本 uuid 必须稳定，删除 meta 会导致引用失效）
 * - 仅覆盖 .ts 内容、删除源中已不存在的 .ts（连同其 .meta）
 * - CI 未来增加一致性校验（比较源与同步产物）
 *
 * 运行：node tools/sync-battle-core.mjs
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(toolsDir, '..', 'battle-core', 'src');
const dstDir = join(toolsDir, '..', 'client', 'assets', 'scripts', 'battle-core', 'src');

function listTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function stripTsExtensions(content) {
  // 仅处理相对导入（battle-core 内部均为此形式）：from './x.ts' / from '../y.ts'
  return content.replace(/(\bfrom\s+['"])(\.\.?\/[^'"]*?)\.ts(['"])/g, '$1$2$3');
}

// 1) 收集源文件相对路径
const srcFiles = listTs(srcDir);
const relList = srcFiles.map((f) => relative(srcDir, f).split(sep).join('/'));

// 2) 删除目标中源已不存在的 .ts（连同其 .meta）
for (const f of listTs(dstDir)) {
  const rel = relative(dstDir, f).split(sep).join('/');
  if (!relList.includes(rel)) {
    rmSync(f, { force: true });
    rmSync(`${f}.meta`, { force: true });
    console.log(`  移除陈旧文件：${rel}`);
  }
}

// 3) 覆盖/新增 .ts（保留 .meta）
let count = 0;
for (const f of srcFiles) {
  const rel = relative(srcDir, f).split(sep).join('/');
  const out = join(dstDir, rel);
  mkdirSync(dirname(out), { recursive: true });
  const text = readFileSync(f, 'utf8');
  writeFileSync(out, stripTsExtensions(text), 'utf8');
  count++;
}

writeFileSync(
  join(dstDir, '..', 'README.md'),
  [
    '# client/assets/scripts/battle-core — 自动生成目录（勿手改）',
    '',
    '来源：根目录 `battle-core/src`（M0 纯 TS 确定性战斗内核），由 `tools/sync-battle-core.mjs` 同步。',
    '同步时仅去除相对 import 的 `.ts` 扩展名（Cocos 编译器要求）；**保留本目录 .meta（uuid 稳定）**。',
    '',
    '修改源码请改根 `battle-core/`，然后运行：`node tools/sync-battle-core.mjs`',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`battle-core 同步完成：${count} 个 .ts（.meta 已保留）`);
