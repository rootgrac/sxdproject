# tools/excel2json — 导表工具（§3.6）

> 状态：M1 进行中（TSV/CSV 源可用；Excel .xlsx 读取待接入——零依赖期用 TSV/CSV，Excel 可直接另存为）

## 表格式约定（§3.6）

- 表头**三行**：`字段名 / 类型 / 注释`；**首列 = 主键**（导出时校验非空且唯一）
- 类型：`str` `int` `float` `bool` `str[]` `int[]`（数组单元格用 `;` 分隔）
- 跨表引用：`ref:<表名>.<列名>`（如 `ref:skill.id`），导出时校验引用存在
- 行首 `#` = 表级注释；空行忽略
- 空单元格 = 类型默认值（str `""` / int 0 / float 0 / bool false / 数组 `[]`）

## 用法

```bash
# 导出 config/tables → config/export（表源与导出 JSON 均入库）
node tools/excel2json/src/run.ts          # 默认目录
node tools/excel2json/src/run.ts <源目录> <导出目录>   # 自定义
npm test                                  # 单测（解析/类型/主键/引用/导出）
```

校验失败时打印全部错误并不写任何导出文件（退出码 1）。

## 后续（M1-2 之后）

- Excel `.xlsx` 直读（zip+XML 解析，零依赖可做）
- 枚举集中定义与常量导出、索引构建（byId map）、JSON Schema 输出
- 与 client 资源目录联动（`client/assets/resources/config`）
