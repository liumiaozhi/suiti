# 随题 · 微信小程序版

把桌面版「随题」（Python + pywebview + SQLite）移植为原生微信小程序。**业务规则与导出卷面 1:1 对齐**，不引入任何构建工具。

> 当前进度：**P5 完成**。工程骨架 + golden 样本 + 体积预算 + `core/` 纯逻辑 + 存储层与题库 CRUD + 做题闭环（练习/考试答题、交卷评分、结果、重难错题）+ Excel 导入/导出（内置 SheetJS，模板运行时生成），44 个单测 + 模拟器端到端全绿，真机预览可用。
> 下一步：云开发多端同步（P6，可选）；导入/导出需真机 + AppID 验收。

## 快速开始

```bash
# 打开工程（需先启动微信开发者工具）
open-devtools.bat

# 一口气跑完全部检查（结构 + 单测 + 体积）
npm run check

# 或分开跑
node tools/check-structure.mjs              # 目录/页面/配置完整性
node --test "tests/node/core/*.test.js"     # core 纯逻辑单测（不依赖开发者工具）
node tools/size-budget.mjs                  # 包体积预算（主包/分包各 ≤1.6MB）

# 重新生成 golden 样本（桌面版规则改动后必须重跑，再让单测对齐）
python tools/dump_fixtures.py --src "D:/AI工具库/workbuddy工作空间/随我题" --out tests/fixtures
```

## core 模块（P1，`miniprogram/core/`）

| 文件 | 对应桌面版 | 说明 |
|---|---|---|
| `pycompat.js` | — | **银行家舍入** `pyRound`、`fmtScore`、`accuracy`、本地时间 `nowStr` |
| `text.js` | `grading.py` 文本部分、`bank_import._cell_text` | 分隔符/标签剥离、NFKC、单元格值转文本 |
| `grading.js` | `grading.py` | 答案解析、题型识别、打乱映射、判分、**答题括号** |
| `settings.js` | `session.normalize_settings` / `_pick_count` | 按题型分值、数量、顺序 |
| `paper.js` | `session.preview` / `create_session` 抽题部分 | 题型间固定顺序、题型内排序、建卷 items |
| `importer.js` | `bank_import` 解析部分 | 两种选项写法、判断题容错、报错带行号 |
| `exportModel.js` | `export/model.py` | 卷头三栏、大题副标题、答案页、文件名 |
| `stats.js` | `session.submit` / `_summary` / `stats.py` | 判分、两种记录的统计口径 |

## 存储层（P2）

`wx.setStorageSync` 单 key 只有 1MB、总量 10MB，而一个 1000 题的题库就有 0.5–1.5MB，
所以采用**索引进 storage、正文进文件**：

```
storage（每 key ≤300KB）              文件（USER_DATA_PATH/db/，200MB）
  suiti:v            schema 版本        banks/<id>/meta.json + q.<k>.json   每片 200 题
  suiti:idx:banks    题库索引           sess/<id>/head.json + items.<k>.json 每片 50 题
  suiti:idx:sess     会话索引（300 条） sess/<id>/ans.json                   作答增量（几 KB）
  suiti:idx:hard     重难错题汇总       hard/<bankId>.json
```

- `utils/chunkStore.js` 按 300KB 阈值自动分流；storage 写满时降级到文件且不丢数据（已单测覆盖）。
- **作答只写增量**，不重写 200 题快照；交卷时合并重算（对应桌面版"每条作答一个事务"）。
- 原子写：先写 `.tmp` 再 rename。

**可测试性**：`repo/local.js` 不直接 require wx，storage/fs/clock/rng 全部依赖注入，
`tests/node/fakes/` 提供内存实现，因此 Node 里能跑完整的存储层单测。

## 目录

```
miniprogram/            小程序源码（miniprogramRoot）
  core/                 纯逻辑：不 require wx、不读全局、RNG/时钟注入 —— Node 可直接跑
  adapters/             唯一碰 wx 的地方（storage/fs/canvas/doc/clock/rng）
  utils/                polyfill、config、nav、ui、repo 门面
  components/           公共组件
  pages/                主包页面：home banks hard records setup practice exam result（8 页）
  pkg-io-import/        分包：Excel 导入（内置 SheetJS，模板运行时生成）
  pkg-io-export/        分包：导出（内置 SheetJS，导出 xlsx）
tests/
  fixtures/             golden 样本（由桌面版真实函数生成，**要提交**）
  node/                 node --test 单测
  e2e/                  miniprogram-automator 模拟器回归
tools/
  dump_fixtures.py      从桌面版导 golden
  size-budget.mjs       包体积守卫
  check-structure.mjs   工程结构自检
```

## 关键约束（踩过的坑，别重犯）

| 约束 | 说明 |
|---|---|
| 单包 2MB | 主包与**每个分包**都受 2MB 限制。导入/导出必须拆两个分包，不能塞一个 |
| storage 1MB/key、10MB 总量 | 索引进 storage，题库/会话正文进 `USER_DATA_PATH` 文件 |
| Excel 解析 | 内置 SheetJS（vendored UMD）。读取用 `binary string` + `type:'binary'`，规避小程序无稳定 `atob`/`Buffer` 导致 `XLSX.read` 把字节当字符串的坑；写入直接 `XLSX.write(...,{type:'array'})` 交给 `writeFile` |
| PDF 无中文字体 | canvas 渲染 → JPEG → pdf-lib 嵌图，避开字体嵌入 |
| `openDocument` 约 10MB 上限 | 图片型 PDF 必须 ≤8MB，超了拆卷 |
| 时间禁用 `toISOString()` | Python 侧是本地时间，用 `toISOString` 会差 8 小时 |
| `round(2.5)` | Python 是银行家舍入（=2），JS 要自己实现 `pyRound` |

## 阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 骨架、golden、体积预算、模板 | ✅ |
| P1 | `core/*` 纯逻辑 + node 单测对齐 golden（31 项） | ✅ |
| P2 | 存储层（索引/文件分层）+ 题库 CRUD + 首页/题库/记录三页（40 项） | ✅ |
| P3 | 做题闭环（建卷/练习/考试/结果/重难错题） | ✅ |
| P4 | Excel 导入（内置 SheetJS，模板运行时生成） | ✅ |
| P5 | 导出（内置 SheetJS 导出 xlsx） | ✅ |
| P6 | 云开发（换手机同步，可选） | 待做 |

## 与桌面版的关系

- 桌面版仓库：<https://github.com/liumiaozhi/suiti>
- 业务规则以桌面版为准，映射关系见 `C:\Users\pacxzsa\.workbuddy\plans\quantum-aurora-tesla-_nH-AoHW.md` 第六节（B1–B18）。
- golden 样本 `tests/fixtures/*.json` 是从桌面版**真实函数**跑出来的，任何规则改动都要先重跑 `dump_fixtures.py` 再让单测对齐。
