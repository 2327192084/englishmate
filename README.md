# TypeFlow · 打字即学习

> 把「背单词、练打字、磨语感」合成一件事的开源英语学习 Web 应用。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)

**永久免费 · 无广告 · 无内购 · 数据本地优先**

---

## 这是什么

主流背单词 App 让你「看单词、选释义」——属于被动识别，认得字但写不出来。
TypeFlow 反过来：**让你在键盘上把单词敲出来**。

打字时你同时在做三件事：

- **看**拼写与释义 → 视觉记忆
- **听**发音 → 听觉记忆
- **敲**键盘 → 手指肌肉记忆

三重叠加，比单纯「看 + 选」牢固得多。而且错误输入不会前进，必须改对才能继续——避免把错误拼法练成肌肉记忆。

## 功能

### 已实现（v0.1 · MVP）

| 模块                       | 能力                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------ |
| **四种练习模式**           | 跟打（看词打字）、听写（听音拼写）、默写（看义写词）、辨认（四选一）                 |
| **分组循环流程** | 7 词一组：跟打 → 默写 → 听写逐层抽掉线索，同一批词练透再换组 |
| **抗休眠计时** | 空闲 3 分钟自动暂停，系统休眠不计入时长，WPM 只反映真实练习时间 |
| **FSRS 间隔重复**          | 基于 FSRS-4.5 算法安排复习，按遗忘临界点出题，而非固定日程                           |
| **文章练习**               | 名著/演讲选段逐句跟打与听写，中英对照，逐词差异对比                                  |
| **词库**                   | 8 个内置词库（CET-4/6、考研、雅思、托福、GRE、高考、Linux 命令），支持导入自定义词库 |
| **词性释义** | ECDICT 提供带词性的精确释义（n./v./adj. 分条），比单一释义更准确 |
| **英中例句** | Tatoeba 真实语料，高频词带中英对照例句，练习中可点开详情查看 |
| **错词本 / 收藏 / 已掌握** | 打错自动收录，答错多的词优先重练                                                     |
| **打字引擎**               | 逐字符实时校验、错误原地纠正、WPM 与正确率实时统计                                   |
| **数据洞察**               | WPM 趋势、每日练习量、17 周学习热力图、词库进度、模式分布                            |
| **轻度游戏化**             | 连续天数 streak、14 个成就、每日目标                                                 |
| **键盘音效**               | Web Audio 实时合成，0KB 资源，延迟 < 5ms                                             |
| **发音**                   | Web Speech API，支持美音/英音与语速调节，离线可用                                    |
| **本地优先**               | IndexedDB 存储，完全离线可用；数据导入/导出                                          |
| **响应式**                 | 桌面/平板/手机自适应，深色浅色双主题                                                 |

### 路线图

- **P1**：AI 语境例句与句子批改（可插拔 LLM）、可选云同步、自定义文章导入
- **P2**：AI 陪练对话、好友排行榜、VSCode 插件、发音评测、词库众包

## 快速开始

```bash
# 需要 Node 18+
git clone <your-repo-url>
cd typeflow
npm install
npm run dev          # http://localhost:5173
```

首次打开没有任何词条，直接点「开始」即可。

### 常用命令

```bash
npm run dev          # 开发服务器
npm run build        # 类型检查 + 生产构建
npm run preview      # 预览构建产物
npm run test         # 单元 + 集成 + 渲染测试（vitest）
npm run typecheck    # 仅类型检查
npm run verify       # 校验词库与文章语料完整性
npm run smoke        # 真浏览器冒烟测试（需先 preview，用系统 Edge）
```

### 重建词库

词库是构建期生成的静态 JSON：

```bash
npm run dicts                        # 拉取词表并清洗（缺缓存才联网）
npm run dicts:rich                   # 补词性释义 + 抓取 Tatoeba 例句（慢）
npm run dicts:rich -- --limit 3000   # 只为前 3000 高频词抓例句
npm run dicts:rich -- --offline      # 只用已有缓存，不联网
```

### 测试覆盖

| 层     | 文件                          | 覆盖内容                                                      |
| ------ | ----------------------------- | ------------------------------------------------------------- |
| 算法   | `lib/fsrs.test.ts`            | FSRS 四档评分、learning→review 迁移、间隔单调性、边界与脏输入 |
| 算法   | `lib/stats.test.ts`           | WPM/正确率分母为零、streak 三种情形、按日聚合                 |
| 引擎   | `lib/typing.test.ts`          | 严格/非严格输入、退格、错误计数、空词条防护                   |
| 策略   | `data/round.test.ts`          | 复习优先、错词干预、新词限流、去重、辨认选项                  |
| 集成   | `services/learning.test.ts`   | 真实 IndexedDB 上的作答→卡片→会话→统计闭环、备份恢复          |
| 渲染   | `App.test.tsx`                | 7 个页面能挂载、主题切换                                      |
| 端到端 | `pages/PracticeFlow.test.tsx` | 键盘事件驱动完整一轮并落库、跳过错词、辨认判定                |

## 技术栈

| 层次 | 选型                               | 理由                                                    |
| ---- | ---------------------------------- | ------------------------------------------------------- |
| 框架 | React 18 + TypeScript 5.7 + Vite 6 | 生态成熟，热更新快，类型安全                            |
| 状态 | Zustand 5                          | 打字是高频状态更新，Zustand 的订阅粒度比 Context 细得多 |
| 存储 | IndexedDB（Dexie 4）               | 上万词条 + 历史记录，localStorage 容量不够              |
| 样式 | Tailwind CSS 3                     | 响应式与主题切换靠 CSS 变量，不引 UI 库                 |
| 复习 | 自研 FSRS-4.5                      | 无后端依赖，纯函数可单测                                |
| 发音 | Web Speech API                     | 零资源体积，覆盖全部单词                                |

**架构要点：没有后端。** 所有逻辑跑在浏览器里，部署就是扔一堆静态文件到任意 CDN。

### 目录结构

```
src/
├── lib/           纯逻辑，零 React 依赖，全部可单测
│   ├── fsrs.ts        FSRS 间隔重复算法
│   ├── stats.ts       WPM / 正确率 / 连续天数 / 聚合
│   ├── typing.ts      打字状态机
│   ├── speech.ts      语音合成封装
│   └── sound.ts       Web Audio 按键音合成
├── data/          内容与出题策略
│   ├── round.ts       出题队列（复习优先 / 错词干预 / 新词限流）
│   ├── wordbanks.ts   词库按需加载与缓存
│   ├── articles.ts    文章语料
│   └── achievements.ts 成就定义
├── db/            Dexie 表结构与导入导出
├── services/      学习记录写入（唯一写入口）
├── store/         Zustand（设置 / 练习会话）
├── components/    UI 组件
└── pages/         7 个页面
```

设计约束：**`lib/` 目录下一行 React 都不许有**。算法要能被单独验证，也要能被将来的 CLI / 插件复用。

## 数据与隐私

- 所有学习数据存在你浏览器的 IndexedDB 里，**不上传任何服务器**。
- 没有账号系统，没有埋点，没有第三方统计。
- 设置页可导出 JSON 备份、导入恢复、一键清空。
- 清理浏览器数据会丢失记录，建议定期导出。

## 参与贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。欢迎的方向：

- 补充词库（尤其专业领域：医学、法律、金融）
- 校对文章语料与译文
- 新增练习模式
- 性能优化与无障碍改进
- 文档与翻译

标记 `good first issue` 的任务适合首次贡献。

## 许可

代码 [MIT](./LICENSE)。

数据来源与许可：

| 数据 | 来源 | 许可 |
|---|---|---|
| 词表 | [Qwerty Learner](https://github.com/RealKai42/qwerty-learner) | MIT |
| 词性释义 | [ECDICT](https://github.com/skywind3000/ECDICT) | MIT |
| 英中例句 | [Tatoeba](https://tatoeba.org) | CC-BY 2.0 FR（**需署名**） |

应用「设置 → 关于 → 数据来源」中已按要求标注这三项。

文章语料均为**公版作品**（林肯、图灵、爱因斯坦、莎士比亚、奥威尔）或公开演讲的转述，具体出处见 `src/data/articles.ts` 每篇的 `source` 字段。

## 致谢

- [Type Words（词文记）](https://typewords.cc) — 产品形态的主要参考
- [Qwerty Learner](https://github.com/RealKai42/qwerty-learner) — 打字学习范式与词库数据
- [FSRS](https://github.com/open-spaced-repetition/fsrs4anki) — 间隔重复算法
- [Duolingo](https://www.duolingo.com) — 游戏化机制参考
