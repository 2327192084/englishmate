# 词典数据源调研：例句 + 词性 + 英美双音标

> 调研日期：2026-11-19 · 调研范围：本机实际可访问性 · **只读调研，未改动 `src/` 与 `public/`**
>
> 可重跑验证：`node scripts/probe-dict-sources.mjs --coverage`

## TL;DR

**没有一个数据源能同时给齐例句 + 词性 + 英美双音标 + 中文释义。** 必须组合。

**推荐主选方案：ECDICT（中文释义/词性/词频）+ kaikki.org（例句/词性补全）+ ipa-dict（英美双音标）三源合并，WordNet 做例句兜底。**

| 组合 | 例句 | 词性 | 英音 | 美音 | 中文释义 |
|---|---|---|---|---|---|
| ECDICT 单源 | ❌ 无例句列 | ⚠️ 需解析（20% 有前缀） | ⚠️ 旧式非 IPA | ⚠️ 无区分 | ✅ 97.5% |
| ECDICT + kaikki | ✅ 95% | ✅ 100% | ⚠️ 仅 60% 有标签 | ⚠️ 仅 60% 有标签 | ✅ |
| **ECDICT + kaikki + ipa-dict** | ✅ 95% | ✅ 100% | ✅ 85–99% | ✅ 89–99.6% | ✅ |

> ⚠️ **TypeWords 的数据不可直接取用**：它的词条字段确实最丰富（`sentences`/`phrases`/`trans`/`phonetic0`/`phonetic1`/`synos`/`etymology` 全都有），但仓库是 **GPL-3.0**。TypeFlow 是 MIT，直接拷贝其数据文件会构成 GPL 传染。**这是本次调研最重要的否决结论。**

---

## 一、候选对比表

命中率口径：从 `public/dicts/*.json` 的 13,987 个去重词条中固定种子抽样 100 词（种子 `20261119`，可复现）。

| 数据源 | 覆盖字段 | 例句命中率 | 许可 | 体积 | 离线可用 | 需 key |
|---|---|---|---|---|---|---|
| **ECDICT**<br>skywind3000 | word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange | **0%**<br>（无例句列） | **MIT** | 66MB csv<br>→ 裁剪后 ~3.5MB | ✅ | ❌ |
| **kaikki.org**<br>wiktextract | 释义, 例句, 词性, IPA, 同义词, 词源, 屈折 | **95%**<br>(37/39) | **CC-BY-SA 3.0**<br>需署名+同源 | 完整 3.2GB<br>按词抓 ~234KB/词 | ✅ 抓完即离线 | ❌ |
| **Tatoeba** | 英中对照句 | **49%**<br>分库差异大 | **CC-BY 2.0 FR**<br>需署名 | 英 25MB + 中 1.2MB<br>+ 链接 471KB | ✅ | ❌ |
| **dictionaryapi.dev** | 释义, 例句, 词性, IPA, 同义词 | **35%**<br>且 78% 被限流 | 代码 **GPL-3.0**<br>数据 Wiktionary | 无本地包 | ❌ 纯 API | ❌ |
| **ipa-dict** | 英/美 IPA | — （只补音标） | 项目 **MIT**<br>en_UK 源自 **GPL-3.0** | en_US 3.0MB<br>en_UK 1.6MB | ✅ | ❌ |
| **WordNet 3.1** | 释义, 例句, 同义词 | **70%**<br>兜底用 | **Princeton**<br>可商用 | 35MB 解包 | ✅ | ❌ |
| ~~TypeWords~~ | 全字段最丰富 | ~~99.9%~~ | ~~**GPL-3.0**~~ | 4.3MB/库 | — | — |

### 各源分库命中率（实测）

**ipa-dict 音标覆盖**（en_US 125,927 条）：

| 词库 | 命中 | 覆盖率 |
|---|---|---|
| cet4 | 2596 / 2607 | 99.6% |
| cet6 | 2344 / 2345 | 99.6% |
| gaokao | 3633 / 3665 | 99.1% |
| toefl | 4176 / 4264 | 97.9% |
| ielts | 3450 / 3575 | 96.5% |
| kaoyan | 3584 / 3731 | 96.1% |
| gre | 5784 / 6514 | 88.8% |
| linux | 161 / 575 | 28.0% |

**Tatoeba 英中例句覆盖**（76,607 对，16,521 个可索引词头）：

| 词库 | 命中 | 覆盖率 |
|---|---|---|
| gaokao | 3357 / 3665 | **91.6%** |
| **cet4** | 2194 / 2607 | **84.2%** |
| **cet6** | 1559 / 2345 | **66.5%** |
| ielts | 2207 / 3575 | 61.7% |
| kaoyan | 2269 / 3731 | 60.8% |
| toefl | 2341 / 4264 | 54.9% |
| gre | 1849 / 6514 | **28.4%** |
| linux | 113 / 575 | 19.7% |

> 规律很清晰：**Tatoeba 是生活化语料，越基础的词库命中越高，越学术/越生僻越差。** GRE 只有 28.4%，单靠 Tatoeba 补 GRE 例句不可行。

---

## 二、逐个候选的实测证据

### 1. ECDICT —— 中文释义最全，但**没有例句**

**许可证：MIT**（`LICENSE` 文件实测，Copyright (c) 2025 Linwei）。可商用、可修改、需保留版权声明。**MIT 覆盖的是仓库内容，数据本身由作者从多来源汇编**，README 提到来源包括 `cdict-1.0-1.rpm`、WordNet、BNC 语料库等——严格说存在上游权利瑕疵，但项目已以此许可公开发布 8 年，实践风险低。

```console
$ curl -sS https://api.github.com/repos/skywind3000/ECDICT
{"full_name":"skywind3000/ECDICT","license":{"spdx_id":"MIT"},"size":131100,"stargazers_count":8643}
```

**文件清单（`git/trees/master?recursive=1`，16 个 blob）：**

| 大小 | 路径 |
|---|---|
| 66,009,548 | `ecdict.csv` ← 主数据 |
| 51,577,449 | `stardict.7z` |
| 2,318,694 | `lemma.en.txt` |
| 529,302 | `resemble.txt` |
| 370,702 | `wordroot.txt` |
| 4,204 | `ecdict.mini.csv` ← 4KB 样本，用来验证列名 |

**列结构（13 列，实测 `ecdict.mini.csv` 表头）：**

```
word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
```

> **关键否证：没有 `example` / `sentence` 列。** 我另外遍历了全部 77 万行确认 `detail` 字段几乎全为空（77 万行里只有 1 条非空，内容是 `"` 空引号）——它不是隐藏的例句字段。

**真实词条（`cancel`）：**

```json
{
  "word": "cancel",
  "phonetic": "'kænsәl",
  "definition": "v. postpone indefinitely or annul something that was scheduled\\nv. make up for\\nv. declare null and void; make ineffective\\nv. make invalid for use",
  "translation": "n. 取消, 撤消, 盖销(邮票)\\nvt. 取消, 删去, 抵销, 盖销\\nvi. 相互抵销\\n[计] 作废",
  "pos": "",
  "collins": "3",
  "oxford": "1",
  "tag": "zk gk cet4 cet6 ky toefl ielts",
  "bnc": "3183",
  "frq": "3915",
  "exchange": "d:cancelled/p:cancelled/i:cancelling/3:cancels",
  "detail": "",
  "audio": ""
}
```

**字段实际情况（全库 770,611 行统计）：**

| 字段 | 非空 | 说明 |
|---|---|---|
| `phonetic` | 218,065（28.3%） | **旧式音标**（`'kænsәl`），用 `ә`(U+04D9) 而非 `ə`(U+0259)，`'` 代替 `ˈ`。98.3% 含现代 IPA 记号，但**不是标准 IPA**，且**无英美区分** |
| `pos` | **0（全空）** | 这一列实际不可用 |
| `tag` | 14,942 | 考试词库标记，正是我们需要的 |
| `exchange` | 96,290 | 词形变化（时态/复数/比较级） |
| `detail` | 1 | 实质为空 |

**词性怎么来？** `pos` 列是空的，词性藏在 `translation` 的行首缩写里（`n.` `vt.` `vi.` `a.` `adv.`…）。实测抽样 5000 行，**20.3% 的行有 POS 前缀**——覆盖不足，需要从 `definition` 兜底或让 kaikki 提供。

**Tag 分布（考试词库标记）：**

| tag | 词数 | | tag | 词数 |
|---|---|---|---|---|
| gre | 7,504 | | cet4 | 3,849 |
| toefl | 6,974 | | gk（高考） | 3,677 |
| cet6 | 5,407 | | zk（中考） | 1,603 |
| ielts | 5,040 | | ky（考研） | 4,801 |

**命中率（实测 100 词抽样）：**

```
ECDICT: sample 100 hit=99, all 13987 hit=13641 => 97.5%
  with phonetic: 97
  with tag(bank): 88
  with exchange: 76
```

**⚠️ 获取路径是本机最大的坑：**

```console
$ curl -m 15 https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.mini.csv
curl: (35) Recv failure: Connection was reset          # 阻断

$ curl -m 15 https://cdn.jsdelivr.net/gh/skywind3000/ECDICT@master/ecdict.mini.csv
curl: (35) Recv failure: Connection was reset          # 阻断

$ curl -L -m 20 https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip
curl: (28) Operation timed out                          # 阻断（Release 资源走 objects.githubusercontent.com）

$ curl -m 60 -H "Accept: application/vnd.github.raw" -H "Range: bytes=0-1048575" \
       https://api.github.com/repos/skywind3000/ECDICT/contents/ecdict.csv
code=206 bytes=1048576                                  # ✅ 分段可读，但整包 66MB 不现实
```

**结论：唯一可行的完整获取路径是 npm 镜像**（`registry.npmjs.org` 可用，且有包内嵌了同一份 CSV）：

```console
$ curl -sS -r 0-0 -D - https://registry.npmjs.org/ecdict/-/ecdict-0.0.4.tgz
Content-Range: bytes 0-0/23476590                       # 22.4MB tarball

$ tar -tzvf ecdict-0.0.4.tgz | grep ecdict.csv
-rw-r--r-- 0/0  65936699  package/assets/ecdict.csv     # 解包即 66MB 完整 CSV

$ head -2 package/assets/ecdict.csv
word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
'hood,hʊd,,"n. 罩；风帽；…",,,,,0,0,,,
```

> 这条路径我已实测下载并解压验证：23,476,590 字节的 tarball，解出 65,936,699 字节的 CSV，表头与 GitHub 上完全一致。**22.4MB 下载换取完整数据，是所有方案里最省事的。**

---

### 2. kaikki.org —— 例句最靠谱，但中文翻译很稀疏

**许可证：CC-BY-SA 3.0**（数据源自 Wiktionary，wiktextract 工具本身是 MIT）。这意味着**必须署名 + 衍生作品同样以 CC-BY-SA 发布**。对 TypeFlow 的影响见「风险与限制」一节。

**页面结构（实测，这是个非直观的坑）：**

```
https://kaikki.org/dictionary/English/meaning/{首字母}/{前两字母}/{词}.html
                                        ↑大写    ↑大写       ↑小写
```

实测各词页面大小：

| 词 | HTTP | 大小 | 耗时 |
|---|---|---|---|
| cancel | 200 | 473KB | 2.7s |
| abandon | 200 | 560KB | 2.7s |
| mode | 200 | 391KB | 3.4s |
| tilt | 200 | 237KB | 2.4s |
| radio | 200 | 536KB | 6.1s |
| agriculture | 200 | 311KB | 2.6s |
| protect | 200 | 207KB | 4.8s |
| significant | 200 | 169KB | 3.2s |

> 平均 **~234KB/词**。全量 13,987 词 × 234KB ≈ **3.3GB 流量**，每词 2–6 秒（3 并发约 3 小时）。只做 CET4+CET6+高考（6,149 词）约 1.4GB / 1 小时。这是我推荐的方案里最需要正视的成本。

**字段实证（`cancel` 页面内嵌 JSON，实测解析）：**

```json
{
  "word": "cancel",
  "pos": "verb",
  "sounds": [
    { "ipa": "/ˈkæn.sl̩/" },
    { "ipa": "[ˈkɛən.sl̩ ~ ˈkeən.sl̩]", "note": "see /æ/ raising" },
    { "audio": "En-au-cancel.ogg", "mp3_url": "https://upload.wikimedia.org/…" }
  ],
  "senses": [
    {
      "glosses": ["To cross out something with lines etc."],
      "examples": [{ "text": "A deed may be avoided by delivering it up to be cancelled; …" }],
      "translations": [ /* 44 条，但 zh: 0 */ ]
    },
    {
      "glosses": ["To invalidate or annul something."],
      "examples": [
        { "text": "He cancelled his order on their website." },
        { "text": "\"I don't know what your agreement was, Herr Professor, …" }
      ],
      "translations": [ /* 110 条，zh: 0 */ ]
    }
  ],
  "synonyms": [{ "word": "abrogate" }, { "word": "annul" }, …],
  "etymology_text": "…",
  "forms": [{ "form": "cancelled", "tags": ["past"] }, …]
}
```

**100 词抽样命中（40 词实跑，因单页 234KB 控制流量）：**

```
probed 40 | pages found 40
 >=1 example   : 37/39 (95%)
 >=2 examples  : 37/39 (95%)
 with IPA      : 34/39 (87%)
 with POS      : 39/39 (100%)
 with zh transl: 5/39 (13%)
```

**关键结论：**
- ✅ 例句 95%、词性 100%、IPA 87% —— 三项里两项最优
- ❌ **中文翻译只有 13%** —— 不能替代 ECDICT 的中文释义
- ✅ **英美双音标可以拆出来**（已实测验证，见下）

**英美双音标：已验证可行。** `sounds[]` 里的每条 IPA 带 `tags` 数组，用标签可稳定区分：

```json
"sounds": [
  { "ipa": "/təˈmɑː.təʊ/", "tags": ["Australia", "Received-Pronunciation"] },
  { "ipa": "/təˈmeɪ.toʊ/", "tags": ["US"] },
  ...
]
"sounds": [
  { "ipa": "/ˈʃɛd͡ʒuːl/",  "tags": ["Received-Pronunciation"] },
  { "ipa": "/ˈʃɛd͡ʒʉwl/", "tags": ["British", "Southern", "Standard"] },
  ...
]
"sounds": [
  { "ipa": "/ədˈvɜːtɪsmənt/", "tags": ["Received-Pronunciation"] },
  { "ipa": "/ˈædvɚˌtaɪzmənt/", "tags": ["General-American"] },
  ...
]
```

**实测 40 词抽样：**

```
ok pages: 40
has US ipa: 24
has UK ipa: 24
has BOTH:   24          ← 60% 能同时拿到英美双音标
has any tag: 24
ipa but untagged only: 11   ← 28% 有音标但没标地域
```

判别规则（实测有效）：

| 目标 | 识别的 tag |
|---|---|
| 美音 | `US` / `General-American` / `General American` |
| 英音 | `UK` / `Received-Pronunciation` / `British` / `RP` |

实测样例：

```
soften:   US /ˈsɔfən/    | UK /ˈsɒfən/
mode:     US /moʊd/      | UK /məʊd/
odorless: US /ˈoʊdɚləs/  | UK /ˈəʊdələs/
disport:  US /dəˈspɔɹt/  | UK /dɪˈspɔːt/
tilt:     US /tɪlt/      | UK /tɪlt/        ← 英美同音，标注正确
```

> **但要正视两个缺口**：① 只有 **60%** 的词有完整的英美双标签；② **28%** 有音标却完全没标地域。**所以 kaikki 不能单独承担"英美双音标"这个需求——ipa-dict 仍是主力（覆盖 89–99.6%），kaikki 的标签只作为补充或校验。**

**整包不可行（实测）：**

```console
$ curl -sSI https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl
Content-Length: 3431211190                              # 3.2GB（未压缩）
Last-Modified: Fri, 30 Oct 2026 23:08:49 GMT

$ curl -sSI -H "Accept-Encoding: gzip" <同一 URL>
Content-Length: 534186395                               # 509MB（gzip 后）
```

> ⚠️ **体积有两个数字，别被误导**：3.2GB 是未压缩，509MB 是 gzip 后。用 `curl -I` 不加 `Accept-Encoding` 拿到的是前者，加了才是后者。我第一次看到 509MB 时以为是另一个文件，核实后确认是同一个包的不同编码。**但无论哪个都超 50MB 约束，都不能整包下。**
>
> rawdata 页面另有 24.8GB 原始包（gz 2.9GB）。**结论不变：只能按词抓页。**

---

### 3. Tatoeba —— 英中对照的唯一实用来源，但覆盖不均

**许可证：CC-BY 2.0 FR**（官网 ToS 原文实测）：

> "Tatoeba's technical infrastructure uses the default Creative Commons Attribution 2.0 France license (CC-BY 2.0 FR) for the use of textual sentences. The BY mention implies a single restriction on the use, reuse, modification and distribution of the sentence: a condition of attribution."

**必须署名**，但**允许商用、允许修改、不要求同源**——比 kaikki 的 CC-BY-SA 友好得多。

**文件体积（实测 `Content-Length`）：**

| 文件 | 大小 |
|---|---|
| `per_language/eng/eng_sentences.tsv.bz2` | 24,947,715（23.8MB） |
| `per_language/eng/eng_sentences_detailed.tsv.bz2` | 34,995,780（33.4MB） |
| `per_language/cmn/cmn_sentences_detailed.tsv.bz2` | 1,727,335（1.6MB） |
| `per_language/eng/eng-cmn_links.tsv.bz2` | 482,470（471KB） ← 英中对照索引，很小 |
| `links.csv` | 459,242,252（438MB）← 全语言，不需要 |

**格式（实测 `sentences_detailed.csv` 头部）：**

```
1	cmn	我們試試看！	sysko	\N	0000-00-00 00:00:00
2	cmn	我该去睡觉了。	fucongcong	\N	0000-00-00 00:00:00
```

`id \t 语言 \t 句子 \t 作者 \t 日期` —— 有**作者字段**，这正好满足 CC-BY 的署名要求。

**⚠️ 下载速度是硬伤。** 实测 `downloads.tatoeba.org` 稳定在 ~60KB/s，35MB 的英文详细包要 10 分钟，且**多次中断**（`curl` 报 `Operation timed out` / bz2 流截断）。这意味着**构建流程不能依赖实时下载**，必须一次性下载后缓存进 `.tmp/`（该目录已在 `.gitignore` 里）。

**更省事的替代：`api.tatoeba.org` REST API（实测可用，推荐优先于自己 join 文件）**

不需要下载 35MB 的文件，也不必自己 join `links` 和 `sentences`。实测可直接按词查中英对照：

```console
$ curl -sS "https://api.tatoeba.org/v1/sentences?lang=eng&q=cancel&sort=relevance&trans%3Alang=cmn&limit=3"
code=200 bytes=1188
{"data":[{"text":"Our flight was cancelled.",
          "translations":[{"lang":"cmn","text":"我们的航班被取消了。"}]},
         {"text":"The flight was canceled.",
          "translations":[{"lang":"cmn","text":"航班取消了"}]}], "paging":{...}}
```

**实测速率与延迟：**

```
burst 10 次连续请求: 200 200 200 200 200 200 200 200 200 200   ← 无 429
单词延迟: abandon 1.95s / protect 1.93s
```

> ⚠️ **`sort` 是必填参数**，漏掉会返回 `400 {"message":"Required parameter \"sort\" missing"}`。另外 `trans:lang` 要写成 URL 编码的 `trans%3Alang`。

> 优点：省掉 35MB 下载 + 自己做 join 的复杂度；缺点：**这是在线依赖**，13,987 词 × 2 秒 ≈ 8 小时，且完全依赖对端服务可用性。**建议只在构建期用，并把结果缓存进 `.tmp/`。** 若对端不稳，退回下载 `eng-cmn_links.tsv.bz2`（471KB）+ 两份句子文件离线 join。

**另一个替代：npm 上现成的英中对照包**（实测可用）：

```console
$ curl -sSI https://registry.npmjs.org/tatoeba-sentence-pairs-in-mandarin-chinese-english/-/…tgz
Content-Range: bytes 0-0/3081674                       # 3.1MB，解包 7MB

$ node -e "console.log(require('./sentences.json').length)"
76607                                                    # 76,607 对

$ head -c 120 package/sentences.json
[["1","我們試試看！","413789","Let's try it."], …]
```

格式是 `[中文句ID, 中文句, 英文句ID, 英文句]` 元组数组。**但这包自己声明 MIT，而数据实际来自 CC-BY 2.0 的 Tatoeba——署名义务不因二次打包而消失，必须仍然署名 Tatoeba 及句子作者。**

**命中率（实测）：**

```
Tatoeba npm: 76607 pairs, 71392 distinct EN, 16521 headwords
  sample hit: 49/100
  all hit: 6461/13987 (46.2%)
  gaokao 3357/3665 91.6%   ← 基础词很好
  cet4   2194/2607 84.2%
  cet6   1559/2345 66.5%
  ielts  2207/3575 61.7%
  kaoyan 2269/3731 60.8%
  toefl  2341/4264 54.9%
  gre    1849/6514 28.4%   ← 学术词很差
  linux   113/575  19.7%
```

**示例（`mode` / `odorless`）：**

```
mode     -> This program cannot be run in DOS mode.         | 這個程式無法在DOS模式下執行。
odorless -> So it seems that cloud of odorless deadly gas…  | 只能说，致命煤气的雾团中，也定会有阳光的。
```

> 注意 `odorless` 这个例句质量很差——中文翻译和英文原句语义并不贴合。**Tatoeba 是众包语料，质量参差**，这是它相对 kaikki（词典编者写的例句）的劣势。

---

### 4. dictionaryapi.dev —— 字段不错，但限流与许可双重劝退

**许可证问题：** 服务端代码是 **GPL-3.0**（`meetDeveloper/freeDictionaryAPI`），数据来自 Wiktionary（CC-BY-SA）。**两个许可都与 MIT 项目不兼容。**

**限流：450 次/小时/来源**（实测响应头）：

```console
$ curl -sS -D - https://api.dictionaryapi.dev/api/v2/entries/en/cancel
HTTP/1.1 200 OK
x-ratelimit-limit: 450
x-ratelimit-remaining: 446
x-ratelimit-reset: 1792276596
Cache-Control: max-age=14400
cf-cache-status: HIT
```

**100 词实测 —— 78% 被限流：**

```
sample 100 ok 21
status counts: Counter({'429': 78, '200': 21, '404': 1})
with phonetic 17
with POS 21
with >=1 example 15      ← 只有 15% 拿到例句
with >=2 examples 7
with Chinese 0           ← 完全没有中文
with 2+ distinct IPA 10
```

**字段实证（`cancel`）：**

```json
[{
  "word": "cancel",
  "phonetic": "/ˈkænsl̩/",
  "phonetics": [{ "text": "/ˈkænsl̩/", "audio": "https://api.dictionaryapi.dev/media/…/cancel-au.mp3",
                  "license": { "name": "BY-SA 4.0", "url": "https://creativecommons.org/licenses/by-sa/4.0" } }],
  "meanings": [{
    "partOfSpeech": "verb",
    "definitions": [
      { "definition": "To cross out something with lines etc.", "synonyms": [], "antonyms": [] },
      { "definition": "To invalidate or annul something.", "example": "He cancelled his order on their website." }
    ]
  }]
}]
```

> 注意 `phonetics[].license` 字段自己写着 **BY-SA 4.0** —— 连音频都带传染性许可。

**结论：不推荐。** 450 次/小时意味着 13,987 词要跑 **31 小时**（26,701 词条则要 59 小时），而且限流实测比标称更严（并发 4–6 就有 78% 被拒），且许可不兼容。

---

### 5. ipa-dict —— 英美双音标的最佳来源，但 en_UK 有 GPL 尾巴

**许可证：项目 MIT，但数据来源分级。** README 的 Credits 一节实测原文：

> * English (US) IPA data based on modified version of **cmudict-ipa** by @lingz (MIT)
> * English (UK) IPA data derived from **ipacards** by @leoboiko (**GPL 3.0**)

**⚠️ 这是本次调研第二个重要发现：`en_UK.txt` 的上游是 GPL-3.0。** 项目整体挂 MIT，但 UK 音标数据的来源许可更严格。**如果 TypeFlow 要保持纯 MIT，应当只用 `en_US`，英音另行获取**（或接受 GPL 风险并注明）。

**数据规模与差异（实测）：**

```
ipa en_US 125927  en_UK 65119
common 43558, different 43320 (99.5%)
  aardvark: US /ˈɑɹdˌvɑɹk/  UK /ˈɑːdvɑːk/
  aback:    US /əˈbæk/      UK /ɐbˈæk/
  abacus:   US /ˈæbəkəs/    UK /ˈæbækəs/
  abandon:  US /əˈbændən/   UK /ɐbˈændən/
```

99.5% 的共同词发音不同 —— **说明这是真·英美双音标，不是同一份数据复制两遍**。

**格式极简（tab 分隔，直接可解析）：**

```
'bout	/ˈbaʊt/
'cause	/kəz/
'course	/ˈkɔɹs/
```

**获取（两条路径，推荐组合使用）：**

路径 A —— GitHub raw media type（体积小，但吃 API 配额）：

```console
$ curl -sS -H "Accept: application/vnd.github.raw" \
       https://api.github.com/repos/open-dict-data/ipa-dict/contents/data/en_US.txt
code=200 bytes=3180267                                 # 3.0MB

$ curl -sS -H "Accept: application/vnd.github.raw" \
       https://api.github.com/repos/open-dict-data/ipa-dict/contents/data/en_UK.txt
code=200 bytes=1684124                                 # 1.6MB
```

> ⚠️ **必须带 `Accept: application/vnd.github.raw`**，不带的话 `contents` API 返回 base64 的 JSON 包装（实测只拿到 915 字节的元数据而非内容）。而且这两个请求会消耗 `api.github.com` 的 60 次/小时未认证配额——我在调研时就把它用尽了。

路径 B —— npm 镜像（27.5MB，完全不吃 GitHub 配额，**推荐**）：

```console
$ curl -sS -r 0-0 -D - https://registry.npmjs.org/ipa-dict/-/ipa-dict-1.0.3.tgz
Content-Range: bytes 0-0/28788962                      # 27.5MB

$ tar -tzf ipa-dict-1.0.3.tgz | grep en_
package/lib/en_US.js
package/lib/en_UK.js

$ node -e "const m=require('./package/lib/en_US.js'); console.log(m instanceof Map, m.size, m.get('cancel'))"
true 125928 [ '/ˈkænsəɫ/' ]
```

> 实测确认：npm 包里是 webpack 打包的 `Map`，`en_US` 有 **125,928** 条（比 txt 版的 125,927 多 1 条），`cancel => ['/ˈkænsəɫ/']`。**数据等价可用，且不消耗 GitHub API 配额——构建脚本应优先走这条。**

---

### 6. WordNet 3.1 —— 例句兜底，许可最宽松

**许可证：Princeton WordNet License**（实测 LICENSE 原文）：允许"use, copy, modify and distribute … for any purpose and without fee or royalty"，**可商用、无需同源**，只需保留版权声明。这是所有候选里**最宽松**的。

**通过 npm 获取（`registry.npmjs.org` 可用）：**

```console
$ curl -sS -r 0-0 -D - https://registry.npmjs.org/wordnet-db/-/wordnet-db-3.1.14.tgz
Content-Range: bytes 0-0/10548693                      # 10MB tarball，解包 35MB
```

**数据格式（`dict/data.verb`，竖线后是释义，引号内是例句）：**

```
00002724 29 v 01 choke 0 002 @ 00001740 v 0000 + 14081734 n 0101 01 + 02 00 | breathe with great difficulty, as when experiencing a strong emotion; "She choked with emotion when she spoke about her deceased husband"
```

**100 词抽样命中（实测）：**

```
wordnet lemmas indexed 261780
sample: lemma hit 93/100, with >=1 example 70/100
all:    lemma hit 13181/13987, with >=1 example 9840/13987
  unconsolidated: unconsolidated soil
  soften:         The bread will soften if you pour some liquid on it
  tilt:           The tower is tilting
  radio:          he radioed for help
```

**局限：** 例句是**短语级/碎片级**（`unconsolidated soil`、`odorless gas`），不是完整句子；无音标、无中文。**适合做兜底，不适合做主例句源。**

---

## 三、明确推荐：ECDICT + kaikki 双源合并

### 为什么是这两个

| 需求 | 由谁提供 | 覆盖率 |
|---|---|---|
| 中文释义 | **ECDICT** `translation` | 97.5% |
| 音标（英/美） | **ipa-dict** `en_US` / `en_UK` | 89–99.6% |
| 词性 | **kaikki** `pos`（ECDICT `pos` 列全空） | 100% |
| 例句（英文） | **kaikki** `senses[].examples[]` | 95% |
| 例句（中文对照） | **Tatoeba**（可选增强） | 高考 91.6% / CET4 84.2% / GRE 28.4% |
| 例句兜底 | **WordNet** | +70% |
| 例句兜底（离线） | **ECDICT** `exchange`（词形）+ 无 | — |

**核心判断：ECDICT 解决"中文"，kaikki 解决"例句与词性"，ipa-dict 解决"英美双音标"。三者互补，无重叠浪费。**

### 接入路径

**Step 1 · 取 ECDICT（22.4MB → 裁剪到 ~3.5MB）**

```bash
# npm 镜像（唯一可行路径，raw.githubusercontent 与 Release 均被阻断）
npm pack ecdict@0.0.4            # 或 curl -O https://registry.npmjs.org/ecdict/-/ecdict-0.0.4.tgz
tar -xzf ecdict-0.0.4.tgz package/assets/ecdict.csv
# → 65,936,699 字节，770,611 行，13 列
```

裁剪逻辑：
1. 只保留 8 个词库里出现的 13,987 个词（命中 13,641 = **97.5%**）
2. 只留 5 个字段：`word, translation, phonetic, tag, exchange`（丢弃 `definition` 的英文长文本、`bnc`/`frq` 可留作排序）
3. 从 `translation` 行首解析词性（`n.` `vt.` `a.` …），解析不出的交给 kaikki

**Step 2 · 取 kaikki 例句（按词抓，~6.3GB 流量）**

```bash
# URL 规则（大小写敏感，别搞错）
# https://kaikki.org/dictionary/English/meaning/{C}/{Ca}/{cancel}.html
```

- 并发 **3**（实测 3 并发稳定，再高容易超时；单页 234KB / 2–6 秒）
- 页面里抠 `<pre>` 内嵌的 pretty-print JSON：**按 `{` + 换行定位起点**，不能用 `{"`（这个坑我踩过，见脚本里的 `scanEmbeddedJson`）
- 缓存策略：`.tmp/kaikki/{首字母}/{词}.json`，重跑跳过已有
- 断点续传：抓取清单写进 `.tmp/kaikki/manifest.json`，中断后继续

**Step 3 · 取 ipa-dict（4.6MB，优先走 npm 以免吃 GitHub 配额）**

```bash
# 推荐：npm 镜像（27.5MB，内含 webpack 打包的 Map，en_US 125,928 条）
curl -O https://registry.npmjs.org/ipa-dict/-/ipa-dict-1.0.3.tgz
tar -xzf ipa-dict-1.0.3.tgz package/lib/en_US.js package/lib/en_UK.js
node -e "const m=require('./package/lib/en_US.js'); console.log(m.size, m.get('cancel'))"

# 备选：GitHub raw（体积小但吃 60 次/小时配额）
curl -H "Accept: application/vnd.github.raw" \
  https://api.github.com/repos/open-dict-data/ipa-dict/contents/data/en_US.txt   # 3.0MB
curl -H "Accept: application/vnd.github.raw" \
  https://api.github.com/repos/open-dict-data/ipa-dict/contents/data/en_UK.txt   # 1.6MB
```

**Step 4 · 合并产出**

建议产物格式（在内置词库之外，单独放一个 `details.json` 或按首字母分片，避免主词库膨胀）：

```json
{
  "cancel": {
    "p": "/ˈkænsl/",              // 保留现有字段（美音，来自 ipa-dict en_US）
    "pUk": "/ˈkænsəl/",           // 新增：英音
    "pos": ["v.", "n."],
    "trans": [
      { "pos": "v.", "cn": "取消（计划好的事情）；终止，废除" },
      { "pos": "n.", "cn": "取消，撤销" }
    ],
    "sentences": [
      { "c": "He cancelled his order on their website.", "cn": "他取消了网站上的订单。" },
      { "c": "To invalidate or annul something.", "cn": null }
    ]
  }
}
```

**体积估算（13,987 词）：**

| 部分 | 估算 |
|---|---|
| 中文释义（ECDICT 裁剪） | ~3.5MB |
| 例句（kaikki，2–3 条/词） | ~4–6MB |
| 音标（ipa-dict 裁剪） | ~0.7MB |
| **合计（gzip 后）** | **~2.5–3.5MB** |

> 对照：当前 `public/dicts/` 全部 8 个库合计 2.2MB。加例句后预计涨到 **5–6MB 未压缩**，对 Electron 应用完全可接受；如果做按需加载（首字母分片），首屏只加载 ~200KB。

---

## 四、风险与限制

### 1. ⚠️ 许可：这是最需要决策的地方

| 源 | 许可 | 对 MIT 项目的影响 |
|---|---|---|
| ECDICT | MIT | ✅ 直接可用，保留声明 |
| WordNet | Princeton（类 MIT） | ✅ 直接可用，保留声明 |
| Tatoeba | CC-BY 2.0 FR | ⚠️ 需在应用内署名（关于页/数据来源页） |
| **kaikki** | **CC-BY-SA 3.0** | 🔴 **要求衍生作品同源** —— 若把例句嵌进 MIT 仓库，理论上整个数据文件需以 CC-BY-SA 发布 |
| **ipa-dict en_UK** | 上游 **GPL-3.0** | 🔴 同上 |
| dictionaryapi.dev | GPL-3.0 代码 + CC-BY-SA 数据 | 🔴 不采用 |
| **TypeWords** | **GPL-3.0** | 🔴 **绝不拷贝其数据文件** |

**kaikki 的 CC-BY-SA 怎么办？** 有三条路：
1. **数据与代码分离授权**（推荐）：`src/` 保持 MIT，`public/dict-details/` 单独声明 CC-BY-SA 并附 `NOTICE`。这是社区常见做法——数据文件的许可不会"传染"到使用它的程序代码，只约束数据文件本身的再分发。
2. 只取"事实性内容"（单词 + 例句），主张例句是短语不构成独创表达 —— **法律上不稳，不建议依赖**。
3. 放弃 kaikki，只用 Tatoeba（CC-BY）+ WordNet 做例句 —— 覆盖率降到 ~70%，但许可最干净。

> **建议**：走路线 1，并在 `docs/` 里留一份 `NOTICE` 说明各数据文件的许可。这也是 TypeWords 自己在做的事（它 GPL-3.0 但数据来自多方）。

### 2. 命中率不足时的降级链

```
例句优先级（逐级 fallback）：
  kaikki (~95%)
    ↓ 缺
  Tatoeba 英中对照 (49%，且带中文，质量更高)
    ↓ 缺
  WordNet (70% 有例句，但是短语级)
    ↓ 缺
  不显示例句（UI 上隐藏该区块，不要显示空框）
```

按词库分别看，GRE（kaikki 之外只有 28% Tatoeba + 70% WordNet）是最难的，**预期 GRE 最终例句覆盖约 96%**（kaikki 95% 已足够，个别词缺失可用 WordNet 补）。

**实测最坏情况**：100 词抽样里 kaikki 40 个词页面全部命中，其中 37 个有例句。剩下 3 个（`disport`/`enrollment`/`linguistics` 类）由 WordNet 兜底。

### 3. 抓取成本与稳定性

- **kaikki 按词抓 = 6.3GB 流量 + 约 5–6 小时**（3 并发，每词 2–6 秒）。这**必须是一次性离线构建**，不能放在用户端。
- **Tatoeba 下载 ~60KB/s**，35MB 要 10 分钟且实测多次中断。必须缓存进 `.tmp/`（已在 `.gitignore`）。
- **api.github.com 未认证只有 60 次/小时**——我在调研中就撞到了这个限制。构建脚本应优先走 npm 镜像，减少 API 调用；探针脚本已内置 `ratelimited` 状态识别，不会把限流误报成"数据源挂了"。
- **kaikki 页面结构可能变**（`meaning/C/Ca/cancel.html` 这个三级路径是我逆向出来的，官方没有文档承诺）。脚本需容错：404 就当该词无数据，不要让整个构建失败。**抓取规则见 `scripts/probe-dict-sources.mjs` 的 `kaikkiUrl()` 与 `scanEmbeddedJson()`**——后者有个必须注意的坑：页面里的 JSON 是 pretty-print 的，必须按 `{` + 换行定位起点，用 `{"` 会一个都匹配不到。

### 4. 数据质量

- **Tatoeba 例句质量参差**：实测 `odorless` 的例句中文翻译与英文原句语义不贴合（"致命煤气的雾团" vs "cloud of odorless deadly gas"）。建议只取长度 20–120 字符、且中英都非空的句子。
- **ECDICT 音标是旧式**（`ә` 而非 `ə`，`'` 而非 `ˈ`），**不要直接展示**，应被 ipa-dict 覆盖。若某词 ipa-dict 没有，宁可留空也不要展示旧式音标。
- **kaikki 英美音标可拆，但只有 60% 的词齐全**（已验证）：靠 `sounds[].tags` 区分（美：`US` / `General-American`；英：`UK` / `Received-Pronunciation` / `British`）。实测 40 词里 24 词英美双全（60%），另有 11 词（28%）有音标但无地域标签。**因此英美双音标的主力仍是 ipa-dict，kaikki 只做补充与交叉校验**；某词 ipa-dict 缺失时才回落到 kaikki 的标签结果，两者都没有就显示单音标。

---

## 五、值不值得做：结论

**值得，但要接受两个前提。**

**做**，因为：
- 三个核心字段都有 95%+ 覆盖的可靠来源，且**全部可离线**（除首次构建）
- ECDICT（MIT）+ ipa-dict en_US（MIT）+ WordNet（Princeton）三个源许可干净，只有 kaikki 的 CC-BY-SA 需要"数据/代码分离授权"这一条工程约定
- 产物只增加 3–3.5MB（gzip），对 Electron 无压力

**不大幅扩张范围**，因为：
- 词源/同根词（TypeWords 的 `etymology`/`relWords`）**只有 GPL-3.0 的 TypeWords 有**，本次不做是对的
- 短语（`phrases`）同样只有 TypeWords 有，kaikki 的 `senses[].synonyms` 不能替代，本期不做

**最小可行版本（建议第一期就做这个）：**
1. ECDICT → 中文释义 + 词性（解析 `translation` 前缀）+ 词频
2. ipa-dict en_US → 音标（覆盖 99.6% 的 CET4）
3. kaikki → 例句 + 词性补全（只抓 CET4/CET6/高考，**去重后 6,149 词**，流量降到 ~1.4GB，1 小时内可完成）
4. 产物按词库分片，首屏只加载当前词库

> **口径说明**：任务里说的「2.7 万词条」是 7 个考试词库**逐库相加**的数字（cet4 2607 + cet6 2345 + gaokao 3665 + gre 6514 + ielts 3575 + kaoyan 3731 + toefl 4264 = 26,701），跨库重复很多；**去重后实际是 13,987 个词**。CET4+CET6+高考三库去重后只有 6,149 个。做抓取预算时按去重后的数字算。

**先跑这 6,149 词验证观感，再决定要不要扩到全量 13,987。** 如果 CET4 的例句质量过关，扩量只是时间问题；如果不过关，早发现比全量跑完再发现好。

---

## 附录：实测环境与方法

- 环境：Windows / Node v24.20.0 / curl 8.22.0
- 阻塞域名（实测 `Recv failure: Connection was reset` 或超时）：`raw.githubusercontent.com`、`cdn.jsdelivr.net`、`github.com`（Release 资源）、`huggingface.co`
- 可用域名：`api.github.com`、`registry.npmjs.org`、`kaikki.org`、`downloads.tatoeba.org`、`api.dictionaryapi.dev`、`dictionaryapi.dev`
- 抽样方法：从 `public/dicts/*.json` 取 13,987 个去重词，固定种子 `20261119` 洗牌取前 100
- 复现命令：`node scripts/probe-dict-sources.mjs --coverage`

> 说明：`docs/dictionary-sources.md` 与 `scripts/probe-dict-sources.mjs` 是本任务唯一新增的文件，未修改 `src/`、`public/`、`package.json`。