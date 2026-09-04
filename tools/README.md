# tools — 开发工具链

> 状态：M0 进行中（存档原型已落地，导表脚本待建）

| 目录 / 文件 | 用途 | 状态 |
| --- | --- | --- |
| `save-prototype/` | 存档系统纯 TS 原型：原子写 / 校验 / 备份轮换 / 迁移（将来移植 client `framework/save`） | ✅ 已落地（13 项单测全绿） |
| `m0-demo/` | M0 核心链路 CLI 演示（`npm run demo`：3v3 战斗回放 + 存档容错） | ✅ 已落地 |
| `sim/` | 批量战斗模拟器雏形（`node tools/sim/run.ts [场数]`：胜率/回合统计与对照场景，§3.6 平衡回归） | ✅ 已落地（基线见 `config/battle.md` §5） |
| 导表脚本 | Excel → JSON（开发文档 §3.6） | 待建 |
| `save-migration-test/` | 存档迁移 fixtures 回归测试（§5.5）——原型阶段由 `save-prototype/test/fixtures/` 承接，client 工程落地后在此固化 | 规划中 |
| `art-licenses/` | 美术素材授权凭证存档（§1.3） | 待美术进场 |

npm 工具依赖（commitlint / husky）统一管理在**仓库根** `package.json`；git 钩子由 husky 安装。
