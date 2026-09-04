# tools/save-prototype — 存档系统纯 TS 原型

> 状态：**M0 原型 v0.1 已落地**（零第三方依赖，Node ≥24 原生 type-stripping 直接运行）
> 归属：开发文档 §3.5「数据存储方案（单机核心）」

## 运行

```bash
cd tools/save-prototype
npm test        # node --experimental-test-isolation=none --test "test/*.test.ts"
```

## 已实现（§3.5 最小闭环）

| 能力 | 实现 | 对应条款 |
| --- | --- | --- |
| 原子写入 | 临时文件 + rename 覆盖，无残留 | §3.5-2 |
| SHA-256 校验 | 文件内嵌 `sha256(data)`，读取时重算比对 | §3.5-2/4 |
| 备份轮换 | 写前主档轮换进 backups/，保留最近 2 份 | §3.5-2 |
| 损坏自动回退 | 主档损坏 → 按 backup-1/2 逐份尝试 → 恢复后回写主档 | §3.5-2 |
| 版本迁移 | saveVersion + 迁移函数链（v1→v2 已含 mailbox 示例）；迁移前另存 `backup_v{n}`，迁移后立即写盘 | §3.5-3 |
| 防误覆盖 | `create()` 对占用槽位 / 更高版本档拒绝覆盖；too-new 档只读保护 | §3.5-4 延伸 |
| fixtures 回归 | `test/fixtures/save_v1.json` + 迁移测试 | §5.5-1 |

## 与 Cocos 客户端的边界（移植注意）

- 本原型运行于 Node（node:crypto / node:fs）；移植到 `client/assets/scripts/framework/save/` 时，
  IO 与哈希需替换为 Cocos 原生能力（jsb 文件系统 / 自实现 SHA-256），**内核接口保持不变**，便于迁移回归复用。
- 30 秒批量写盘、关键节点立即写盘（战斗结束 / 内购到账 / 关卡通关 / 退后台）属于运行时调度层，不在本内核。
- 每日重置、体力恢复、时间回拨容错属本地日历服务（§3.5-5），不在本内核。
- 多槽位（3 手动 + 1 自动）在此之上扩展：一个槽位 = 一组 slotN.json + 备份链。

## 目录

```
tools/save-prototype/
├── package.json
├── src/core.ts               # SaveStore / 序列化校验 / 迁移链
└── test/
    ├── save.test.ts          # 可靠性单测（往返/轮换/回退/篡改/迁移/防覆盖）
    └── fixtures/save_v1.json # v1 版本存档样本
```
