# 交接文档 · EnglishMate

> 生成日期：2026-11-20
> 目的：让新会话能直接接手，不用重新摸索
> 仓库：<https://github.com/2327192084/englishmate>（MIT）

---

## 一、当前状态（一句话）

**功能完整的开源英语打字学习应用**，Web + Windows 桌面版，382 个测试全绿，tsc 零报错，数据校验通过。

| 指标 | 数值 |
|---|---|
| 代码规模 | 约 11,200 行 TS/TSX（另有 5,200 行测试）+ 6,700 行构建脚本 |
| 测试 | 382 个，20 个文件，全绿 |
| 词库 | 16 个 / 55,560 词条 |
| 文章 | 75 篇 / 490 句 |
| 例句 | 57,257 条中英对照（覆盖 58.2% 词条） |
| 词关系 | 14,959 词（词形变化 + 形近易混） |
| 文章点词释义 | 1,449 词条 / 554 变体（294KB，覆盖 98.4% 文章 token） |
| 页面 | 8 个（练习 / 词库 / 复习 / 文章 / 句子 / 数据 / 成就 / 设置） |
| 产物 | JS 533KB（gzip 176KB）+ CSS 25KB |

---

## 二、立刻要做的两件事

### 1. 推送未推送的提交

本地比远端领先的提交先看清再推（2026-11-21 推过一批，仍未推成功）：

```bash
cd E:\EnglishMate
git push
```

### 2. 桌面版需要重新同步（如果继续改代码）

只替换 `resources/app/dist`，**不要动 `main.cjs` / `preload.cjs`**：

```bash
cd /e/EnglishMate
npm run build:desktop
INST="$LOCALAPPDATA/Programs/TypeFlow/resources/app"
cp -r "$INST/dist" ".tmp/desktop-backup/$(date +%Y%m%d-%H%M%S)"   # 先备份
rm -rf "$INST/dist" && cp -r dist "$INST/dist"
cp -r dist "release/TypeFlow/resources/app/dist"                   # 同步待分发包
node electron/verify-desktop.cjs                                   # 拉起真窗口验证
```

`node electron/verify-desktop.cjs [exe目录]`（等同 `npm run verify:desktop`）会真的启动 `TypeFlow.exe --no-sandbox`，检查页面渲染、origin = `app://typeflow`、preload 生效且 Node 已隔离、旧 IndexedDB 的 settings 记录还在、`dicts/article-glossary.json` 能 fetch 到、导航里有 `/sentences`、首屏与刷新全程无控制台错误，并截图到 `.tmp/desktop-shots/`。
（`electron/smoke.cjs` 测的是**仓库版** main/preload，origin 断言是 `app://englishmate`，用它测装的那份会得到假失败。）

> ⚠️ **不要用仓库的 `electron/main.cjs` 覆盖装的那份**：仓库版 `APP_HOST='englishmate'`、preload 挂 `window.englishmate`，而装的那份是 `app://typeflow` + `window.typeflow`。换掉会改变 IndexedDB 的 origin（`app_typeflow_0` → `app_englishmate_0`），旧学习进度当场不可见。
> `src/lib/pwa.ts` 只检测 `window.englishmate?.isDesktop`，在 TypeFlow 里恒为 false——但 SW 注册还有 `protocol.startsWith('http')` 兜底，桌面端不会误注册，所以目前没有实际影响；改名时必须一起处理。
>
> ⚠️ 注意：安装目录还叫 `TypeFlow`，程序名也叫 `TypeFlow.exe`。
> 项目已改名 EnglishMate，但安装目录没改（改目录会丢失用户数据路径）。
> 如果要统一，需要同时迁移 `%LOCALAPPDATA%\TypeFlow` 数据目录。

---

## 三、项目结构（新会话必读）

```
E:\EnglishMate\
├── src/
│   ├── lib/            纯逻辑，零 React 依赖，全部可单测
│   │   ├── fsrs.ts         FSRS-4.5 间隔重复（21 个权重）
│   │   ├── stats.ts        WPM / 正确率 / streak / 聚合
│   │   ├── typing.ts       打字状态机（严格/非严格纠错）
│   │   ├── timer.ts        抗休眠计时（累计活跃时长）
│   │   ├── flow.ts         练习流程引擎（分组循环）
│   │   ├── text.ts         文本归一化（全角/弯引号 → 可打字形式）
│   │   ├── sentenceDiff.ts 整句逐词对比（句子练习用）
│   │   ├── keys.ts         快捷键绑定/归一/判定
│   │   ├── report.ts       学习报告 SVG 生成
│   │   ├── speech.ts       语音合成封装
│   │   └── sound.ts        Web Audio 按键音合成
│   ├── data/
│   │   ├── wordbanks.ts    词库按需加载
│   │   ├── wordGraph.ts    词关系加载（word-graph.json）
│   │   ├── articleGlossary.ts 文章点词释义表加载
│   │   ├── customArticles.ts 用户导入文章（解析+存储）
│   │   ├── round.ts        出题队列（收藏→到期→错词→新词→兜底）
│   │   ├── sentences.ts    例句抽取（错词本/收藏/按词库）
│   │   ├── articles.ts     文章（import JSON 产物）
│   │   └── achievements.ts 14 个成就定义
│   ├── db/index.ts     Dexie 六张表 + 导入导出
│   ├── services/
│   │   ├── learning.ts     唯一写入口（作答→FSRS→会话）
│   │   └── achievements.ts 成就判定与解锁
│   ├── store/          Zustand（settings / practice）
│   ├── components/     Layout / TypingArea / WordDetail / WordFamilyHint
│   └── pages/          8 个页面
├── public/
│   ├── dicts/          16 个词库 + index.json + word-graph.json + article-glossary.json
│   └── articles/       index.json（75 篇内联）
├── electron/           main.cjs / preload.cjs / smoke.cjs
├── scripts/            数据流水线（见下）
└── docs/               各文档
```

### 分层纪律（重要）

| 目录 | 允许 | 禁止 |
|---|---|---|
| `src/lib/` | 纯 TS 函数 | **任何 React 依赖** |
| `src/data/` | 数据、纯策略 | 直接操作数据库 |
| `src/services/` | 数据库读写 | UI 状态 |
| `src/components/` | 展示与交互 | 业务规则 |

---

## 四、验证命令（改动后必跑）

```bash
npx tsc --noEmit          # 类型检查（0 错误才算过）
npx vitest run            # 382 个测试
node scripts/verify-data.mjs   # 数据契约（16 库 / 75 篇）
```

三项全绿才算完成。**注意**：`fileParallelism: false` 已配置，测试串行跑避免 fake-indexeddb 互踩。

---

## 五、数据流水线

| 脚本 | 作用 | 耗时 |
|---|---|---|
| `scripts/build-dicts.mjs` | 从 Qwerty Learner 拉词表 | 几分钟 |
| `scripts/build-more-dicts.mjs` | 扩充到 16 个词库 | 几分钟 |
| `scripts/build-sentences.mjs` | Tatoeba 离线 join 出例句 | **1 分钟**（扫 204 万句） |
| `scripts/build-rich-dicts.mjs` | 补词性释义 + 例句 | 几分钟 |
| `scripts/build-word-graph.mjs` | 挖词形变化 + 形近词 | 约 1 分钟 |
| `scripts/build-articles.mjs` | 生成文章语料 | 依赖 `data/articles-work/`（已进仓库） |
| `scripts/build-article-glossary.mjs` | 生成文章点词释义表 `article-glossary.json` | 几秒（需先用完上面几个脚本） |

**缓存都在 `.tmp/`**（已 gitignore），重跑不必重新下载：
- `.tmp/rich-cache/ecdict.csv` — 63MB，ECDICT 完整数据
- `.tmp/rich-cache/eng_sentences.tsv` 等 — Tatoeba 导出包
- `.tmp/dicts.json` — Qwerty Learner 380 个词库的 sha 列表

> ✅ 文章译稿已移入仓库 `data/articles-work/`（classics.json + zh-batch-01..07.json，共 132KB），
> 别人 clone 后可以直接跑 `build-articles.mjs`。`.tmp/articles-work/` 里剩下的 16MB
> 是试验脚本与中间产物，不需要进仓库；`.tmp` 被清空不影响文章构建。

---

## 六、踩过的坑（务必知道）

### 网络环境（本机限制）

| 域名 | 状态 |
|---|---|
| `api.github.com` | ✅ 可用，但**每小时 60 次**未认证配额 |
| `registry.npmjs.org` | ✅ 可用 |
| `downloads.tatoeba.org` | ✅ 可用，约 60KB/s，**支持 `curl -C -` 断点续传** |
| `kaikki.org` | ✅ 可用，单页 200-600KB，**9.5 秒/次** |
| `gutenberg.pglaf.org` | ✅ 可用（正站 `www.gutenberg.org` 已 503） |
| `raw.githubusercontent.com` | ❌ **被阻断** |
| `cdn.jsdelivr.net` | ❌ 被阻断 |
| huggingface | ❌ 被阻断 |

### Electron 桌面版

1. **`file://` 下 IndexedDB 不可用**（不透明源），必须用自定义协议 `app://typeflow/`
2. **`%APPDATA%\Electron` 对本机 Electron 进程返回 EPERM**（PowerShell/Node 能写），
   所以 userData 要四级回退：`LOCALAPPDATA` → `APPDATA` → exe 同级 → tmp
3. NSIS 安装包打包依赖远程工具链，**反复超时**，当前用可运行目录替代
4. 启动器和 openLearner 一样需要 `--no-sandbox`（本机 Chromium 沙箱初始化失败）

### 开发中反复踩到的

- **Shell 转义破坏正则**：在 bash 里用 python/node 内联改含 `\s` `\(` 的正则会静默写坏。
  **改代码请用 Edit/Write 工具，不要用 sed/python -c 拼字符串。**
- **React Hook 顺序**：Hook 必须在任何提前 `return` 之前。曾把 `useState` 写在校验 return 之后，
  真机点开面板直接 React error #310 白屏。
- **Tailwind 透明度**：颜色必须用 `rgb(var(--x) / <alpha-value>)` 声明，
  用 `var(--x)` 会导致 `bg-accent/10` 这类类名**被静默丢弃**（样式不生效但不报错）。
- **测试设置污染**：渲染测试里改设置必须写进 IndexedDB，App 挂载时会从库覆盖 store。

---

## 七、已完成的功能（不要重复做）

| 模块 | 状态 |
|---|---|
| 四种练习方式 | 跟打/听写/默写/辨认 |
| 分组循环流程 | 7 词一组，跟打→默写→听写 |
| FSRS 间隔重复 | 完整实现 |
| 抗休眠计时 | 空闲暂停 + 休眠不计时 |
| 错词本/收藏/已掌握 | 收藏已真正参与调度；错词按四类错误来源分类，可按类型筛选 |
| 16 个词库 + 自定义导入 | 55,560 词条 |
| 75 篇文章 + 自定义文章导入 | 三种格式解析 + GBK 检测 |
| 词形变化/形近词 | 14,959 词，练习界面提示 + 详情面板 |
| 文章点词联动 | 阅读时点句中单词查释义（`article-glossary.json`，覆盖 98.4% token） |
| 句子练习 | `/sentences`，错词本/收藏/按词库三来源，整句输入 + 逐词着色 |
| 自定义快捷键 | 四个动作可改键，设置页录制式录入，提示文案同步 |
| 错词按类型分组 | 四类错误（顺序/邻键/形近/想不起来）在作答时采集，错词本可按类型筛选 |
| 学习报告导出 | SVG / PDF |
| 成就系统 | 14 个，已接通 |
| 深浅主题 / PWA / 桌面版 | 完成 |

---

## 八、明确的空缺（下一步候选）

### A 档 · 数据现成，成本低

> ✅ 2026-11-21 已完成：**句子库练习**（`/sentences`）、**文章点词联动**（`article-glossary.json` + `WordDetail`）、
> **自定义快捷键**（`Settings.shortcuts` + 设置页录制式改键）、**错词按类型分组**（`lib/mistakeKind.ts` + 错词本筛选）。
> 以下保留尚未完成的项。

| 功能 | 说明 | 预估 |
|---|---|---|
| **键盘热力图** | 记录哪个字母易打错，给出针对性洞察。⚠️ 需先补「按字符的错误统计」数据链路（见 `docs/unimplemented-features.md` B 档） | 2 小时+ |

### B 档 · 需要新数据

| 功能 | 障碍（已实测） |
|---|---|
| **近义词** | kaikki 可达、质量好，但**全量 49.6 小时**，且义项级会抓错（adapt→proportion）。建议只抓高频 3000 词（约 8 小时） |
| 英美双音标 | ipa-dict 的 en_UK 上游是 GPL-3.0，只能用 en_US |
| 文章扩到 800 句 | 素材池还有约 100 篇待人工译 |

### C 档 · 成本高，不建议

AI 功能（要 API Key 或自训）、云同步（要后端）、排行榜（要后端）、i18n（当前用户全中文）

---

## 九、待办事项

1. ~~**`.tmp/articles-work/` 的译稿应移入仓库**~~ ✅ 2026-11-21 已完成
   译稿已迁到 `data/articles-work/`（8 个文件，132KB），`build-articles.mjs` 的 `WORK` 常量已指向新路径，
   `node scripts/build-articles.mjs --check` 通过（75 篇 / 490 句）。别人 clone 后可直接构建文章。

2. **桌面版安装目录名未跟随改名**
   程序还叫 `TypeFlow.exe`，装在 `%LOCALAPPDATA%\Programs\TypeFlow`。
   改名需同时迁移数据目录 `%LOCALAPPDATA%\TypeFlow`（含 IndexedDB，用户学习进度在这里）。

---

## 十、许可与署名（合规要求）

| 数据 | 来源 | 许可 |
|---|---|---|
| 词表 | Qwerty Learner | MIT |
| 词性释义 | ECDICT | MIT |
| 中英例句 | Tatoeba | **CC-BY 2.0 FR（必须署名）** |
| 文章 | Aesop's Fables (Gutenberg #11339) | 公版 |
| 词形/形近 | 从 ECDICT 挖掘 | MIT |

**应用内「设置 → 关于 → 数据来源」已按上述标注**，改动这部分要保留署名。

### 两条明确的许可证红线

1. **TypeWords 是 GPL-3.0** —— 字段最全但数据不能拷进 MIT 仓库
2. **ipa-dict 的 en_UK 上游是 GPL-3.0** —— 只能用 en_US

---

## 十一、关键设计决策（避免被"优化"掉）

| 决策 | 原因 |
|---|---|
| 计时用累计活跃时长，不用 `Date.now()` 差值 | 休眠后 WPM 会被稀释到 0 |
| 打错不前进光标（严格模式） | 防止错误肌肉记忆 |
| 输入法组字期间忽略所有按键 | 否则拼音字母被当答题 |
| Tab 键 = 重听发音（不是跳过） | 跳过与 Space 重复；四个键位已做成可配置，默认值保持这一行为 |
| 练习方式合并成一个选择器 | 原来"模式"和"流程"概念重叠 |
| 词形提示跟打默认展开、默写/听写默认折叠 | 后两者目标是从记忆提取，摊开等于送答案 |
| 词关系独立文件不塞进词库 | 否则 16 个词库文件体积翻倍且重复 |
| 文章点词用独立 glossory 文件，不按词加载整库 | 点一个词不该下载 1.3MB 的高考词库；独立文件 gzip 约 120KB |
| 文章可点词用 span[role=button] 不用 button | 几十个 button 会污染 Tab 焦点漫游，用户按 Tab 是想跳输入框 |
| 快捷键判定集中在 lib/keys.ts | 脏配置（两动作抢一键）只能在一处收敛，避免行为不可预测 |
| 改键时新键已被占用就交换而非拒绝 | 用户改键的常见意图就是两键对调 |
| 报告用 SVG 自绘不引 jsPDF | 省 200KB，矢量不糊 |