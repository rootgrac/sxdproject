# battle-core — 纯 TS 确定性战斗内核

> 状态：**M1 内核完成**（零第三方依赖，Node ≥24 原生 type-stripping 直接运行）
> 数值为占位，M1 起数值全部由 config/tables 导表驱动（改表 → 重导 → 生效）

## 运行

```bash
cd battle-core
npm test        # node --experimental-test-isolation=none --test "test/*.test.ts"
```

## 已实现（§3.4 / M1）

- **确定性**：种子 PRNG（mulberry32），同输入必同结果 → 回放与结果校验的基础
- **战斗流程**：速度降序行动 → 气势 ≥100 放绝技（清零）否则普攻 → 全灭获胜 / 超回合判平
- **普攻判定**：命中率 = acc/(acc+eva)（夹 [0.05,0.95]）；命中 +25 气势，被击 +15（占位参数）
- **技能效果器（M1-6）**：技能 = 效果器列表（damage/heal/buff/debuff × target/stat/duration），
  由 `skill_effect` 表驱动（buildEffects）；cast + effect 事件流；增减益属性乘区（回合制）
- **3×3 布阵（M1-5）**：Unit.position；目标选择列号最小优先（前排先承受）；站位加成 frontDef/backAtk
- **配置驱动（M1-3）**：setup.buildUnits（unit/skill 表行 → 战斗单位，绝技倍率注入）
- **事件流**：round/attack/skill/effect/death/end，结算与表现分离（§3.4）

## 目录

```
battle-core/
├── package.json / tsconfig.json
├── src/rng.ts       # 确定性 PRNG
├── src/model.ts     # Unit / BattleConfig / SkillEffectDef / 事件流类型
├── src/engine.ts    # runBattle 结算内核（效果器 + buff + 布阵）
├── src/setup.ts     # 导表行 → 单位/效果器（buildUnits/buildEffects）
└── test/            # combat / setup / effect / position 共 22 项
```

## 未实现（规划）

- 完整属性模型（三功三防分离、韧性/格挡/破击）
- 目标选择细化（同列行序随机、范围技 target=all）
- 回放自校验、数值越界检测（P1）、批量模拟器回归（tools/sim 雏形已可用）
- TypeScript 编译器与严格类型检查（`tsconfig.json` 已就位，网络可用后 `npm i -D typescript`）
