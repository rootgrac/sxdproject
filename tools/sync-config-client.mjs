/**
 * 同步导出的配置 JSON 到 client/assets/resources/config（Cocos resources.load 用）。
 *
 * 维护规则：
 * - client/assets/resources/config/*.json 为**自动生成，禁止手改**
 * - 修改 config/tables 后运行：node tools/excel2json/src/run.ts && node tools/sync-config-client.mjs
 * - 保留已存在文件的 .meta（uuid 稳定）；新增文件由编辑器导入时生成
 *
 * 运行：node tools/sync-config-client.mjs
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(toolsDir, '..', 'config', 'export');
const dstDir = join(toolsDir, '..', 'client', 'assets', 'resources', 'config');

mkdirSync(dstDir, { recursive: true });
const files = readdirSync(srcDir).filter((f) => f.endsWith('.json'));
for (const f of files) {
  copyFileSync(join(srcDir, f), join(dstDir, f));
}
console.log(`config 同步完成：${files.length} 个 JSON → client/assets/resources/config/`);
