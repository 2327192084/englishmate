# 交接文档 · EnglishMate

> 生成日期：2026-11-20
> 目的：让新会话能直接接手，不用重新摸索
> 仓库：<https://github.com/2327192084/englishmate>（MIT）

---

## 一、当前状态（一句话）

**功能完整的开源英语打字学习应用**，Web + Windows 桌面版，278 个测试全绿，tsc 零报错，数据校验通过。已推送 GitHub。

| 指标 | 数值 |
|---|---|
| 代码规模 | 约 11,000 行 TS/TSX + 6,000 行构建脚本 |
| 测试 | 278 个，14 个文件，全绿 |
| 词库 | 16 个 / 51,702 词条 |
| 文章 | 75 篇 / 490 句 |
| 例句 | 53,882 条中英对照（覆盖 59% 词条） |
| 词关系 | 14,959 词（词形变化 + 形近易混） |
| 产物 | JS 533KB（gzip 176KB）+ CSS 25KB |

---

## 二、立刻要做的两件事

### 1. 推送 8 个未推送的提交

本地比远端领先 8 个提交：

```bash
cd E:\EnglishMate
git push
```

### 2. 桌面版需要重新同步（如果继续改代码）

```bash
npm run build:desktop
rm -rf "/c/Users/ASUS/AppData/Local/Programs/TypeFlow/resources/app/dist"
cp -r dist "/c/Users/ASUS/AppData/Local/Programs/TypeFlow/resources/app/dist"
```

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
│   │   ├── report.ts       学习报告 SVG 生成
│   │   ├── speech.ts       语音合成封装
│   │   └── sound.ts        Web Audio 按键音合成
│   ├── data/
│   │   ├── wordbanks.ts    词库按需加载
│   │   ├── wordGraph.ts    词关系加载（word-graph.json）
│   │   ├── customArticles.ts 用户导入文章（解析+存储）
│   │   ├── round.ts        出题队列（收藏→到期→错词→新词→兜底）
│   │   ├── articles.ts     文章（import JSON 产物）
│   │   └── achievements.ts 14 个成就定义
│   ├── db/index.ts     Dexie 六张表 + 导入导出
│   ├── services/
│   │   ├── learning.ts     唯一写入口（作答→FSRS→会话）
│   │   └── achievements.ts 成就判定与解锁
│   ├── store/          Zustand（settings / practice）
│   ├── components/     Layout / TypingArea / WordDetail / WordFamilyHint
│   └── pages/          7 个页面
├── public/
│   ├── dicts/          16 个词库 + index.json + word-graph.json
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
npx vitest run            # 278 个测试
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
| `scripts/build-articles.mjs` | 生成文章语料 | 依赖 `.tmp/articles-work/` |

**缓存都在 `.tmp/`**（已 gitignore），重跑不必重新下载：
- `.tmp/rich-cache/ecdict.csv` — 63MB，ECDICT 完整数据
- `.tmp/rich-cache/eng_sentences.tsv` 等 — Tatoeba 导出包
- `.tmp/dicts.json` — Qwerty Learner 380 个词库的 sha 列表

> ⚠️ 但 `.tmp/articles-work/` 里的**文章译稿是构建输入**，如果 `.tmp` 被清空，
> `build-articles.mjs` 就跑不了了。**建议把译稿移到仓库内**（这是待办）。

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
| 错词本/收藏/已掌握 | 收藏已真正参与调度 |
| 16 个词库 + 自定义导入 | 51,702 词条 |
| 75 篇文章 + 自定义文章导入 | 三种格式解析 + GBK 检测 |
| 词形变化/形近词 | 14,959 词，练习界面提示 + 详情面板 |
| 学习报告导出 | SVG / PDF |
| 成就系统 | 14 个，已接通 |
| 深浅主题 / PWA / 桌面版 | 完成 |

---

## 八、明确的空缺（下一步候选）

### A 档 · 数据现成，成本低

| 功能 | 说明 | 预估 |
|---|---|---|
| **句子库练习** | 已有 53,882 条中英例句，做成「整句打字」练习 | 2 小时 |
| **文章点词联动** | 图谱已有，文章阅读时点词看词族/形近 | 1 小时 |
| **键盘热力图** | 记录哪个字母易打错，给出针对性洞察 | 2 小时 |
| **错词按类型分组** | 拼写错/混淆/遗忘分开练 | 2 小时 |

### B 档 · 需要新数据

| 功能 | 障碍（已实测） |
|---|---|
| **近义词** | kaikki 可达、质量好，但**全量 49.6 小时**，且义项级会抓错（adapt→proportion）。建议只抓高频 3000 词（约 8 小时） |
| 英美双音标 | ipa-dict 的 en_UK 上游是 GPL-3.0，只能用 en_US |
| 文章扩到 800 句 | 素材池还有约 100 篇待人工译 |

### C 档 · 成本高，不建议

AI 功能（要 API Key 或自训）、云同步（要后端）、排行榜（要后端）、i18n（当前用户全中文）

---

## 九、两个待办事项

1. **`.tmp/articles-work/` 的译稿应移入仓库**
   现在文章构建依赖这个目录，但它被 gitignore 了。别人 clone 后跑不了 `build-articles.mjs`。
   建议移到 `data/articles-work/`（不进 public，只是构建输入）。

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
| Tab 键 = 重听发音（不是跳过） | 跳过与 Space 重复 |
| 练习方式合并成一个选择器 | 原来"模式"和"流程"概念重叠 |
| 词形提示跟打默认展开、默写/听写默认折叠 | 后两者目标是从记忆提取，摊开等于送答案 |
| 词关系独立文件不塞进词库 | 否则 16 个词库文件体积翻倍且重复 |
| 报告用 SVG 自绘不引 jsPDF | 省 200KB，矢量不糊 |