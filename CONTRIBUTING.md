# 贡献指南

感谢你愿意参与 EnglishMate。这是一份尽量简短的实用文档。

## 开发环境

```bash
node -v          # 需要 >= 18
npm install
npm run dev
```

提交前请确保这两条都通过：

```bash
npm run typecheck
npm run test
```

## 代码约定

### 分层纪律

这是本项目最重要的约定，比任何格式规范都重要：

| 目录              | 允许                     | 禁止                                                                             |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `src/lib/`        | 纯 TypeScript 函数、类型 | **任何 React / DOM 依赖**（`speech.ts`、`sound.ts` 例外，它们是浏览器 API 封装） |
| `src/data/`       | 数据、纯策略函数         | 直接操作数据库                                                                   |
| `src/services/`   | 数据库读写               | UI 状态                                                                          |
| `src/store/`      | Zustand store            | 直接写数据库（走 services）                                                      |
| `src/components/` | 展示与交互               | 业务规则                                                                         |
| `src/pages/`      | 组装                     | 算法实现                                                                         |

**为什么**：`lib/` 里的东西要能被单测、被将来的 CLI 或浏览器插件复用。一旦混入 React，这些都做不到了。

### 风格

- 注释用中文，标识符用英文。
- 不用 `any`。实在需要时用 `unknown` + 类型收窄。
- 组件保持函数式，副作用集中在 `useEffect`。
- 新算法必须带单测，新工具函数优先放进 `lib/`。

### 提交信息

```
feat: 新增听写模式的语速自适应
fix: 修复空词条导致错误计数虚高
docs: 补充词库格式说明
refactor: 把出题逻辑从页面抽到 data/round.ts
test: 补 FSRS relearning 分支的用例
```

## 补充词库

### 内置词库

词库由 `scripts/build-dicts.mjs` 从 Qwerty Learner 的原始数据生成，产物是 `public/dicts/<id>.json`：

```json
{
  "meta": {
    "id": "cet4",
    "name": "CET-4 · 四级核心",
    "category": "exam",
    "description": "大学英语四级核心词汇",
    "count": 2607,
    "source": "Qwerty Learner (MIT) · public/dicts/CET4_T.json"
  },
  "words": [{ "w": "cancel", "t": "取消，撤销；删去", "p": "/'kænsl/" }]
}
```

要加新词库，在 `scripts/build-dicts.mjs` 的 `BANKS` 里加一项，然后 `node scripts/build-dicts.mjs`。

### 用户导入格式

用户可以在「词库」页导入自己的词表，支持三种格式：

```csv
# 1. CSV / TSV：每行 word,释义[,音标]
ubiquitous,无处不在的,/juːˈbɪkwɪtəs/
serendipity,意外发现
```

```json
// 2. EnglishMate 格式
[{ "w": "ubiquitous", "t": "无处不在的", "p": "/juːˈbɪkwɪtəs/" }]
```

```json
// 3. Qwerty Learner 原始格式（自动兼容）
[{ "name": "ubiquitous", "trans": ["无处不在的"], "usphone": "ju'bɪkwɪtəs" }]
```

## 校对文章语料

`src/data/articles.ts` 里的英文必须是**可核对的公版原文**或准确转述。改动的 PR 请附上出处链接。

译文要求自然，不必逐字对应——读者是中文母语的学习者。

## 新增练习模式

1. 在 `src/types.ts` 的 `PracticeMode` 里加类型
2. 在 `src/pages/PracticePage.tsx` 的 `MODES` 里加元信息
3. 如果校验逻辑和现有模式不同，在 `src/lib/typing.ts` 里加纯函数并写单测
4. 在 `src/components/TypingArea.tsx` 里处理渲染分支

## 提 Issue

请用模板，并尽量包含：

- 复现步骤（哪一步开始不对）
- 浏览器与版本
- 截图或录屏（打字类 bug 尤其需要）
- 如果涉及数据，说明是否用了自定义词库

## 提 PR

- 一个 PR 做一件事，不要把格式化和功能混在一起。
- 新功能请先开 Issue 讨论，避免白做。
- 涉及 UI 的改动请附截图。
- 保持 diff 可读：不要顺手 Reformatted 无关文件。

## 行为准则

技术讨论对事不对人。不欢迎任何形式的骚扰、歧视与人身攻击。维护者有权移除不当内容。
