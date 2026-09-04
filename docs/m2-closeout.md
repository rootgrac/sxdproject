# M2 状态与收官包（2026-09-04）

> M2 逻辑层全部完成（107 项测试全绿）；引擎 UI 已导入编辑器；**引擎内验收与数值拍板待产品负责人**

## 完成清单（✅ 有测试/代码证据）

| 系统 | 模块 | 测试 | 存档 |
| --- | --- | --- | --- |
| 伙伴实例/成长/上阵 | `modules/partner/partner-core.ts` | 4 | party（v3 迁移） |
| 招贤阁招募（门槛/权重/十连保底原创） | `recruit-core.ts` | 6 | — |
| 装备 6 部位/穿戴/强化（境界上限） | `modules/equip/equip-core.ts` | 4 | equips |
| 打造/分解（材料闭环） | `craft-core.ts` | 4（与 item 合测） | bag |
| 背包堆叠 | `modules/item/item-core.ts` | ↑ | bag |
| 商店 | `modules/shop/shop-core.ts` | ↑（合测 5） | — |
| 精英副本（次数/掉落/跨日） | `stage/elite-core.ts` | ↑ | daily（v4 迁移） |
| GameSession M2 操作层 | `modules/game/game-session.ts` | 5 | — |
| 修行 Hub UI | `BattleGameBoot.ts`（引擎） | 编辑器导入 ✅ | — |
| 存档迁移链 | v1→v2→v3→v4 双实现 | fixtures 回归 | v4 |

**全仓库门禁：根 `npm test` = 107 项全绿**；表驱动模拟基线 `tools/sim`（数值观察见 m2-balance.md）

## 待产品负责人（两项）

1. **引擎内验收**（编辑器已就绪，约 3-5 分钟）：
   新档/旧档 → 推 1-2 关 → 「🧘 修行」→ 招贤单抽（白纾/陆沉舟自动上阵）→ 精英·沉沙涧（3 次/日）→ 打造青锋剑并穿戴 → 强化武器 → **刷新页面 → 继续 → 全部保留**
2. **数值拍板**：`docs/m2-balance.md`（含基线观察：治疗使平局率 16%，可调方向列明）

## 验收记录

| 日期 | 引擎验收 | 数值拍板 | 备注 |
| --- | --- | --- | --- |
| 2026-09-04 | ✅ 通过（修复 loadConfigs 12 表与视图重叠后，产品负责人确认正常） | ⏳ 占位数值运行中 | 数值可随时按 m2-balance 清单调整 |

## 收尾路径

- 验收通过 → 更新 m2-plan DoD 勾选 → M2 收官记录 → 进入 M3（草案已备 docs/m3-plan.md）
- 数值拍板 → 改表 → 重导 → sim 基线对比 → 收数
