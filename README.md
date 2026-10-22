# 随题（suiti）

同一产品、两个端的 monorepo 仓库。两项目**互不影响、互不覆盖**，各自维护。

| 子目录 | 端 | 技术栈 | 说明 |
| --- | --- | --- | --- |
| [`desktop/`](desktop/) | 桌面端（Windows） | Python + pywebview + SQLite | 随题桌面版 v1.2.0，本地题库管理、出卷、练习、考试、导出 Word/Excel |
| [`mini/`](mini/) | 微信小程序 | 原生小程序（无构建） | 随题小程序，题库导入/导出、练习、考试、重难错题 |

## 数据隔离说明

- 桌面端的题库与作答记录存于本地 SQLite（`.db`，已在 `.gitignore` 排除），不会进仓库。
- 小程序端的缓存、题库、作答记录仅存于微信运行时的 `USER_DATA_PATH` 用户空间，**不在工程源码目录内**，因此 clone 本仓库得到的是干净代码（仅含代码内的演示库种子），不携带任何用户数据。
- 两子项目均已在各自目录内置 `.gitignore`，提交前已确认无缓存/题库数据入库。

## 目录约定

- `desktop/` —— 直接对应桌面版工程；构建交付物 `dist/随题.exe` 默认不入库，需时按 `desktop/build/build.ps1` 重新构建。
- `mini/` —— 微信开发者工具打开 `mini/` 目录即可；导入导出依赖内置 `miniprogram/vendor/xlsx.full.min.js`（SheetJS UMD）。
