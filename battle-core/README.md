# battle-core — 纯 TS 确定性战斗内核

> 状态：**M0 原型 v0.1 已落地**（零第三方依赖，Node ≥24 原生 type-stripping 直接运行）
> 所有数值为占位，M1 前按 `docs/开发文档.md` §3.6 定稿

## 运行

```bash
cd battle-core
npm test        # node --experimental-test-isolation=none --test "test/*.test.ts"
```

## 已实现（§3.4 子集）

- **确定性**：种子 PRNG（mulberry32），同输入（阵容/种子/配置）必同结果 → 回放与结果校验的基础
- **战斗流程**：每轮按速度降序行动 → 气势 ≥100 放绝技（必中、清零）否则普攻 → 一方全灭获胜 / 超回合判平
- **普攻判定**：命中率 = acc/(acc+eva)（夹 [0.05,0.95]）；命中后自身 +25 气势，被击 +15（占位参数）
- **伤害**：dmg = floor(atk×ratio − def×0.6)，暴击 ×1.5，下限 1（占位公式）
- **事件流**：结算与表现分离雏形（`round / attack / skill / death / end`），演出层只消费事件

## 目录

```
battle-core/
├── package.json / tsconfig.json
├── src/rng.ts       # 确定性 PRNG
├── src/model.ts     # Unit / BattleConfig / 事件流类型（makeUnit 便捷构造）
├── src/engine.ts    # runBattle 结算内核
└── test/combat.test.ts
```

## 未实现（规划）

- 完整属性模型（绝攻/法攻/韧性/格挡/破击…）、三功三防分离
- 技能与效果器配置表驱动（伤害段/治疗/增减益/召唤），绝技统一倍率仅占位
- 九宫格站位与阵型加成（M1 布阵系统）、目标选择规则细化
- 回放自校验、数值越界检测（P1）、批量战斗模拟器（≥1000 场平衡回归）
- TypeScript 编译器与严格类型检查（`tsconfig.json` 已就位，网络可用后 `npm i -D typescript`）
