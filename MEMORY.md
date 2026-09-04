# 项目记忆

## 仙途 HD（暂定名）— 《神仙道》高清重制版手游（单机版）

- **定位：单机离线手游，无服务端**（用户 2026-09-04 明确改版，v0.2.0）；开发负责人 dsh（外部开发者），本机用户是产品负责人（需求拍板 / 测试 / 美术对接 / 合规流程 / 提供仓库）。
- **流程约定：涉及 git 远程仓库操作时，必须先向用户索取仓库地址**，不得擅自指定或假设。
- 核心文档：`docs/开发文档.md`（v0.2.0，纳入 Git 管理）；仓库首页 `README.md`。
- 技术栈决策：客户端 Cocos Creator 3.8+ / TypeScript，纯单机架构；无 MySQL/Redis/NestJS；玩家数据 = 本地 JSON 存档（原子写入 + SHA-256 校验 + 备份轮换 + saveVersion 迁移链 + fixtures 回归）；战斗内核 `battle-core` 纯 TS 确定性战斗（种子回放）；竞技场改为 AI 名将镜像，社交/聊天/帮派已移除，成就/图鉴补位。
- 功能分 5 批次（核心闭环 → 养成深度 → 系统完善 → 商业化 → 远期扩展），周期约 20 周。
- Git：单仓 monorepo（client / battle-core / config / tools / docs），main 受保护 + Conventional Commits + SemVer annotated tag；回滚重点：iOS 已发布版本无法回退（分阶段发布兜底）、存档迁移事故读 backup_v{n} 回退。
- 硬性合规红线：美术 / 文案全原创；不得复制原版受版权内容；上线名称不得含「神仙道」商标，发布前需商标检索 + 版号流程（需公司主体，国内含单机也要版号）。
- 当前仓库状态：⚠️ 本机 `D:\sxdproject` 目录内**没有 `.git`**（文档记载的 v0.2.0 提交 9b63f16 未落盘到本目录）；本机未安装 git（用户 2026-09-04 选择手动安装，尚未就绪）。待 git 就绪后在本目录重新 init：main 首提交（文档快照 v0.2.0）+ annotated tag `v0.2.0` → 建 `develop` → 再配置 remote 推送。
- 远程仓库地址（2026-09-04 产品负责人提供）：`https://github.com/rootgrac/sxdproject.git`。
- Cocos：**Creator 3.8.8 已下载**于 `C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`；`client/` 已用官方 empty-2d 模板初始化并由 Dashboard **首次导入完成**（library/temp/settings/meta 齐备；package.json 已补 uuid+creator.version，另加 `"type":"module"` 供 node 直测 client 纯逻辑——若编辑器出现异常报错需考虑移除）。`client/assets/scripts/`：`battle-core/`（由根包经 `tools/sync-battle-core.mjs` 同步，去 .ts 扩展名，禁止手改）、`framework/save/`（KV 版存档内核：自研同步 SHA-256 + KvSaveStore，9 测全绿）、`modules/battle/BattleDemoBoot.ts`（3v3 自动战斗演出，纯代码建 UI，待用户挂到场景 Canvas 下预览）。git 仍未安装。
- **全仓库回归入口**：根 `npm test` = **36 测**（battle-core 9 + save-prototype 13 + client-core-test 14，含 loader hook 解析 Cocos 风格无扩展 import）。client 存档层三件套：sha256.ts（自研同步 SHA-256）+ save-core.ts（KvSaveStore）+ save-manager.ts（§3.5-1 运行时调度：脏标记合并/30s 批量节拍 tick(now)/flushNow 立即写/lastSavedAt 维护，时钟注入可测）。
- **M0 战斗 demo 引擎内验证通过（2026-09-04 12:04+）**：`BattleDemoBoot` 挂于 Main.scene「Demo」节点（Canvas+Camera 由用户创建），产品负责人预览**成功显示**（自动播放 3v3 战斗）。M0 剩余：git 安装 → 仓库提交推送 → CI 首跑 →（后续）导表工具与真机预览链路（见 docs/m0-checklist.md）。
- M0 原型已落地（**零依赖纯 TS**，Node ≥24 原生 type-stripping 直接运行；测试用单进程模式 `--experimental-test-isolation=none`，已固定在 package.json test 脚本，勿改回默认子进程模式——本机沙箱限制 spawn pipe）：
  - `battle-core/`：确定性战斗内核（种子 PRNG / 气势 / 命中闪避暴击 / 事件流），9 项单测全绿
  - `tools/save-prototype/`：存档内核，13 项单测全绿 —— SaveStore（原子写 + SHA-256 + 备份轮换 2 份 + saveVersion 迁移链 v1→v2 + 损坏自动回退）+ SlotManager（slot1-3 手动 + auto 自动档：创建/删除/复制/自动快照/too-new 防覆盖）；将来移植 `client/assets/scripts/framework/save/`
  - `tools/m0-demo/`：CLI 演示 `npm run demo`（3v3 战斗回放摘要 + 确定性复跑校验 + 存档损坏自动恢复）
  - `tools/sim/`：批量战斗模拟器雏形（`node tools/sim/run.ts [场数]`；平衡回归基线工具，§3.6/§4.3）；`config/battle.md`（占位数值登记 v0.1，含待定项清单）
