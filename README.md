# 仙途 HD（暂定名）

> 以《神仙道》核心玩法机制为参照的**高清重制版单机**横版回合制仙侠 RPG。
> 100% 离线可玩、无服务端；美术与文案原创、代码自研，不使用原版任何受版权保护的内容（合规红线见开发文档 §1.3）。

**项目状态**：🏗 M0 立项与验证进行中（骨架 + 双原型已落地） ｜ 开发负责人：**dsh** ｜ 产品负责人：项目所有者

## 文档导航

| 文档 | 说明 |
| --- | --- |
| [docs/开发文档.md](docs/开发文档.md) | **总开发文档**：项目概述 / 功能清单与优先级 / 技术方案（本地存档）/ 开发计划 / Git 规范 |

## M0 进展速览（2026-09-04）

| 项 | 状态 |
| --- | --- |
| monorepo 骨架（client / battle-core / config / tools / docs / .github） | ✅ 已初始化（待 git 落地后提交） |
| `battle-core/` 确定性战斗内核原型 | ✅ 9 项单测全绿（种子回放 / 气势 / 命中闪避暴击 / 事件流） |
| `tools/save-prototype/` 存档内核原型 | ✅ 13 项单测全绿（原子写 / SHA-256 / 备份轮换 / 迁移链 / 多槽位 + 自动档） |
| M0 核心链路 CLI 演示 | ✅ `npm run demo`（战斗回放 + 存档容错） |
| 平衡回归雏形 | ✅ `tools/sim` 批量模拟器 + `config/battle.md` 占位数值登记（4000 场秒级） |
| 开发环境 | Node 24.20 ✅；Git ⏳ 用户安装中；Cocos Dashboard 已就位（D:\CocosDashboard v31.3.1），Creator 3.8.x ⏳ 待 Dashboard 登录下载到 D 盘 |

## 给 dsh 的快速开始

1. **第一天必读**：开发文档的 §0（执行说明）、§1.3（合规红线）、§5（Git 规范）
2. **搭环境**：Node 20+ LTS、Cocos Creator 3.8+、Git（文档附录 B）
3. **建骨架**：按附录 A 初始化 `client / battle-core / config / tools / docs` 结构，推送到本仓库 `develop` 分支
4. **开工**：从 M0 任务清单开始（文档 §4.1），重点先落存档系统（§3.5）与战斗原型（§3.4），用 GitHub Issues 跟踪进度
5. **守规范**：提交必须符合 Conventional Commits（文档 §5.3，CI 强制校验）

## 规范速查

| 项 | 规则 |
| --- | --- |
| 分支 | `main`（受保护，打 tag 发布）/ `develop`（集成）/ `feature-*` / `release-*` / `hotfix-*` |
| 提交 | `feat(save): 实现备份轮换`；禁止无意义提交信息；一次提交一件事；存档结构变更用 `!` 标记并写明迁移方案 |
| 版本 | `vX.Y.Z` 语义化版本；发布打 annotated tag；CHANGELOG 由 CI 自动生成 |
| 存档 | 玩家数据=最高优先级资产：原子写入 + 校验 + 备份轮换 + saveVersion 迁移链，结构变更必须过 fixtures 回归 |
| 回滚 | 优先 `git revert`；iOS 已发布版本无法回退（靠分阶段发布兜底），详见开发文档 §5.5 场景矩阵 |

## 关联远程仓库（首次）

```bash
git remote add origin <产品负责人提供的GitHub仓库地址>
git push -u origin main --tags
```

## License

专有项目，© 2026 版权所有，未授权禁止分发。所有美术素材须保留原创凭证或商用授权（存 `tools/art-licenses/`）。
