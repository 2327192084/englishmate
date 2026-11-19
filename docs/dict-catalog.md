# 词库目录

EnglishMate 内置 **16 个词库 / 51,702 条词条 / 去重后 18,716 个不重复单词**。

> 本文档由 `scripts/build-more-dicts.mjs` 与 `scripts/build-dicts.mjs` 的产物汇总而来。
> 重新生成：`node scripts/build-more-dicts.mjs`（可重复运行，缓存优先，不重复消耗 API 配额）。
> 校验：`node scripts/build-more-dicts.mjs --verify`（全量契约检查，词库清单动态读取）。

## 一览

| 顺序 | id | 名称 | 类别 | 条数 | 体积 |
|---:|---|---|---|---:|---:|
| 1 | `primary` | 小学 · 人教版分册 | basic | 813 | 35 KB |
| 2 | `junior` | 初中 · 人教版分册 | basic | 2,260 | 118 KB |
| 3 | `gaokao` | 高考 · 高中词汇 | basic | 3,665 | 1.30 MB |
| 4 | `cet4` | CET-4 · 四级核心 | exam | 2,607 | 850 KB |
| 5 | `cet6` | CET-6 · 六级核心 | exam | 2,345 | 697 KB |
| 6 | `kaoyan` | 考研 · 核心词 | exam | 3,731 | 1.04 MB |
| 7 | `tem4` | 专四 TEM-4 | exam | 3,922 | 278 KB |
| 8 | `tem8` | 专八 TEM-8 | exam | 8,000 | 570 KB |
| 9 | `ielts` | 雅思 IELTS | exam | 3,575 | 966 KB |
| 10 | `toefl` | 托福 TOEFL | exam | 4,264 | 1.08 MB |
| 11 | `gre` | GRE | exam | 6,514 | 1.20 MB |
| 12 | `sat` | SAT | exam | 4,456 | 290 KB |
| 13 | `bec` | BEC · 商务英语 | exam | 2,817 | 205 KB |
| 14 | `coding` | 程序员 · 通用术语 | programming | 1,665 | 102 KB |
| 15 | `linux` | 程序员 · Linux 命令 | programming | 575 | 78.6 KB |
| 16 | `medical` | 医学 · 基础术语 | basic | 493 | 27.2 KB |
| | | **合计** | | **51,702** | **8.74 MB** |

`index.json` 的 `banks` 按上表顺序排列（从易到难、先基础后考试再专业），重跑顺序稳定。

## 目标人群与使用建议

| 词库 | 适合谁 | 建议用法 |
|---|---|---|
| `primary` | 零基础 / 小学生 / 家长陪练 | 起步第一套，练熟 26 键位 |
| `junior` | 初中生、中考备考 | 承接小学，覆盖中考大纲词汇 |
| `gaokao` | 高中生、高考复习 | 课标词表，高中三年打底 |
| `cet4` | 大一新生、四级考生 | 四级备考主力词表 |
| `cet6` | 六级考生、想再上一层的自学者 | 在四级基础上扩学术与书面表达 |
| `kaoyan` | 考研党 | 真题高频 + 熟词僻义 |
| `tem4` | 英专二年级 / 四级后进阶 | 专四门槛词，兼顾六级提分 |
| `tem8` | 英专四年级 / 高阶阅读 | 覆盖面最广的高阶词表 |
| `ielts` | 雅思考生 | 听说读写主题词 + 学术场景 |
| `toefl` | 托福考生 | 校园生活 + 学科讲座场景 |
| `gre` | GRE 考生 | 填空与阅读的长难词、同义替换 |
| `sat` | 美本申请 / SAT 考生 | 阅读写作高频词 |
| `bec` | 职场人士、商务英语考生 | 职场沟通、贸易与商务文书 |
| `coding` | 程序员、计算机专业学生 | 数据结构 / 网络 / 数据库术语 |
| `linux` | 后端 / 运维 | 敲命令顺便记英文 |
| `medical` | 医学生、医学文献阅读 | 解剖 / 生理 / 药理基础术语 |

## 数据来源与许可

全部数据来自 **Qwerty Learner**（<https://github.com/RealKai42/qwerty-learner>，**MIT License**）的 `public/dicts/` 目录，共 380 个分册词表，本项目取其中 16 个。

**所有词库的许可统一为 MIT**，`meta.source` 字段里逐条标注了具体文件名，`scripts/verify-data.mjs` 会强制校验 `source` 含 `Qwerty Learner` 与 `(MIT)` 字样。

### 本轮新增（8 个）

| id | 源文件 | 原始条数 | 产出 | 丢弃说明 |
|---|---|---:|---:|---|
| `primary` | `PEPXiaoXue3_1_T.json` … `PEPXiaoXue6_2_T.json`（8 册） | 849 | 813 | 空释义 3、跨册重复 30 |
| `junior` | `PEPChuZhong7_1_T.json` … `PEPChuZhong9_1_T.json`（5 册） | 2,320 | 2,260 | 空释义 21、跨册重复 38 |
| `tem4` | `Level4luan_2_T.json` | 4,025 | 3,922 | 清理解析噪声 103 |
| `tem8` | `Level8luan_2_T.json` | 12,197 | 8,000 | 按体积上限截断（见下） |
| `sat` | `SAT_3_T.json` | 4,464 | 4,456 | 释义噪声 7、重复 1 |
| `bec` | `BEC_2_T.json` + `BEC_3_T.json` | 5,578 | 2,817 | 两册重叠 2,692、噪声 69 |
| `coding` | `itVocabulary.json` | 1,665 | 1,665 | 源里混入音标碎片，已剥离 |
| `medical` | `BIOmedical.json` | 560 | 493 | 重复 24、人工剔除 43 |

### 既有（8 个，由 `scripts/build-dicts.mjs` 产出）

`cet4`(`CET4_T.json`) / `cet6`(`CET6_T.json`) / `kaoyan`(`KaoYan_2024.json`) /
`ielts`(`IELTS_3_T.json`) / `toefl`(`TOEFL_3_T.json`) / `gre`(`GRE_3_T.json`) /
`gaokao`(`GaoZhongluan_2_T.json`) / `linux`(`linux-command.json`)

## 扩充效果

| 指标 | 扩充前 | 扩充后 | 变化 |
|---|---:|---:|---:|
| 词库数 | 8 | **16** | +8 |
| 词条总数 | 27,276 | **51,702** | **+24,426（+89.6%）** |
| 去重后单词数 | 13,987 | **18,716** | **+4,729（+33.8%）** |
| 总体积 | 7.16 MB | 8.74 MB | +1.58 MB |

### 新增词库与原 8 库的重叠率

新词库与原 8 库共享大量基础词（这是正常的——同一个人可能同时备考四级和专四）。各库的**净新增**词汇：

| 词库 | 条数 | 与原 8 库重叠 | 重叠率 | 净新增 |
|---|---:|---:|---:|---:|
| `primary` | 813 | 602 | 74.0% | 211 |
| `junior` | 2,260 | 1,729 | 76.5% | 531 |
| `tem4` | 3,922 | 3,033 | 77.3% | 889 |
| `tem8` | 8,000 | 5,976 | 74.7% | 2,024 |
| `sat` | 4,456 | 3,359 | 75.4% | 1,097 |
| `bec` | 2,817 | 2,337 | 83.0% | 480 |
| `coding` | 1,665 | 1,381 | 82.9% | 284 |
| `medical` | 493 | 200 | 40.6% | 293 |

`medical` 重叠率最低（40.6%），专业术语的增量价值最高；`bec` / `coding` 重叠率偏高，但它们覆盖的是**场景**而非新词——同一个词在商务/编程语境下的义项更贴题。

## 体积与截断说明

- 单个词库最大 1.30 MB（`gaokao`，数据源本身偏大，非本轮产物）。
- 本轮新增的 8 个词库里最大的是 `tem8`（570 KB）。
- **`tem8` 做了截断**：源文件 `Level8luan_2_T.json` 有 12,197 条，全量产出会到 2.5 MB，超过首屏加载的可接受范围。脚本按源文件顺序取前 8,000 条（同源同质），释义质量与完整版完全一致。如后续要放开，删掉 `BANKS` 里 `tem8` 的 `limit: 8000` 一行即可，`scripts/build-more-dicts.mjs` 会重新生成。
- 截断在 `build-more-dicts.mjs` 的 `BANKS[].limit` 里显式声明，不是隐式丢弃。

## 数据清洗规则

源数据是社区维护的词表，混入了词典软件的导出残留。脚本按下列规则清洗（顺序即代码里的执行顺序）：

| 问题 | 样本 | 处理 |
|---|---|---|
| 音标混进释义 | `v./a.完成；完整的,,(ka,mu,pe,li,te)` | 从 `,,` 起整段丢弃 |
| 音标混进释义（圆括号） | `n.扩充(ei,ke,si,ten,de)` | 括号内是 3 段以上短字母串则剥离 |
| 学科标签行 | `[计] 后端, 总线允许` | 整行丢弃 |
| 中文人名条目 | `隐藏的；…；(Hidden)人名` | 含"人名"的分句丢弃 |
| 人名音译 | `(英)希登` / `(法、阿拉伯)阿米德` | 括号内只有国家/地区名时丢弃 |
| 纯屈折变化 | `seal的复数形式` | 整条丢弃（无增量信息） |
| glossary 导出噪声 | `释义：多价抗血清` / `??病` | 关键词剥离 |
| 未闭合方括号 | `渗透性；[物` | 截到残片前 |
| 词性用 & 串联 | `v.&,n.帮助` | 改写成 `v./n.帮助` |
| 词条自我重复 | `testis: 睾丸` | 去掉 `testis:` 前缀 |
| 词组末尾句号 | `house.` / `go swimming.` | 砍掉（缩写白名单除外） |
| 省略号不统一 | `from... to...` | 统一成全角 `……` / `…` |
| 单词内斜杠分隔 | 释义里的 `a|b|c` | 按竖线拆义项 |

**保留原文的地方**：英文缩写（`a.m.` `p.m.` `P.E.` `Mr.` `Ms.` 等，走白名单）、语境限定词（`（外）祖母` `（口语）爸爸`）、多义项最多保留 3 个。

## 与例句流水线的协作

`scripts/build-rich-dicts.mjs`（另一条流水线）会给词条补上 `defs`（ECDICT 词性释义）与
`sentences`（Tatoeba 例句），并在 `meta.source` 末尾追加署名。它通过读 `index.json`
拿到词库清单，所以**新词库会被自动纳入**，无需改那个脚本。

本脚本重跑时会把文件整体重写，因此专门做了保护：

- 重建前先读旧文件，把 `defs` / `sentences` 按单词小写键接回来；
- 旧 `source` 若以本轮基础 source 开头且更长（说明带着下游追加的署名），沿用它。

所以 `build-more-dicts.mjs` 与 `build-rich-dicts.mjs` 可以任意顺序重跑，不丢富化成果。
日志里的 `保留富化 N` 就是接回的词条数。

## 契约

每个 `public/dicts/<id>.json`：

```jsonc
{
  "meta": {
    "id": "tem4",              // 与文件名一致
    "name": "专四 TEM-4",
    "category": "exam",        // 只能是 exam | programming | basic
    "description": "…",
    "count": 3922,             // 必须等于 words.length
    "source": "Qwerty Learner (MIT) · public/dicts/Level4luan_2_T.json"
  },
  "words": [
    { "w": "flutter", "t": "飘动；鼓翼；烦扰", "p": "/'flʌtɚ/" }
  ]
}
```

- `w` 在**同一词库内**小写后唯一；长度 1–64；不含换行。
- `t` 非空；不含 `\n` 字面量、未闭合方括号、`释义：`、`??` 等残留。
- `p` 可选；有则必须形如 `/…/`。
- `defs` / `sentences` 由另一条流水线补，本脚本不产出。

## 校验

```bash
node scripts/build-more-dicts.mjs --offline   # 重建 + 自检（条数/重复/空释义/音标/噪声）
node scripts/build-more-dicts.mjs --verify    # 全量契约校验（等价于 verify-data.mjs 的词库部分）
npx tsc --noEmit                              # 类型检查
node scripts/verify-data.mjs                  # 全量数据契约（见下）
```

> ⚠️ **`scripts/verify-data.mjs` 目前硬编码了 8 个词库**（`BANK_IDS` 常量，且断言
> `index.banks.length === 8`），词库扩到 16 个后它会报两类失败：
> `[index] banks 应为 8 项` 与 `[index] banks 的 count 之和与词条总数不符`。
> 这是**预期内的**，需要把该脚本里的 `BANK_IDS` 同步成 16 个 id 才能通过。
> 按分工约定本方未修改该脚本。
>
> 在同步之前，用 `--verify` 替代（校验同样的契约，只是词库清单从 `index.json` 动态读取）：
>
> ```bash
> node scripts/build-more-dicts.mjs --verify
> ```
>
> 另有 `[articles] 执行模块失败` 一类报错，来自并行的例句流水线对 `src/data/articles.ts`
> 的改动，与本轮词库工作无关。
