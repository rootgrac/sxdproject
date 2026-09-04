# M0 立项与验证 — 验收跟踪（DoD 对应开发文档 §4.1）

> 更新：2026-09-04。勾选状态 = 已验证；未勾选项标注阻塞原因。

## M0 目标与交付物

| # | 验收项（开发文档 M0 DoD / §0 首周清单） | 状态 | 证据 / 阻塞 |
| --- | --- | --- | --- |
| 1 | 仓库初始化 + 开发分支 | ✅ | main + develop 均指向 b168cdc，tag v0.2.1（2026-09-04） |
| 2 | 推送到远程（develop） | ✅ | origin/main + origin/develop + tag 已推送（rootgrac/sxdproject.git） |
| 3 | CI 跑通 | ⏳ | `.github/workflows/ci.yml`（单测门禁）已随推送触发；**首跑结果待 GitHub Actions 页面确认** |
| 4 | 导表工具（Excel→JSON） | ⬜ | 未开始（M0 后半段，依赖无；可离线进行） |
| 5 | 存档系统最小闭环（创建/写入/读取/校验/备份轮换） | ✅ | `tools/save-prototype` 13 测 + `client framework/save` 9 测（对拍一致），根 `npm test` 31 测全绿 |
| 6 | 存档损坏自动回退 / 版本迁移 | ✅ | 同上（截断/篡改回退、v1→v2 迁移 + backup_v{n} 快照均有测试） |
| 7 | 3v3 回合制战斗原型（确定性内核） | ✅ | `battle-core` 9 测全绿（种子回放/气势/命中闪避暴击/胜负）；平衡模拟器 `tools/sim` 可用 |
| 8 | 战斗 demo 引擎内跑通（占位美术） | ✅ | `BattleDemoBoot` 已挂 Main.scene 的 Demo 节点（12:04 保存，uuid 压缩引用 72df0xa02VP+…）；**用户预览成功显示** ✅ |
| 9 | 真机可玩（构建） | ⏳ | 依赖 #8 通过后做 Web 预览 → 原生构建 |
| 10 | Cocos 空项目 → 真机预览链路 | ⏳ | Creator 3.8.8 + client 已导入；首次预览待 #8 |

## 演示 / 工具入口

```bash
npm test          # 全仓库 31 项单测（battle-core 9 + save-prototype 13 + client-core 9）
npm run demo      # M0 核心链路 CLI 演示（战斗回放 + 存档容错）
npm run sim       # 批量战斗模拟器（平衡回归基线，1000 场/场景）
node tools/sync-battle-core.mjs   # battle-core → client 同步（改内核后执行）
```

## 剩余关键路径（外部依赖）

1. 用户安装 Git for Windows → git init / v0.2.0 首提交 + tag / develop / remote 推送
2. 用户在 Creator 装配 Main 场景（挂 BattleDemoBoot）→ 预览 3v3 战斗 → 报错反馈或确认
3. （确认预览后可做）导表工具、真机构建链路
