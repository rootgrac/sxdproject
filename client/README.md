# client — Cocos Creator 客户端工程

> 状态：**骨架已初始化**（基于官方 empty-2d 模板 + Creator 3.8.8），**待首次打开导入**
> ⚠️ 尚未被 Creator 打开过（无 library/temp/资源 meta）——请用 Cocos Dashboard「打开其他项目」选择本目录完成首次导入

- 编辑器版本：Cocos Creator **3.8.8**（`C:\ProgramData\cocos\editors\Creator\3.8.8`）
- 语言：TypeScript（严格模式从 M0 代码落地起启用，见根 `battle-core` 风格）
- 引擎模块：已按 2D 横版回合制裁剪（2d / spine / ui / audio / tween / particle-2d / tiled-map…见 `settings/v2/packages/engine.json`）

## 首次导入（一次性，需在桌面操作）

1. 运行 `D:\CocosDashboard\CocosDashboard.exe`
2. 「项目」→「打开其他项目」→ 选择本目录（`D:\sxdproject\client`）
3. Creator 3.8.8 将生成 `library/`、`temp/`、资源 `.meta` 等（这些目录已被 `.gitignore` 排除，不入库）
4. 可顺手新建场景保存为 `assets/scenes/Main.scene`

## 脚本组织（`assets/scripts/`，开发文档 §3.3）

```
assets/scripts/
├── framework/   # 与业务无关的公共层（save / ui / res / audio / event / config / utils）
├── modules/     # 业务模块（view / model / service 结构）
└── battle-core/ # 纯 TS 战斗内核（自根 battle-core 包移植或引用）
```

- 里程碑目标：M0 真机可玩 3v3 战斗 demo；详见开发文档 §4.1
