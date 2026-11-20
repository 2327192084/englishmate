# 文章语料来源与许可

本文档记录 EnglishMate 文章语料（`public/articles/index.json`）每一部分的**实测来源、许可结论与处理方式**。
所有结论均为本机实测，不是凭记忆填写。

---

## 一、总结

| 项           | 数值                                      |
| ------------ | ----------------------------------------- |
| 文章总数     | **75 篇**                                 |
| 句子总数     | **490 句**                                |
| 语料源       | Project Gutenberg（公版）+ 本项目人工译文 |
| 许可         | 公版作品（无版权限制）+ 译文随仓库 MIT    |
| 是否需要署名 | 否（公版已进入公有领域）                  |

level 分布：

| level | 篇数 |
| ----- | ---- |
| CET-4 | 22   |
| CET-6 | 21   |
| 考研  | 20   |
| 雅思  | 12   |

---

## 二、语料源实测结果

本机网络环境特殊，下面是**逐条实测**的结果，供后来者参考。

### ✅ 采用：Project Gutenberg（经 pglaf 镜像）

| 地址                         | 状态         | 说明                                                        |
| ---------------------------- | ------------ | ----------------------------------------------------------- |
| `www.gutenberg.org`          | **503**      | 全站 `Temporarily Down for Maintenance`，实测期间持续不可用 |
| `aleph.gutenberg.org`        | 连接失败     | —                                                           |
| `gutenberg.readingroo.ms`    | DNS/连接失败 | —                                                           |
| `mirror.dur.ac.uk/gutenberg` | DNS/连接失败 | —                                                           |
| `gutenberg.mirror.xtom.com`  | DNS/连接失败 | —                                                           |
| **`gutenberg.pglaf.org`**    | **✅ 200**   | **本文档采用的镜像**                                        |

`gutenberg.pglaf.org` 是 Project Gutenberg Literary Archive Foundation 自己的镜像站（不是第三方），
内容与正站一致。实测速度约 10–15 KB/s，一本 240 KB 的书约 10–15 秒下完。

采用的电子书：

- **#11339 — Aesop's Fables; a new translation**
  - 英译：V. S. Vernon Jones（1912）
  - 插画：Arthur Rackham；导读：G. K. Chesterton
  - 原书：New York: Avenel Books, 1912
  - 下载：`https://gutenberg.pglaf.org/cache/epub/11339/pg11339.txt`（241,779 字节）

**为什么选这本**：Aesop 寓言每篇是一个独立完整的小故事（有起承转合和结尾寓意），
天然就是 5–11 句的"微型读物"，长度刚好适合逐句打字练习；文本极简单，适合入门；
且已进入公有领域，译文可以由本项目自行产出而不受第三方许可约束。

### ❌ 实测不可用 / 未采用

| 源                                              | 实测结果               | 结论                                   |
| ----------------------------------------------- | ---------------------- | -------------------------------------- |
| `raw.githubusercontent.com`                     | 被阻断                 | 不可用                                 |
| `cdn.jsdelivr.net`                              | 被阻断                 | 不可用                                 |
| huggingface                                     | 被阻断                 | 不可用                                 |
| `standardebooks.org`                            | `fetch failed`         | 不可用                                 |
| `en.wikipedia.org` / `simple.wikipedia.org` API | `fetch failed`         | 不可用                                 |
| `zh.wikipedia.org` / `zh.wikisource.org` API    | `fetch failed`         | 不可用                                 |
| `archive.org` metadata API                      | `fetch failed`         | 不可用                                 |
| `gutendex.com`（Gutenberg 元数据 API）          | 超时                   | 不可用                                 |
| `api.github.com`                                | ✅ 200（每小时 60 次） | **许可核查找不到可用的双语语料**，见下 |

### GitHub 双语语料搜索结论

用 `api.github.com/search/repositories` 搜过这几组词：
`english chinese parallel corpus`、`bilingual english chinese reading`、`parallel text en zh corpus`、
`english chinese sentence pairs dataset`。

找到的仓库里，**没有一个是"英中对照的文章/读物"且许可明确**：

| 仓库                                          | Stars | 许可               | 不采用的原因                                            |
| --------------------------------------------- | ----- | ------------------ | ------------------------------------------------------- |
| `mahavivo/nytimes-chn`                        | 18    | **NONE**           | 新闻版权归 NYT，无许可                                  |
| `bfsujason/mac`                               | 12    | GPL-3.0            | 文学文本，但 GPL 传染性不适合静态语料；且需核对原文版权 |
| `qxred/2MParallelCorpus`                      | 9     | Unlicense          | 纯句对，无篇章结构（同样是"散句"问题）                  |
| `foreyes/ted-parallel-corpus-Chinese-English` | 2     | **NONE**           | TED 演讲有版权                                          |
| 其余                                          | ≤1    | NONE / NOASSERTION | 许可不明                                                |

**结论**：GitHub 上没有可直接用的、许可清晰的英中对照读物语料。

### ⚠️ 评估后放弃：Tatoeba 句库

队友已把 Tatoeba 官方导出包下载到 `.tmp/rich-cache/`（`eng_sentences.tsv` /
`cmn_sentences.tsv` / `eng-cmn_links.tsv`，join 出 **78,127 条**英中对照句，
许可 **CC-BY 2.0 FR**，可商用、需署名）。

**我实际做过，然后放弃了。** 做法是词汇连贯性聚类（不是单纯关键词匹配）：先按主题词圈定候选池，
再以"与已选句的词面重合度"贪心扩展，最后按衔接度排序。即使如此，产出仍然是
"围绕同一批词的一组散句"，**没有起承转合**，读起来割裂；而且难免混入不适合学习材料的句子
（涉及轻生、性别议题等）。

根因：Tatoeba 是**孤立句子库**，句与句之间本就没有上下文关系。
Tatoeba 适合做**单词例句**（队友已用在词库里，那是对的用法），不适合做**文章**。

**决定：不用。** 这条路的产物没有进仓库。

---

## 三、许可结论

### 英文原文

Aesop's Fables 为公有领域作品：

- Aesop（约公元前 620–564 年），作品本身早已进入公有领域；
- 采用的英译本为 V. S. Vernon Jones 1912 年译本，译者去世已超过著作权保护期；
- Project Gutenberg 对该电子书声明无版权限制（美国及多数地区可自由复制、分发、商用）。

**结论：可自由使用、修改、商用，无需署名。**

### 中文译文

`public/articles/index.json` 中 Aesop 各篇的中文译文由**本项目人工逐句翻译**，
随本仓库以 MIT 许可发布（见仓库根 `LICENSE`）。没有使用机器翻译批量生成，也没有拷贝任何第三方译文。

### 原有 6 篇经典

`gettysburg` / `turing` / `einstein` / `shakespeare` / `jobs` / `orwell` 六篇为原有内容，
**原样保留，一个字符都没有改动**。各自许可说明已写在其 `source` 字段里：

- 葛底斯堡演说（1863）、莎士比亚十四行诗（1609）、爱因斯坦（1934）—— 公版
- 图灵（1950）、奥威尔（1946）—— 作者去世已逾保护期，公版
- 乔布斯斯坦福演讲（2005）—— 非公版，按原注释仅逐字引用不超过 4 句，其余为准确转述

---

## 四、加工流程

完整逻辑见 `scripts/build-articles.mjs`（可重跑）。要点：

1. **抽取**：从 Gutenberg 纯文本里按全大写标题切出各篇寓言，去掉目录页与导读。
2. **折行还原**：Gutenberg 原文是 70 列硬折行，先按空行分段、段内换行合并成正常段落。
3. **切句**：按 `.` `!` `?` 切分，把收尾引号并入本句；`Mr.` / `Mrs.` 等缩写不误切。
4. **长句截断**（关键）：单句超过 140 字符时，在 `;` / `--` / `:` / 并列连词前 / 关系词前 / 逗号处
   截断，**并在切口加省略号 `…`**：前半句末尾 `…` 表示后文略去，后半句开头 `…` 表示承接上句。
   两半拼起来即原句，**不增删任何词**——与仓库原有 6 篇的处理方式完全一致。
5. **清理**：修掉 1912 年排版产生的重复引号（`!"` → `!"`）；
   去掉 Gutenberg 表示斜体的 `_word_` 下划线（词本身不动）。
6. **人工翻译**：逐篇译成中文，译文存在 `data/articles-work/zh-batch-*.json`。
7. **校验 + 合并**：`scripts/build-articles.mjs` 逐条校验并写出 `public/articles/index.json`。

### 校验项（任一不过即整体失败，不写半成品）

- 英文必须与 Gutenberg 原文**逐字一致**（独立脚本 `validate-batches.mjs` 逐句比对）
- `en` 长度 ≤ 140
- `en` 经与 `src/lib/text.ts` 相同的归一化后，必须是全可打印 ASCII（键盘打得出来）
- 每篇 4–15 句
- `level` ∈ {CET-4, CET-6, 考研, 雅思}
- `id` 全局唯一；`title` / `titleZh` / `author` / `source` 均非空

---

## 五、难度分级方法

`level` 不是拍脑袋定的，用 **ECdict 的 BNC 词频排名**算：

1. 取每篇所有长度 ≥4 的实词（去停用词）；
2. 按 BNC 词频排名映射难度权重：≤1000 词 → 0，≤3000 → 0.35，≤6000 → 0.7，
   ≤12000 → 1.1，≤25000 → 1.5，更罕见 → 1.9；词典未收录 → 2.0；
3. 对全篇取加权平均，得到该篇的词汇难度分（实测区间 0.536–1.082）；
4. 把所有篇按分数排序，按 **30% / 60% / 85%** 分位切四档。

之所以用分位而不是绝对阈值：Aesop 寓言整体词汇难度跨度有限，
绝对阈值会把绝大部分篇目挤进同一档；分位切开能保证四档都有内容，且同档内的相对难度是真实的。

> 尝试过的另一种做法：直接用 ECDICT 的考试标签（gk/cet4/cet6/ky/toefl/ielts/gre）给每篇加权。
> **没有采用**，因为实测这些标签噪声很大——`found`、`long`、`time` 这类最基础的词
> 在 ECDICT 里也带 `ky`/`ielts` 标签，导致难度分几乎全部贴在 0.8 以上，失去区分度。

---

## 六、复现方式

```bash
# 1. 下载原文（约 10-15 秒；下载目录是临时缓存，用 .tmp）
curl -o .tmp/pg11339.txt \
  https://gutenberg.pglaf.org/cache/epub/11339/pg11339.txt

# 2. 重新生成 public/articles/index.json（只校验不写的用 --check）
node scripts/build-articles.mjs

# 3. 验收
npx tsc --noEmit
npx vitest run src/lib/text.test.ts
```

> **构建输入在仓库内**：`data/articles-work/` 下有 8 个文件——
> `classics.json`（从原有 `src/data/articles.ts` 导出的 6 篇快照，必须保留，
> 否则构建脚本会报错退出，防止老内容意外丢失）与 `zh-batch-01..07.json`（人工译文，共 132KB）。
> 2026-11-21 之前这些文件在 `.tmp/articles-work/`，因为 `.tmp` 被 gitignore，
> 别人 clone 后跑不了 `build-articles.mjs`，已迁入仓库。
> 同一目录下的其它中间产物（`aesop-raw.json`、`candidates.json`、`joined.jsonl` 等约 16MB
> 与试验脚本）**不需要进仓库**，仍留在 `.tmp/articles-work/`。

---

## 七、后续扩充建议

1. **继续增加 Aesop**：`aesop-final.json` 里还有约 100 篇已切好句、未翻译的寓言，
   加一篇只需新建一个 `zh-batch-08.json` 再跑构建脚本。
2. **换更长一点的公版读物**：Gutenberg 上还有大量短篇（欧·亨利、契诃夫英译、马克·吐温短篇），
   同样经 `gutenberg.pglaf.org` 取。但译文工作量远大于寓言，建议按需增量做。
3. **Gutenberg 正站恢复后**：把镜像地址换回 `www.gutenberg.org` 即可，脚本里只有下载那一步依赖它。
4. **不要再用 Tatoeba 拼文章**：理由见第二节，句库适合做例句，不适合做文章。
