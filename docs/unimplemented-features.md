# 未实现功能清单

> 核实日期：2026-11-21（上一版 2026-11-20 已过时，本版逐条对照源码重新核实）
> 方法：每条都要能在源码里找到证据，或找到「确实不存在」的证据。
> 目的：避免文档写得比代码多。

---

## 一、文档与代码不符的历史问题（已全部修复）

这类最要紧——文档会误导使用者。以下问题均已在本轮修掉，保留记录以便追溯。

| 功能 | 当年的错误描述 | 现状 |
| --- | --- | --- |
| 14 个成就 | README 写「14 个成就」，实际未接线，成就页永远 0 / 14 | ✅ 2026-11-20 新增 `src/services/achievements.ts` 接通判定，`PracticePage` 结算时调用 `checkAchievements()`，成就页展示进度 |
| 内置词库数量 | README 写「8 个内置词库」，实际 16 个 | ✅ 已改为 16 个并列出分类 |
| 每日复习上限 | 设置里有 `dailyReviewLimit` 开关，但 `buildRound()` 从不读取 | ✅ `buildRound()` 新增 `reviewLimit` 参数并真实生效 |
| 收藏 | 能点星标、能筛选，但出题调度完全不看收藏状态 | ✅ `src/data/round.ts:125-152` 已有收藏插队通道：收藏词即使未到期也提前入队，排在到期词之后、错词之前 |
| 自定义文章导入 | 文档标「未做」 | ✅ `src/data/customArticles.ts`（22KB）已实现，三种格式解析 + GBK 检测，33 个单测 |
| 学习报告导出 | 文档标「未做」，说「只有原始 JSON 备份」 | ✅ `src/lib/report.ts` 的 `downloadReportSvg()` / `printReport()` 已接进 `StatsPage`，可导出 SVG 或打印成 PDF |
| 词库众包 | README 路线图列了「词库众包」 | ✅ 该功能实现后已 revert 移除，代码无残留；README 路线图已同步删掉 |

> 上一版本文档（2026-11-20 早些时候）把「收藏」「自定义文章导入」「报告导出」仍列为未做，
> 原因是写完文档之后又有 4 个提交补上了这些功能，文档没跟着更新。本版已按代码重新核对。

---

## 二、设置里有开关但代码不读的（假开关）

已核查 `Settings` 接口的全部 12 个字段，**目前没有假开关**：

| 设置项 | 是否被业务逻辑读取 | 证据 |
| --- | --- | --- |
| `dailyNewTarget` | ✅ | `PracticePage.tsx:118` 计算 `remainingNew`，`:327` 显示目标 |
| `dailyReviewLimit` | ✅ | `PracticePage` / `ReviewPage` 传给 `buildRound({ reviewLimit })` |
| `accent` / `speechRate` / `autoSpeak` | ✅ | `lib/speech.ts` 朗读参数 |
| `keySound` / `keyVolume` | ✅ | `lib/sound.ts` |
| `theme` | ✅ | `stores/settings.ts` + Layout |
| `strictCorrection` | ✅ | 影响 `typeChar` 行为（曾经是假开关，已修） |
| `roundSize` | ✅ | `buildRound({ limit })` |
| `flowPreset` / `groupSize` | ✅ | `lib/flow.ts` |

---

## 三、真正还没做的（按成本排序）

### A 档 · 数据现成，成本低

| 功能 | 现状与真正的障碍 | 成本 |
| --- | --- | --- |
| **文章点词联动** | `WordDetail` 组件与 `word-graph.json` 都已存在，但 `ArticlesPage.tsx` 没有点词入口，阅读时不可查词 | 1 小时 |
| **句子库练习** | 53,882 对中英例句（覆盖 30,385 个词条，58.8%）已内联在词库里，但只作为「详情面板的展示内容」，没有整句打字练习入口 | 2 小时 |
| **文章扩到 800 句** | 目前 75 篇 / 490 句。素材池还有约 100 篇已切好句但未翻译的寓言。**这是人力问题不是代码问题** | 待人工翻译 |
| **放开 tem8 截断** | `scripts/build-more-dicts.mjs` 里 `tem8` 有 `limit: 8000`（源文件 12,197 条，全量约 2.5MB）。删掉这一行即可放开 | 5 分钟 |

### B 档 · 需要先补数据结构

| 功能 | 现状与真正的障碍 | 成本 |
| --- | --- | --- |
| **键盘热力图** | ⚠️ 不是「加个图表组件」那么简单。目前**完全没有按字符的错误统计**：`UserWord` 只有 `mistakes` 总计数；`TypingState.lastWrongChar` 只用于当场 UI 提示，**从不落库**；`PracticeSession` 只有 `keystrokes` / `correctKeystrokes` 总数。要做需打通 `lib/typing.ts` → `services/learning.ts` → 新 Dexie 表（含 v3 迁移）→ 统计页图表，且 `src/lib` 改动要保持零 React 依赖 | 2 小时+ |
| **错词按类型分组** | 同上，没有任何「拼写错 / 混淆 / 遗忘」的类型字段，无法区分。需要先定义错误分类并在作答时记录，才谈得上分组练习 | 2 小时+ |
| **自定义快捷键** | 快捷键写死在 `src/components/TypingArea.tsx`（Tab 重听、Backspace 退格、Escape 退出），`Settings` 里没有对应字段 | 半天 |

### C 档 · 成本高或不建议

| 功能 | 说明 |
| --- | --- |
| **近义词** | kaikki.org 可达、质量好，但全量抓取实测约 49.6 小时，且义项级会抓错（如 adapt→proportion）。若只抓高频 3000 词约 8 小时 |
| **英美双音标** | ⚠️ 许可证红线：ipa-dict 的 `en_UK` 上游是 GPL-3.0，**只能用 en_US** |
| **例句覆盖率 59% → 更高** | GRE 30% / SAT 30% / linux 20% / medical 24% 是 Tatoeba 语料的真实上限——冷僻词与命令名在 7.8 万对英中语料里本就罕见。不是代码问题 |
| **Windows 安装包（NSIS）** | 依赖远程工具链，本机反复超时。当前用可运行目录替代，可用性一致 |
| **i18n** | 无 `src/i18n`，界面全中文，当前用户群全中文，收益低 |
| **AI 功能 / 云同步 / 排行榜 / 插件 / 发音评测** | 属 README 路线图的 P1 / P2 规划范围，均未开始。云同步与排行榜需要后端，AI 需要 API Key |

---

## 四、工程层面的待办

| 事项 | 状态 | 说明 |
| --- | --- | --- |
| **文章译稿移入仓库** | ✅ 已完成 | `build-articles.mjs` 实际只依赖 `classics.json` + `zh-batch-01..07.json` 共 8 个文件（约 128KB），已移入 `data/articles-work/`。`.tmp/articles-work/` 里其余 16MB 是试验脚本与中间产物，不需要进仓库 |
| **桌面版改名 TypeFlow → EnglishMate** | 未做 | 程序仍叫 `TypeFlow.exe`，装在 `%LOCALAPPDATA%\Programs\TypeFlow`。改名必须同时迁移数据目录 `%LOCALAPPDATA%\TypeFlow`（含 IndexedDB 学习进度），否则用户数据丢失 |
| **NSIS 安装包** | 阻塞 | 见 C 档 |

---

## 五、附：核实方法

以下命令可重跑验证本文档的每条结论。

```bash
# 成就是否接线（应能看到 PracticePage 调用）
grep -rn "checkAchievements" src/ --include=*.ts --include=*.tsx | grep -v test

# 每日复习上限是否被业务读取
grep -rn "dailyReviewLimit" src/ | grep -v test

# 收藏是否影响调度（round.ts 应有 favorite 插队分支）
grep -n "favorite" src/data/round.ts

# 自定义文章导入是否存在
ls src/data/customArticles.ts && grep -c "" src/data/customArticles.test.ts

# 报告导出是否接通 UI
grep -n "downloadReportSvg\|printReport" src/pages/StatsPage.tsx

# 词库实际数量（应为 16）
node -e "console.log(require('./public/dicts/index.json').banks.length)"

# 例句覆盖（应输出 55560 / 32312 / 58.2%）
node -e "const fs=require('fs'),p=require('path');const idx=JSON.parse(fs.readFileSync('./public/dicts/index.json','utf8'));let t=0,w=0;for(const b of idx.banks){const d=JSON.parse(fs.readFileSync(p.join('./public/dicts',b.id+'.json'),'utf8'));const a=Array.isArray(d)?d:(d.words||[]);t+=a.length;for(const x of a)if(x.sentences&&x.sentences.length)w++;}console.log(t,w,(w/t*100).toFixed(1)+'%')"

# 是否有按字符的错误统计（当前应为空）
grep -rn "keystrokeStat\|perKey\|charErrors" src/ --include=*.ts --include=*.tsx

# 快捷键是否写死（当前应为空，说明没有可配置实现）
grep -rn "shortcut\|keybinding" src/ --include=*.ts --include=*.tsx
```
