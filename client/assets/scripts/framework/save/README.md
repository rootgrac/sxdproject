# framework/save — 存档内核（Cocos 客户端版）

> 状态：M0 原型级（逻辑在 Cocos 外以 tools/client-core-test 单测：9 项全绿）
> 归属：开发文档 §3.5「数据存储方案（单机核心）」

## 文件

| 文件 | 说明 |
| --- | --- |
| `sha256.ts` | 自研同步 SHA-256（零依赖；node:crypto 对拍 + FIPS 向量单测） |
| `save-core.ts` | 存档内核：序列化/校验/备份轮换/损坏回退/版本迁移；存储抽象 KeyValueStorage + KvSaveStore |

## 与 tools/save-prototype 的关系

同一数据模型与语义的两个实现（Node 版原型 vs 客户端 KV 适配版），对拍测试保证行为一致：
- `tools/save-prototype/`（13 测）：Node fs 版（开发期快速原型）
- `tools/client-core-test/`（9 测）：直接 import 本目录文件，用内存 KV 模拟 localStorage 语义

## 存储抽象

- `KeyValueStorage`：get/set/remove/keys —— 浏览器预览（localStorage）与原生端（jsb，待接入）都可实现
- `KvSaveStore`：单槽位存取；槽位 = 一组键 `slot1.json / slot1.backup-N.json / slot1.backup_vN.json`
- 槽位管理（slot1-3 + auto）、自动档快照逻辑将随 SaveManager 落在 modules 层

## 可靠性语义（§3.5）

原子写入（tmp 先写 → 主键覆盖 → 清理）、SHA-256 校验、备份轮换保留 2 份、
损坏自动回退并修复、saveVersion 迁移链（v1→v2 已含）、too-new 档只读保护。
