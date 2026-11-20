# 词库目录

EnglishMate 内置 **16 个词库 / 55,560 条词条 / 去重后 19,331 个不重复单词**。

> 本文档由 `scripts/build-more-dicts.mjs` 与 `scripts/build-dicts.mjs` 的产物汇总而来。
> 重新生成：`node scripts/build-more-dicts.mjs`（可重复运行，缓存优先，不重复消耗 API 配额）。
> 校验：`node scripts/build-more-dicts.mjs --verify`（全量契约检查，词库清单动态读取）。

## 一览

| 顺序 | id        | 名称                | 类别        |        条数 |        体积 |
| ---: | --------- | ------------------- | ----------- | ----------: | ----------: |
|    1 | `primary` | 小学 · 人教版分册   | basic       |         813 |      239 KB |
|    2 | `junior`  | 初中 · 人教版分册   | basic       |       2,260 |      682 KB |
|    3 | `gaokao`  | 高考 · 高中词汇     | basic       |       3,665 |     1.30 MB |
|    4 | `cet4`    | CET-4 · 四级核心    | exam        |       2,607 |      850 KB |
|    5 | `cet6`    | CET-6 · 六级核心    | exam        |       2,345 |      697 KB |
|    6 | `kaoyan`  | 考研 · 核心词       | exam        |       3,731 |     1.04 MB |
|    7 | `tem4`    | 专四 TEM-4          | exam        |       3,922 |     1.02 MB |
|    8 | `tem8`    | 专八 TEM-8          | exam        |      11,858 |     2.87 MB |
|    9 | `ielts`   | 雅思 IELTS          | exam        |       3,575 |      966 KB |
|   10 | `toefl`   | 托福 TOEFL          | exam        |       4,264 |     1.08 MB |
|   11 | `gre`     | GRE                 | exam        |       6,514 |     1.20 MB |
|   12 | `sat`     | SAT                 | exam        |       4,456 |      838 KB |
|   13 | `bec`     | BEC · 商务英语      | exam        |       2,817 |      793 KB |
|   14 | `coding`  | 程序员 · 通用术语   | programming |       1,665 |      527 KB |
|   15 | `linux`   | 程序员 · Linux 命令 | programming |         575 |       78 KB |
|   16 | `medical` | 医学 · 基础术语     | basic       |         493 |       82 KB |
|      |           | **合计**            |             | **55,560** | **14.1 MB** |

`index.json` 的 `banks` 按上表顺序排列（从易到难、先基础后考试再专业），重跑顺序稳定。

## 目标人群与使用建议

| 词库      | 适合谁                       | 建议用法                     |
| --------- | ---------------------------- | ---------------------------- |
| `primary` | 零基础 / 小学生 / 家长陪练   | 起步第一套，练熟 26 键位     |
| `junior`  | 初中生、中考备考             | 承接小学，覆盖中考大纲词汇   |
| `gaokao`  | 高中生、高考复习             | 课标词表，高中三年打底       |
| `cet4`    | 大一新生、四级考生           | 四级备考主力词表             |
| `cet6`    | 六级考生、想再上一层的自学者 | 在四级基础上扩学术与书面表达 |
| `kaoyan`  | 考研党                       | 真题高频 + 熟词僻义          |
| `tem4`    | 英专二年级 / 四级后进阶      | 专四门槛词，兼顾六级提分     |
| `tem8`    | 英专四年级 / 高阶阅读        | 覆盖面最广的高阶词表         |
| `ielts`   | 雅思考生                     | 听说读写主题词 + 学术场景    |
| `toefl`   | 托福考生                     | 校园生活 + 学科讲座场景      |
| `gre`     | GRE 考生                     | 填空与阅读的长难词、同义替换 |
| `sat`     | 美本申请 / SAT 考生          | 阅读写作高频词               |
| `bec`     | 职场人士、商务英语考生       | 职场沟通、贸易与商务文书     |
| `coding`  | 程序员、计算机专业学生       | 数据结构 / 网络 / 数据库术语 |
| `linux`   | 后端 / 运维                  | 敲命令顺便记英文             |
| `medical` | 医学生、医学文献阅读         | 解剖 / 生理 / 药理基础术语   |

## 数据来源与许可

| 来源             | 用途                             | 许可                                 |
| ---------------- | -------------------------------- | ------------------------------------ |
| Qwerty Learner   | 词表（单词 + 中文释义 + 音标）   | MIT                                  |
| ECDICT           | 词性释义、词频、柯林斯星级       | MIT                                  |
| Tatoeba          | 英中对照例句                     | CC-BY 2.0 FR（**必须在应用内署名**） |

词表全部来自 **Qwerty Learner**（<https://github.com/RealKai42/qwerty-learner>，MIT）的
`public/dicts/` 目录，共 380 个分册词表，本项目取其中 16 个。
`meta.source` 字段里逐条标注了具体文件名，`scripts/verify-data.mjs` 会强制校验
`source` 含 `Qwerty Learner` 与 `(MIT)` 字样。

> ⚠️ **许可红线**：TypeWords 是 GPL-3.0，不能拷它的数据；ipa-dict 的 `en_UK` 上游也是 GPL-3.0，
> 只能用 `en_US`。这两条已写进 `docs/HANDOVER.md`，新增数据源时必须先查上游许可。

### 各库构成

| id        | 源文件                                                    | 原始条数 |  产出 | 丢弃说明                    |
| --------- | --------------------------------------------------------- | -------: | ----: | --------------------------- |
| `primary` | `PEPXiaoXue3_1_T.json` … `PEPXiaoXue6_2_T.json`（8 册）   |      849 |   813 | 空释义 3、跨册重复 30       |
| `junior`  | `PEPChuZhong7_1_T.json` … `PEPChuZhong9_1_T.json`（5 册） |    2,320 | 2,260 | 空释义 21、跨册重复 38      |
| `tem4`    | `Level4luan_2_T.json`                                     |    4,025 | 3,922 | 清理解析噪声 103            |
| `tem8`    | `Level8luan_2_T.json`                                     |   12,197 | 11,858 | 空释义 339（原按体积截断 8000，2026-11-21 已放开） |
| `sat`     | `SAT_3_T.json`                                            |    4,464 | 4,456 | 释义噪声 7、重复 1          |
| `bec`     | `BEC_2_T.json` + `BEC_3_T.json`                           |    5,578 | 2,817 | 两册重叠 2,692、噪声 69     |
| `coding`  | `itVocabulary.json`                                       |    1,665 | 1,665 | 源里混入音标碎片，已剥离    |
| `medical` | `BIOmedical.json`                                         |      560 |   493 | 重复 24、人工剔除 43        |

既有 8 库（由 `scripts/build-dicts.mjs` 产出）：
`cet4`(`CET4_T.json`) / `cet6`(`CET6_T.json`) / `kaoyan`(`KaoYan_2024.json`) /
`ielts`(`IELTS_3_T.json`) / `toefl`(`TOEFL_3_T.json`) / `gre`(`GRE_3_T.json`) /
`gaokao`(`GaoZhongluan_2_T.json`) / `linux`(`linux-command.json`)

## 体积与按需加载

单文件体积**不等于用户实际下载量**。词库是按需 fetch 的（`src/data/wordbanks.ts` 的
`loadWords()`：进入某个词库时才下载，加载后在内存里缓存），首屏不加载任何词库。
传输层还会再压缩一层，以最大的 `tem8` 为例：

| 词库     | 原始   | gzip 后 | brotli 后 |
| -------- | ------ | ------- | --------- |
| `tem8`   | 2.87MB | 1.12MB  | 734KB     |
| `gaokao` | 1.30MB | 530KB   | 349KB     |
| `gre`    | 1.20MB | 464KB   | 336KB     |

### tem8 截断已放开（2026-11-21）

之前 `BANKS` 里 `tem8` 有 `limit: 8000`，源文件 12,197 条只取前 8,000 条，
理由是「全量约 2.5MB，超出首屏可接受范围」。这个判断有两个问题：

1. **体积顾虑不成立**：词库本来就不在首屏加载，2.87MB 与 `gaokao`(1.30MB) / `gre`(1.20MB)
   同一量级，brotli 后只有 734KB。
2. **按源顺序截断会成片丢词**：源文件顺序不等于难度顺序。实测截断后词表停在 `slime`，
   按字母序靠后的词大量缺失，等于随机丢掉 4,197 个高阶词。

现已放开，全量产出 11,858 条（原始 12,197，丢弃 339 条空释义）。
`scripts/build-more-dicts.mjs` 的 `BANKS[].limit` 机制保留，将来若真要截断应显式声明，
不要靠隐式丢弃。

## 数据清洗规则

源数据是社区维护的词表，混入了词典软件的导出残留。脚本按下列规则清洗（顺序即代码里的执行顺序）：

| 问题                   | 样本                                  | 处理                            |
| ---------------------- | ------------------------------------- | ------------------------------- |
| 音标混进释义           | `v./a.完成；完整的,,(ka,mu,pe,li,te)` | 从 `,,` 起整段丢弃              |
| 音标混进释义（圆括号） | `n.扩充(ei,ke,si,ten,de)`             | 括号内是 3 段以上短字母串则剥离 |
| 学科标签行             | `[计] 后端, 总线允许`                 | 整行丢弃                        |
| 中文人名条目           | `隐藏的；…；(Hidden)人名`             | 含"人名"的分句丢弃              |
| 人名音译               | `(英)希登` / `(法、阿拉伯)阿米德`     | 括号内只有国家/地区名时丢弃     |
| 纯屈折变化             | `seal的复数形式`                      | 整条丢弃（无增量信息）          |
| glossary 导出噪声      | `释义：多价抗血清` / `??病`           | 关键词剥离                      |
| 未闭合方括号           | `渗透性；[物`                         | 截到残片前                      |
| 词性用 & 串联          | `v.&,n.帮助`                          | 改写成 `v./n.帮助`              |
| 词条自我重复           | `testis: 睾丸`                        | 去掉 `testis:` 前缀             |
| 词组末尾句号           | `house.` / `go swimming.`             | 砍掉（缩写白名单除外）          |
| 省略号不统一           | `from... to...`                       | 统一成全角 `……` / `…`           |
| 单词内斜杠分隔         | 释义里的 `a \| b \| c`                | 按竖线拆义项                    |

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

### 例句覆盖

32,312 / 55,560 = **58.2%** 的词条带例句，共 57,257 对中英例句。
分库覆盖率差异大，冷僻词与命令名在 Tatoeba 的 7.8 万对英中语料里本就罕见，不是代码问题：

| 覆盖高                                            | 覆盖低                                       |
| ------------------------------------------------- | -------------------------------------------- |
| gaokao 93% / cet4 86% / primary 84% / junior 81%  | gre 30% / sat 30% / medical 24% / linux 20%   |

其余词条只有词性释义、没有例句，界面按字段存在性渲染（有就显示「例句」区，没有就不显示）。

## 契约

每个 `public/dicts/<id>.json`：

```jsonc
{
  "meta": {
    "id": "tem4", // 与文件名一致
    "name": "专四 TEM-4",
    "category": "exam", // 只能是 exam | programming | basic
    "description": "…",
    "count": 3922, // 必须等于 words.length
    "source": "Qwerty Learner (MIT) · public/dicts/Level4luan_2_T.json",
  },
  "words": [{ "w": "flutter", "t": "飘动；鼓翼；烦扰", "p": "/'flʌtɚ/" }],
}
```

- `w` 在**同一词库内**小写后唯一；长度 1–64；不含换行。
- `t` 非空；不含 `\n` 字面量、未闭合方括号、`释义：`、`??` 等残留。
- `p` 可选；有则必须形如 `/…/`。
- `defs` / `sentences` 由另一条流水线补，本脚本不产出。

## 如何新增 / 修改词库

1. 在 `scripts/build-more-dicts.mjs` 的 `BANKS` 数组里加一项（`files` 指向 Qwerty Learner 的分册文件名）。
2. `node scripts/build-more-dicts.mjs`（走 `.tmp/` 缓存，不联网；`--only=<id>` 只重建一个）。
3. `node scripts/build-rich-dicts.mjs --offline --only=<id>` 补词性释义与例句。
4. `node scripts/verify-data.mjs` 验收。
5. 更新本文档的表格数字。

## 校验

```bash
node scripts/build-more-dicts.mjs --offline   # 重建 + 自检（条数/重复/空释义/音标/噪声）
node scripts/build-more-dicts.mjs --verify    # 全量契约校验（等价于 verify-data.mjs 的词库部分）
npx tsc --noEmit                              # 类型检查
node scripts/verify-data.mjs                  # 全量数据契约
```

`scripts/verify-data.mjs` 的词库清单是**动态读取** `index.json` 的，不硬编码库数，
所以增删词库不需要改脚本（本轮已确认它 16 个库全过）。
