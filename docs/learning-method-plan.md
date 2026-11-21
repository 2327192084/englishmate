# 学习方法扩展 · 技术方案

> 日期：2026-11-21
> 依据：`docs/learning-methods-research.md`（B 站视频 + 评论区 + 100LS 调研）
> 用户决策：**① 100LS 不降级，支持用户导入自己的视频；② 不做跟读/录音功能；③ 先看方案再动手**

---

## 零、先说要决策的三件事

这份方案的核心不是「怎么加功能」，而是要你拍板三个**产品形态层面**的取舍。
我把每个取舍的成本、影响面、我的倾向都写出来了。

| # | 取舍 | 选项 | 我的建议 |
| --- | --- | --- | --- |
| 1 | 视频存哪里 | (a) IndexedDB BLOB / (b) 只存文件路径引用 / (c) 存字幕+时间轴，视频用系统播放器 | **(b) + (c) 组合**，见第二节 |
| 2 | Web 端怎么办 | (a) Web 端不做 100LS / (b) Web 端用 File System Access API | **(b)**，浏览器够用 |
| 3 | 和精听是同一个模块吗 | (a) 两个模块 / (b) 一个模块两种模式 | **(b)**，但数据结构分开，见第三节 |

---

## 一、技术前提（已实测，不是估算）

### 1.1 「只能打字」确实是历史选择，不是代码约束

- `PracticeMode` 是四值联合类型（`typing | dictation | recall | choice`），全项目 **19 处引用**。
- 新增练习形式 = 新页面 + 新 `session` 记录。已有先例：`SentencesPage` 用 `bankId: 'sentences'` 落库，
  `ArticlesPage` 用 `bankId: 'article:<id>'`，**都没改引擎**。
- 所以打字之外的方法可以直接加，不需要先重构。

### 1.2 精听不需要新数据

实测词库例句长度分布（57,257 条）：

| 长度 | 条数 |
| --- | --- |
| 全部 | 57,257 |
| ≥40 字符 | 29,313 |
| **≥60 字符** | **8,523** |
| ≥80 字符 | 220 |

75 篇文章合计 40,462 字符，平均每篇 539 字符 ≈ **36 秒**（按 900 字符/分钟）。

**结论：精听素材完全现成，零新数据。**

### 1.3 Web Speech 的能力边界（决定精听能做到多细）

`src/lib/speech.ts` 现在只用 `speak()` 发一次朗读，**没有监听任何事件**。
浏览器的 `SpeechSynthesisUtterance` 实际支持：

| 事件 | 能不能用 | 用途 |
| --- | --- | --- |
| `onstart` / `onend` | ✅ 可靠 | 判断一遍播完 |
| `onboundary` | ⚠️ 部分浏览器支持（Chrome 支持，Safari 不稳） | 逐词高亮 |
| 查时长 | ❌ **没有 API** | 无法预知一段要播多久 |

**影响**：做「逐句高亮」不可靠；做「一遍播完再播下一遍」没问题。
所以精听的设计必须是 **按句切分 + 逐句播放**，而不是「整段播放 + 同步高亮」。

### 1.4 视频文件体积 —— 这是 100LS 的真障碍

| 素材 | 体积 | 能否进 IndexedDB |
| --- | --- | --- |
| 90 分钟 1080p | ~2GB | ❌ |
| 90 分钟 720p | ~1GB | ❌ |
| 90 分钟音轨（128kbps） | ~84MB | ⚠️ 勉强，但**浏览器没有内置抽取音轨的能力** |
| 30 分钟音频 | ~28MB | ✅ |

Chrome 单源 IndexedDB 配额虽然大（磁盘 60%），但**单个 Blob 超过 ~100MB 就会出现明显卡顿**，
而且 `exportAllData` / `importAllData` 会把整个库 `toArray()` 读进内存 —— 一个 1GB 的 BLOB
会让备份功能直接 OOM。

**这是本方案最关键的技术约束**：视频**不能**走现有的「存进 IndexedDB」路线。

---

## 二、视频存储方案（需要你拍板）

### 方案 A：把视频存进 IndexedDB BLOB

- 优点：单一数据源，备份/迁移逻辑统一
- 缺点：1–2GB BLOB 会让 `exportAllData` OOM；写入/读取卡顿；浏览器配额波动时可能被清
- **结论：不推荐**

### 方案 B：只存文件句柄/路径，视频留在原位置 ⭐推荐

**桌面端（Electron）**：
- 用 `dialog.showOpenDialog` 拿路径 → 存路径字符串 → 播放时经 `app://` 协议映射读取
- 需要给 `preload.cjs` 加一个白名单 API（当前只有 `getVersion`，非常克制）
- 视频文件**不进任何存储**，只是个路径

**Web 端**：
- 用 **File System Access API**（`showOpenFilePicker`）拿 `FileSystemFileHandle`
- 句柄需要存进 IndexedDB（`FileSystemHandle` 是可序列化的）→ 刷新后能重新拿到，但**需要用户授权一次**
- 不支持的浏览器（Firefox/Safari）→ 退化成「每次重新选文件」

- 优点：不占存储、备份逻辑不受影响、清晰
- 缺点：换机器/移动文件后失效，需要重新指定；Web 端每次授权有点烦
- **结论：推荐，符合「本地优先、不做云同步」的既有定位**

### 方案 C：只存字幕 + 时间轴，视频交给系统播放器

- 我们只管「进度到第几遍、这一遍哪些句还没听懂」，视频在外部播
- 优点：实现最简单，几乎零风险
- 缺点：体验割裂（要来回切窗口），「暂停在某一句」做不到
- **结论：可作为方案 B 的降级兜底**

### 建议：B 为主，C 兜底

```
用户选视频
  ├─ 桌面端 → showOpenDialog → 存路径 → app:// 协议播放
  ├─ Web(Chrome/Edge) → showOpenFilePicker → 存 handle → 直接播放
  └─ Web(其他) → 只能选字幕文件，走方案 C
```

---

## 三、模块设计：一个入口，两种模式

### 3.1 为什么不是两个独立页面

精听和 100LS 共享 **80% 的 UI 与逻辑**：播放控制、分句、暂停/重播、进度、错误反馈。
差别只有两处：

| | 精听 | 100LS |
| --- | --- | --- |
| 素材 | 例句 / 文章句子 | 用户导入的视频（+ 字幕） |
| 计数 | 不计遍数 | **计 100 遍** |
| 步骤 | 盲听 → 看中文 → 再听 | 无字幕 → 中文字幕 → 英文字幕 → 跟读循环 |
| 时长 | 秒级 | 小时级 |

做成一个页面 `ListeningPage`，顶部 `Segmented` 切换。这样用户面对的是**一个「听」的入口**，
而不是两个他分不清的模块。

### 3.2 目录与文件

```
src/
├── lib/
│   ├── listening.ts        ★ 纯逻辑：遍次状态机、分句调度、进度计算
│   └── subtitle.ts         ★ 纯逻辑：SRT/VTT/ASS 解析（无 DOM）
├── data/
│   ├── listeningSources.ts ★ 素材来源（例句 / 文章 / 导入）
│   └── mediaLibrary.ts     ★ 视频引用管理（路径 / handle）
├── db/index.ts             ★ version(3)：新增 mediaFiles 表
├── store/listening.ts      ★ 播放状态（当前句、遍次、是否暂停）
├── components/
│   ├── AudioPlayer.tsx     ★ 播放器（Web Speech / <video> 两套后端）
│   └── SubtitleTrack.tsx   ★ 字幕轨 + 当前行高亮
└── pages/ListeningPage.tsx ★ 主页面
```

**分层纪律照旧**：`lib/` 下不出现任何 React / Dexie 依赖。
`subtitle.ts` 和 `listening.ts` 必须是纯函数，能用 node 环境单测。

### 3.3 新增数据库表（v3 迁移）

```ts
/** 用户导入的媒体引用。不存文件本身，只存「去哪找」 */
export interface MediaFile {
  id: string;              // uuid
  title: string;
  /** 桌面端：绝对路径；Web 端：FileSystemHandle 序列化后的句柄 */
  locator: { kind: 'path'; path: string } | { kind: 'handle'; handle: FileSystemHandle };
  /** 时长（秒），可能未知 */
  durationSec?: number;
  /** 字幕文件名（如果有） */
  subtitleName?: string;
  /** 视频文件本身的体积，用于显示不占用我们的存储 */
  sizeBytes?: number;
  createdAt: number;
}

this.version(3).stores({
  mediaFiles: 'id, createdAt',
});
```

**同时必须改三处**（这是既有缺陷，不加会更糟）：
- `clearAllData` —— 现在连 `customArticles` 都没清
- `exportAllData` / `importAllData` —— 现在都不含 `customArticles`
- 新表 `mediaFiles` 要不要进备份？**我的建议：只备份 `MediaFile` 元数据（路径字符串），
  不备份文件本身**。导入到另一台机器时路径失效，提示用户重新指定即可。

### 3.4 遍次状态机（100LS 的核心逻辑，纯函数）

```ts
// src/lib/listening.ts
export type HundredStep = 'raw' | 'zhSub' | 'enSub' | 'shadow' | 'done';

export interface HundredState {
  /** 第几遍（1..100） */
  pass: number;
  step: HundredStep;
  /** 当前遍里听到第几句 */
  sentenceIndex: number;
  /** 已经听完的遍数 */
  donePasses: number;
}

/** 100LS 的四个阶段各占多少遍（原始方法没说死，这是我们的取值） */
export const PASS_PLAN: { step: HundredStep; passes: number; label: string }[] = [
  { step: 'raw',    passes: 1,  label: '无字幕看一遍' },
  { step: 'zhSub',  passes: 2,  label: '中文字幕看一遍' },
  { step: 'enSub',  passes: 3,  label: '英文字幕看一遍' },
  { step: 'shadow', passes: 94, label: '反复听（每句听清）' },
];

export function nextPass(state: HundredState): HundredState { /* ... */ }
export function progressOf(state: HundredState): number { /* 0..100 */ }
```

**为什么把 1-3 遍的阶段固定、剩下 94 遍都算循环**：原始方法说前三遍有明确目的，
之后就是「反复听到脱口而出」。94 遍是可调的（放 Settings）。

### 3.5 字体/字幕的一条硬规矩

用户的视频可能带**硬字幕**（压在画面里）。这种情况我们无法分离字幕，
只能退化成「整段播放 + 不显示字幕轨」。UI 上要说清楚，不要让用户以为功能坏了。

---

## 四、实施顺序与验证

### 阶段 1：纯逻辑（可独立单测，零 UI 风险）

| 任务 | 产出 | 测试 |
| --- | --- | --- |
| SRT/VTT/ASS 解析 | `src/lib/subtitle.ts` | 三种格式 + 脏数据 + 时间轴乱序 |
| 100LS 遍次状态机 | `src/lib/listening.ts` | 遍次推进、阶段切换、进度、边界 |
| 例句/文章取句 | `src/data/listeningSources.ts` | 长度筛选、去重、来源标注 |

验证：`npx vitest run src/lib/subtitle.test.ts src/lib/listening.test.ts`

### 阶段 2：精听（不碰视频，风险最低）

- `ListeningPage` 的「例句精听」模式
- 用现成的 `speak()` 逐句播，走不通再考虑 `onboundary`
- 8,523 条长例句立即有内容

验证：三条老命令全绿 + 手动试听几条。

### 阶段 3：导入通道（唯一有平台差异的部分）

- 桌面端：`preload` 加 `pickMedia()` → `dialog.showOpenDialog`
- Web 端：`showOpenFilePicker`
- DB `version(3)`
- **同时修掉 `clearAllData` / `exportAllData` / `importAllData` 不覆盖 `customArticles` 的老缺陷**

验证：`npm run verify:desktop`（要加一项「能选到视频」）+ Web 手动测。
**注意**：装的那份桌面版 `main.cjs` 是 `app://typeflow`，改 `preload` 要同步替换
`resources/app/app/preload.cjs`，且**不能换 `main.cjs` 的 origin**（见 HANDOVER 五.3）。

### 阶段 4：100LS 模式

- 视频 + 字幕同步播放、遍次计数、阶段推进
- 字幕行随播放高亮（`<video>` 的 `currentTime` 可靠，比 Web Speech 强很多）

### 阶段 5：语块（独立小步，可随时插入）

- 在 `WordDetail` 里把例句提到释义下方，标注「这个词的语块」
- 半天，不依赖上面任何一步

---

## 五、风险清单

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **Web 端 File System Access API 兼容性** | Firefox/Safari 用不了 | 降级到「每次重选文件」，UI 明说 |
| **视频格式** | 用户导入 .mkv/.avi 浏览器解不了 | 只接受 mp4/webm，UI 提示；不做转码 |
| **硬字幕** | 无法分离字幕轨 | 明说，退化为整段播放 |
| **备份体积** | 若把视频塞进 DB，备份会 OOM | 只存引用，不存文件（本方案已规避） |
| **桌面版替换风险** | 改 `preload` 可能影响装的那份 | 严格照 HANDOVER 五.3 流程，`verify:desktop` 兜底 |
| **`onboundary` 不稳定** | 逐词高亮在 Safari 失效 | 不做逐词高亮；视频模式改用 `currentTime` |
| **100 遍的心理负担** | 用户看到「第 3/100 遍」可能退缩 | 显示「已完成 X 分钟」而不是只显示遍数；允许自定义总遍数 |

---

## 六、工作量估计（按我实际速度，不是乐观值）

| 阶段 | 内容 | 估计 |
| --- | --- | --- |
| 1 | 纯逻辑 + 单测 | 半天 |
| 2 | 精听页面 | 1 天 |
| 3 | 导入通道（含 DB v3 + 修三处老缺陷） | 1 天 |
| 4 | 100LS 模式 | 1 天 |
| 5 | 语块轻量版 | 半天 |
| — | 文档同步 + 三条验证 + 桌面版更新 | 半天 |
| **合计** | | **约 4–5 天** |

---

## 七、需要你确认的点

1. **视频存储方案**：同意「只存引用/句柄，不存文件」吗？（第二节方案 B）
2. **Web 端**：接受 File System Access API（Chrome/Edge 可用，其他浏览器降级）吗？
3. **100 遍的分配**：前三遍按原方法（无字幕→中文字幕→英文字幕）+ 94 遍循环，
   总遍数做成设置项可调 —— 这样可以吗？
4. **是否先只做阶段 1+2**（纯逻辑 + 精听），验证方向没错再继续 3+4？

我倾向 **4 里说的先做 1+2**：精听用现成数据、零平台差异、能立刻验证「用户到底会不会用」。
如果精听都没人用，100LS 投入 1-2 天做导入通道就是浪费。
