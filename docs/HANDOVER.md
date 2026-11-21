# 交接文档 · EnglishMate

> 更新日期：2026-11-21（上一版是 2026-11-20，本版按当天实际状态重写）
> 读者：接手的新会话 / 新模型，**没有任何上下文**。读完这一份就能开工，不必重新摸索。
> 仓库：<https://github.com/2327192084/englishmate>（MIT）
> 仓库根目录：`E:\EnglishMate`（bash 里是 `/e/EnglishMate`）

---

## 零、先看这三行

1. **状态**：功能完整、三条验证全绿、工作区干净、本地与远程同步（`git rev-list --count origin/main..HEAD` 应为 `0`）。
2. **可以做**：没有必须做的活儿。想继续开发看「八、还没做的」。
3. **最容易浪费时间的三个坑**：推 GitHub（五.1）、改源码的方式（五.2）、桌面版 origin 不能换（五.3）。**动代码前先扫一眼第五节。**

---

## 一、当前状态（一句话）

**功能完整的开源英语打字学习应用**，Web + Windows 桌面版，382 个测试全绿，tsc 零报错，数据契约校验通过。

| 指标 | 数值 |
|---|---|
| 代码规模 | `src/` 16,436 行（其中非测试 11,219 / 测试 5,217）；`scripts/` 6,754 行 |
| 测试 | **382 个，20 个文件，全绿**（串行跑，约 2.5 分钟） |
| 词库 | 16 个 / 55,560 词条（`public/dicts/`，约 16MB） |
| 文章 | 75 篇 / 490 句（`public/articles/index.json`） |
| 例句 | 57,257 条中英对照，覆盖 32,312 / 55,560 = 58.2% 词条 |
| 词关系 | 14,959 词（词形变化 + 形近易混，`word-graph.json`） |
| 文章点词释义 | 1,449 词条 / 554 变体（`article-glossary.json`，294KB raw / 120KB gzip，覆盖 98.4% 文章 token） |
| 页面 | 8 个（练习 / 词库 / 复习 / 文章 / 句子 / 数据 / 成就 / 设置） |
| 前端产物 | JS 554KB（gzip 182KB）+ CSS 26KB |
| 提交 | 远程 HEAD 与本地一致（具体哈希会变，别写死；用 `git rev-list --count origin/main..HEAD` 判断是否同步） |
| 环境 | Node v24.20.0 / npm 11.19.0 / git 2.56.0.windows.2 |

---

## 二、这次交接前刚做完什么（2026-11-21）

当天完成四件功能 + 桌面版更新，详见 `docs/work-report-2026-11-21.md`。摘要：

| 事项 | 落点 |
|---|---|
| tem8 词库放开 8000 条截断 | `scripts/build-more-dicts.mjs`；`tem8.json` 11,858 词 / 2.87MB |
| 文章译稿进仓库 | `data/articles-work/`（8 文件 132KB），`build-articles.mjs` 的 `WORK` 指向它 |
| 文章点词查释义 | `src/data/articleGlossary.ts` + `scripts/build-article-glossary.mjs` + `ArticlePlayer` 里 `ClickableSentence` |
| 句子库练习 | `src/pages/SentencesPage.tsx` + `src/data/sentences.ts` + `src/lib/sentenceDiff.ts`，路由 `/sentences` |
| 自定义快捷键 | `src/lib/keys.ts` + `Settings.shortcuts`，设置页录制式改键 |
| 错词按类型分组 | `src/lib/mistakeKind.ts` + `UserWord.mistakeKinds`，错词本可按类型筛选 |
| 桌面版更新 + 真窗口验证 | `electron/verify-desktop.cjs`（`npm run verify:desktop`） |

另外修掉 12 个真实缺陷（含一个「断言永远为真」的假测试、一个隔天必挂的 `--check`、一个既有的 flaky 测试），清单在 `docs/work-report-2026-11-21.md` 第三节。

**桌面版已经装好并验证过**：`%LOCALAPPDATA%\Programs\TypeFlow` 与 `release/TypeFlow` 都已载入新 dist，各跑通 7 项真窗口验证，旧学习进度（1 词 / 1 会话 / 1 成就）仍可见。

---

## 三、项目结构

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
│   │   ├── sentenceDiff.ts 整句逐词对比
│   │   ├── keys.ts         快捷键绑定 / 归一 / 判定
│   │   ├── mistakeKind.ts  错误分类（顺序/邻键/形近/想不起来）
│   │   ├── pwa.ts          Service Worker 注册（只认 window.englishmate）
│   │   ├── report.ts       学习报告 SVG 生成
│   │   ├── speech.ts       语音合成封装
│   │   └── sound.ts        Web Audio 按键音合成
│   ├── data/
│   │   ├── wordbanks.ts       词库按需加载（含 custom: 前缀走 IndexedDB）
│   │   ├── wordGraph.ts       词关系加载
│   │   ├── articleGlossary.ts 文章点词释义表加载
│   │   ├── customArticles.ts  用户导入文章（解析 + 存储）
│   │   ├── round.ts           出题队列（收藏→到期→错词→新词→兜底）
│   │   ├── sentences.ts       例句抽取（错词本 / 收藏 / 按词库）
│   │   ├── articles.ts        文章（import JSON 产物）
│   │   └── achievements.ts    14 个成就定义
│   ├── db/index.ts     Dexie 七张表 + 导入导出 + 设置读写
│   ├── services/
│   │   ├── learning.ts     唯一写入口（作答 → FSRS → 会话）
│   │   └── achievements.ts 成就判定与解锁
│   ├── store/          Zustand（settings / practice）
│   ├── components/     Layout / TypingArea / WordDetail / WordFamilyHint / ui / Icons
│   └── pages/          8 个页面（+ PracticeFlow / SentencesPage 两个渲染测试）
├── public/
│   ├── dicts/          16 个词库 + index.json + word-graph.json + article-glossary.json
│   └── articles/       index.json（75 篇内联）
├── data/articles-work/ 文章译稿源数据（8 文件，必须留在仓库里）
├── electron/           main.cjs / preload.cjs / smoke.cjs / verify-desktop.cjs / EnglishMate.bat
├── scripts/            数据流水线（见七）
├── docs/               各文档（本文件是最重要的入口）
├── .tmp/               下载缓存与一次性脚本（gitignore，删了不影响构建）
└── release/            桌面可运行目录（gitignore，含 215MB exe）
```

### 分层纪律（重要，别破坏）

| 目录 | 允许 | 禁止 |
|---|---|---|
| `src/lib/` | 纯 TS 函数（可 `import type` from `@/types`） | **任何 React 依赖** |
| `src/data/` | 数据、纯策略 | 直接操作数据库 |
| `src/services/` | 数据库读写 | UI 状态 |
| `src/components/` | 展示与交互 | 业务规则 |

---

## 四、验证命令（改动后必跑，三条全绿才算完成）

```bash
cd /e/EnglishMate
npx tsc --noEmit               # 类型检查，0 错误
npx vitest run                 # 382 个测试
node scripts/verify-data.mjs   # 数据契约（16 库 / 75 篇 / glossary）
```

- `fileParallelism: false` 已配置，测试**串行**跑（渲染测试共用 fake-indexeddb 与全局 store，并行会互踩）。全量约 2.5 分钟，别以为挂了。
- 单跑一个文件快得多：`npx vitest run src/lib/keys.test.ts`；单跑一个用例：`-t "用例名"`。
- 看结果最省 token 的方式：`npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"`。
- 改了桌面相关再补：`npm run verify:desktop`（见五.3）。
- CI 在 `.github/workflows/verify.yml`，只跑上面三条，**不含 prettier 检查**。

---

## 五、本机环境陷阱（最容易浪费时间的部分）

### 1. 推送到 GitHub —— 这台机器有一半概率失败，别用默认命令

默认 `git push` 会随机报这两种错，**都不是凭据问题，也不是仓库问题**：

| 报错 | 真实原因 |
|---|---|
| `Recv failure: Connection was reset` | GitHub 边缘 IP 被 TLS 重置 |
| `Failed to connect to github.com:443 after 21xxx ms` | 本机 DNS（`2400:3200::1` 阿里 IPv6）对 github.com 无响应 |

**能用的命令（可用 IP 不止一个，某天某个会突然不通，所以按下面的循环挨个试）**：

```bash
cd /e/EnglishMate
for ip in 140.82.113.4 140.82.112.4 140.82.114.4 140.82.121.4; do
  echo "--- try $ip"
  GCM_INTERACTIVE=never timeout 90 \
    git -c credential.helper= \
      -c credential.helper=/ucrt64/bin/git-credential-manager.exe \
      -c http.curloptResolve=github.com:443:$ip \
      -c http.postBuffer=524288000 \
      push origin main 2>&1 | tail -3
  [ "$(git rev-list --count origin/main..HEAD)" = "0" ] && break
done
```

要点，逐条都是踩出来的：

- **`-c credential.helper=` 必须先在前面写一次清空的**。`git -c credential.helper=X` 是**追加**不是替换，全局的 `helper-selector` 会一起跑，然后在无 tty 环境里挂死报 `bash: line 1: /dev/tty: No such device or address`。
- 凭据在 Windows 凭据管理器里（用户 `2327192084`，GitHub PAT），`git-credential-manager.exe get` 能取出来；`GCM_INTERACTIVE=never` 必须设。
- **`curloptResolve` 要带 `.4` 系列 IP**：`140.82.112.4` / `140.82.113.4` / `140.82.114.4` / `140.82.121.3` / `140.82.121.4`（`curl --resolve github.com:443:<ip>` 全部 200）。`140.82.112.3` 连不上；`.113.3` / `.114.3` / `.116.3` / `20.205.243.166` TCP 通但 TLS 被重置。**注意可用性会变**：2026-11-21 当天 `140.82.112.4` 一次成功，几小时后同样命令报 `Recv failure`，`140.82.113.4` 立刻成功——所以不要只试一个 IP。
- **⚠️ 会有整条 `github.com:443` 都连不上的时段（不是换 IP 能解决的）**：2026-11-21 13:50 前后约 5 分钟，上面列的所有 IP 全部 `code=000` 超时，`curl -sv` 显示 TLS 握手能完成、到数据阶段 `recv returned error 56`；同一时刻 `api.github.com`（200）、`registry.npmjs.org`、`codeload.github.com`（301）都正常，`20.205.243.166` 的 TCP 443 能连上但握手后即断。**5 分钟后再测，四个 IP 又全部 200——是间歇性故障，不是永久封锁。**
  - **判断方法**：`curl -sS -o /dev/null -w "%{http_code}\n" --resolve github.com:443:140.82.113.4 --max-time 10 https://github.com/`。返回 `000` 就是整条链路暂时不通，**别再挨个换 IP 了**，隔几分钟重试一次即可。
  - 本地提交不会丢，`git rev-list --count origin/main..HEAD` 记着欠几个；实在推不上去就先攒着，别为了推送去改写历史。
  - **2026-11-21 14:26–14:35 又遇到一次，多了两条可用的判断线索**：
    1. **分清 TCP 层和 TLS 层**：`/dev/tcp/<ip>/443` 全部 `TCP OK`，但 `curl https://github.com/` 全部 `000` —— 说明端口通、TLS 被 RST。这时换 IP 无意义。
    2. **用 80 端口做对照**：`curl --resolve github.com:80:<ip> http://github.com/` 返回 **301**（正常），而同一 IP 的 443 返回 000 —— 进一步确认是 TLS 层被掐，不是整条网络断。用 `curl -L` 跟随那个 301（它会跳回 https）反而可能拿到 **200**，说明握手时好时坏。
    3. **恢复很快**：这次持续约 9 分钟，恢复后三个 IP 同时变回 200。所以策略就是**隔几十秒探一次，一探到 200 立刻 push**，不要一失败就去改命令或换方案。
    4. `ssh.github.com:443` 与 `github.com:22` 两次都通（TCP 层），但 `~/.ssh/` 无密钥，SSH 通道暂时用不了——真要长期解决可以配 SSH key 绕开 443 的 TLS 干扰。
- **`timeout` 包一层有用**：坏 IP 的表现是卡住而不是立刻失败。外层套 `timeout 90`，失败就换下一个 IP 重试。
- 诊断命令：`timeout 6 bash -c "cat < /dev/null > /dev/tcp/140.82.112.4/443"`；`curl -sI --resolve github.com:443:140.82.112.4 https://github.com` 看 code。
- `api.github.com` 一直可用（未认证每小时 60 次配额，`build-more-dicts.mjs` 要用）；`github.com:22` 端口通但 `~/.ssh/` 里**没有密钥**，SSH 推送不可用。
- 推送后确认：`git log origin/main..HEAD | wc -l` 应为 0。

### 2. 改源码只能用 Edit / Write 工具

**不要**用 `sed -i`、`python -c`、超长 `node -e` 拼字符串改源码。曾在 bash 里用 python 正则改 TS，`\s` `\(` 被 shell 吃掉，正则静默写坏，很难发现。

- 复杂一点的测量/批处理脚本，写成 `.tmp/xxx.mjs` 文件再跑，不要塞进命令行。
- `edit` 之前必须先 `read` 过那个文件（否则报 `file has not been read`）。
- `edit` 的 `old_string` 要确认覆盖范围：曾改函数首行时把函数体三行一起匹配删掉，留下悬空的 `aria-checked`。

### 3. 桌面版：只换 dist，**绝对不要**换 main.cjs / preload.cjs

桌面版还叫 `TypeFlow`（改名是已划出范围的事）：

```bash
cd /e/EnglishMate
npm run build:desktop                    # ENGLISHMATE_DESKTOP=1 → vite base './'
INST="$LOCALAPPDATA/Programs/TypeFlow/resources/app"
cp -r "$INST/dist" ".tmp/desktop-backup/$(date +%Y%m%d-%H%M%S)"   # 先备份
rm -rf "$INST/dist" && cp -r dist "$INST/dist"
cp -r dist "release/TypeFlow/resources/app/dist"                   # 同步待分发包
npm run verify:desktop                                             # 拉起真窗口，7 项断言
```

**为什么不能换 main/preload**：装的那份是 `app://typeflow` + `window.typeflow`，仓库版是 `app://englishmate` + `window.englishmate`。换掉会改变 IndexedDB 的 origin（`app_typeflow_0` → `app_englishmate_0`），**用户学习进度当场不可见**（数据还在磁盘上，但库名不一样了）。

- `npm run verify:desktop` 默认验证 `%LOCALAPPDATA%\Programs\TypeFlow`，也可 `node electron/verify-desktop.cjs release/TypeFlow`。7 项：页面渲染 / `origin === 'app://typeflow'` / preload 生效且 Node 隔离 / IndexedDB 四表条数 / `article-glossary.json` 可 fetch / 导航含 `/sentences` / 首屏+刷新无 console error。截图在 `.tmp/desktop-shots/`。
- **不要用 `electron/smoke.cjs` 验证装的那份**：它断言 `app://englishmate` + `window.englishmate`，测 TypeFlow 会假失败。
- `src/lib/pwa.ts` 只认 `window.englishmate?.isDesktop`，在 TypeFlow 里恒为 false——但 SW 注册还有 `protocol.startsWith('http')` 兜底，桌面端不会误注册，**目前无实际影响**；真改名时必须一起处理。
- `%APPDATA%\TypeFlow` 与 `%LOCALAPPDATA%\TypeFlow` 对 Electron 进程返回 **EPERM**（bash/PowerShell 能写，Chromium 进程不能），所以 `resolveUserDataDir()` 四级回退：`LOCALAPPDATA` → `APPDATA` → exe 同级 `data/` → tmp。**后果：装的那份数据在 `%LOCALAPPDATA%\TypeFlow`，而 `release/TypeFlow` 跑起来会落到它自己的 `data/` 便携目录，两份 profile 不互通——这是既有环境行为，不是 bug。**
- 读主进程路径别用 `npx electron xxx.cjs`（无窗口主进程会挂住不退），用 playwright `_electron.launch` + `app.evaluate(({app}) => app.getPath(...))`。

### 4. 测试相关

- 渲染测试（`.test.tsx`）走 jsdom（`environmentMatchGlobs`），其余走 node。
- 改设置必须**写进 IndexedDB**：App 挂载时会从库里覆盖 store。`PracticeFlow.test.tsx` 里有 4 处 `db.settings.put({...})`，**给 `Settings` 加字段会让这 4 处全部类型报错**，记得一起补。
- 点按钮前先确认它没 `disabled`：曾有一个 flaky 测试，按钮渲染出来就带「开始」文字但 `bankId` 还是空串所以 disabled，`fireEvent.click` 打在 disabled 按钮上毫无反应，干等 5 秒超时。现在辅助函数里加了 `expect(btn).not.toBeDisabled()`。
- `App.test.tsx` **没有全局 cleanup**，上一个用例的 DOM 会留在 body 上，断言用 `getAllByText(...).length > 0` 而不是 `getByText`。

### 5. prettier / 行尾

- 配置在 `.prettierrc.json`（单引号、无分号结尾、printWidth 100、LF）。改完自己动的文件可以 `npx prettier --write <file>`。
- **不要对 `docs/HANDOVER.md` 跑 prettier**：它会重排整篇表格（179 行假改动）。`README.md` / `docs/dict-catalog.md` / `docs/unimplemented-features.md` 在 HEAD 上本来就不是 prettier-clean，属既有状态，别顺手格式化。
- `core.autocrlf=true`，所以 `git status` 偶尔出现「只改了行尾」的假改动，`git diff` 看过内容后再决定 `git add` 还是 `git checkout --`。

### 6. 网络可达性

| 域名 | 状态 |
|---|---|
| `api.github.com` | ✅ 可用，**未认证每小时 60 次** |
| `registry.npmjs.org` | ✅ 可用 |
| `downloads.tatoeba.org` | ✅ 可用，约 60KB/s，**支持 `curl -C -`** |
| `kaikki.org` | ✅ 可用，单页 200-600KB，**9.5 秒/次** |
| `gutenberg.pglaf.org` | ✅ 可用（正站 `www.gutenberg.org` 已 503） |
| `github.com`（git push） | ⚠️ 一半概率失败，见五.1 |
| `raw.githubusercontent.com` / `cdn.jsdelivr.net` / huggingface | ❌ 被阻断 |

---

## 六、数据流水线

| 脚本 | 作用 | 耗时 |
|---|---|---|
| `scripts/build-dicts.mjs` | 从 Qwerty Learner 拉词表 | 几分钟 |
| `scripts/build-more-dicts.mjs` | 扩充到 16 个词库（支持 `--offline --only=<id>`） | 几分钟 |
| `scripts/build-sentences.mjs` | Tatoeba 离线 join 出例句 | **1 分钟**（扫 204 万句） |
| `scripts/build-rich-dicts.mjs` | 补词性释义 + 例句 + 音标（支持 `--offline --only=`） | 几分钟 |
| `scripts/build-word-graph.mjs` | 挖词形变化 + 形近词 | 约 1 分钟 |
| `scripts/build-articles.mjs` | 生成文章语料（支持 `--check`） | 秒级 |
| `scripts/build-article-glossary.mjs` | 生成点词释义表（支持 `--check`） | 几秒 |
| `scripts/verify-data.mjs` | 校验全部产物 | 几秒 |

- **缓存都在 `.tmp/`**（gitignore，删了要重新下载）：`rich-cache/ecdict.csv` 63MB、`rich-cache/eng_sentences.tsv`、`dicts.json`（380 库 sha 列表）、`blobs/*.json`（词表 blob 缓存，`--offline` 靠它）。
- 文章译稿**在仓库里**：`data/articles-work/`（`classics.json` + `zh-batch-01..07.json`，共 132KB）。别人 clone 后可直接 `node scripts/build-articles.mjs`。`.tmp/articles-work/` 里剩的 16MB 是试验脚本与中间产物，**不需要进仓库**。
- 两个 `--check` 都只比内容、不比 `generatedAt`（否则隔天跑必挂——这是当天修掉的真实 bug）。

---

## 七、已完成的功能（不要重复做）

| 模块 | 状态 |
|---|---|
| 四种练习方式 | 跟打 / 听写 / 默写 / 辨认 |
| 分组循环流程 | 7 词一组，跟打 → 默写 → 听写 |
| FSRS 间隔重复 | 完整实现 |
| 抗休眠计时 | 空闲暂停 + 休眠不计时 |
| 错词本 / 收藏 / 已掌握 | 收藏已真正参与调度；错词按四类错误来源分类，可按类型筛选 |
| 16 个词库 + 自定义导入 | 55,560 词条 |
| 75 篇文章 + 自定义文章导入 | 三种格式解析 + GBK 检测 |
| 词形变化 / 形近词 | 14,959 词，练习界面提示 + 详情面板 |
| 文章点词联动 | 阅读时点句中单词查释义（覆盖 98.4% token，未命中的不可点） |
| 句子练习 | `/sentences`，三来源，整句输入 + 逐词着色 |
| 自定义快捷键 | 四个动作可改键，设置页录制式录入，提示文案同步 |
| 错词按类型分组 | 四类错误在作答时采集，错词本可按类型筛选 |
| 学习报告导出 | SVG / PDF |
| 成就系统 | 14 个，已接通 |
| 深浅主题 / PWA / 桌面版 | 完成 |

---

## 八、还没做的（下一步候选）

### A 档 · 数据现成，成本低

| 功能 | 说明 |
|---|---|
| 文章扩到 800 句 | 现在 75 篇 / 490 句。素材池还有约 100 篇已切好句但**未翻译**的寓言——纯人力，不是代码问题 |

### B 档 · 需要先补数据结构

| 功能 | 障碍（已实测） |
|---|---|
| **键盘热力图** | ⚠️ 不是「加个图表组件」。完全没有按字符的错误统计：`UserWord` 只有 `mistakes` 总数；`TypingState.lastWrongChar` 只用于当场 UI 提示、**从不落库**；`PracticeSession` 只有 `keystrokes`/`correctKeystrokes` 总数。要做需打通 `lib/typing.ts` → `services/learning.ts` → 新 Dexie 表（**v3 迁移**，且要同步 `clearAllData`/`exportAllData`/`importAllData` 三处）→ 统计页图表，`src/lib` 改动要保持零 React 依赖。注意它要统计**所有**键（含从没打错过的键），所以不能像错词分类那样塞进 `UserWord` 可选字段 |

### C 档 · 成本高或不建议

| 功能 | 说明 |
|---|---|
| 近义词 | kaikki.org 可达、质量好，但全量抓取实测约 49.6 小时，且义项级会抓错（adapt→proportion）。只抓高频 3000 词约 8 小时 |
| 英美双音标 | ⚠️ 许可证红线：ipa-dict 的 `en_UK` 上游是 GPL-3.0，**只能用 en_US** |
| 例句覆盖率 59% → 更高 | GRE 30% / SAT 30% / linux 20% / medical 24% 是 Tatoeba 语料的真实上限，冷僻词与命令名在 7.8 万对语料里本就罕见。不是代码问题 |
| Windows 安装包（NSIS） | 依赖远程工具链，本机反复超时。当前用可运行目录替代，可用性一致 |
| i18n | 无 `src/i18n`，界面全中文，当前用户群全中文，收益低 |
| AI 功能 / 云同步 / 排行榜 / 插件 / 发音评测 | README 路线图 P1/P2 规划，均未开始。云同步与排行榜需要后端，AI 需要 API Key |
| 桌面版改名 TypeFlow → EnglishMate | 必须同时迁移数据目录 `%LOCALAPPDATA%\TypeFlow`（含 IndexedDB），否则丢学习进度。**用户已明确把这项划出范围** |

### 已知的小缺陷（都不影响功能，顺手可修）

1. `BUILTIN_BANK_IDS` 与 `FALLBACK_BANKS`（`src/data/wordbanks.ts`）只硬编码 **8 个**词库，实际有 16 个。走 `loadBankIndex()` fetch 成功时无影响，fetch 失败退化时才露出。
2. `clearAllData` / `exportAllData` / `importAllData`（`src/db/index.ts`）**都没覆盖 `customArticles`**（`clearAllData` 还没清 `settings`）。用户导入的自定义文章不参与导出/导入/清空。
3. `verify.yml` 注释里提到的 `docs/dict-contribution.md` **不存在**。
4. `src/lib/pwa.ts` 只认 `window.englishmate`，桌面 TypeFlow 里恒 false（有 `protocol.startsWith('http')` 兜底，无实际影响）。

---

## 九、许可与署名（合规要求，别动）

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

## 十、关键设计决策（避免被"优化"掉）

| 决策 | 原因 |
|---|---|
| 计时用累计活跃时长，不用 `Date.now()` 差值 | 休眠后 WPM 会被稀释到 0 |
| 打错不前进光标（严格模式） | 防止错误肌肉记忆 |
| 输入法组字期间忽略所有按键 | 否则拼音字母被当答题 |
| Tab 键 = 重听发音（不是跳过） | 跳过与 Space 重复；四个键位已可配置，默认值保持这一行为 |
| 练习方式合并成一个选择器 | 原来"模式"和"流程"概念重叠 |
| 词形提示跟打默认展开、默写/听写默认折叠 | 后两者目标是从记忆提取，摊开等于送答案 |
| 词关系独立文件不塞进词库 | 否则 16 个词库文件体积翻倍且重复 |
| 文章点词用独立 glossary 文件，不按词加载整库 | 点一个词不该下载 1.3MB 的高考词库；独立文件 gzip 约 120KB |
| 文章可点词用 `span[role=button]` 不用 `button` | 几十个 button 会污染 Tab 焦点漫游，用户按 Tab 是想跳输入框 |
| 快捷键判定集中在 `lib/keys.ts` | 脏配置（两动作抢一键）只能在一处收敛 |
| 改键时新键已被占用就**交换**而非拒绝 | 用户改键的常见意图就是两键对调 |
| 错词分类做成 `UserWord.mistakeKinds` 可选字段，不建新表 | 分类是稀疏的；省一次 v3 迁移 + 三处导入导出同步 |
| 没采集到错误分类时存 `undefined` 而不是全零 | 全零会被读成「从没错过这类错」，是假数据 |
| 报告用 SVG 自绘不引 jsPDF | 省 200KB，矢量不糊 |
| 句子练习长度上限 100，文章校验上限 140，**故意不同** | 实测例句最长 80 字符（100 一条都筛不掉，是安全网）；文章有 67 篇含 >100 字符句子（放宽到 140 就是把长句塞进整句输入）。别去统一 |
| 桌面版只换 dist，不改 main/preload | 改 origin 会让旧 IndexedDB 学习进度不可见 |

---

## 十一、其他文档索引

| 文件 | 内容 |
|---|---|
| `docs/work-report-2026-11-21.md` | 当天工作报告：完成项、12 个真实缺陷、关键决策、诚实的缺口 |
| `docs/unimplemented-features.md` | 未做功能的**证据级**盘点（附可重跑的核实命令） |
| `docs/dict-catalog.md` | 16 个词库的体积、覆盖、重叠率、如何新增词库 |
| `docs/article-sources.md` | 75 篇文章的来源、译稿流程、复现步骤 |
| `docs/dictionary-sources.md` | 词典数据源的调研（含许可证分析） |
| `docs/push-to-github.md` | 建仓库的流程（凭据部分已过时，推送看本文件五.1） |
| `README.md` | 对外的功能说明与快速开始 |
| `CONTRIBUTING.md` | 贡献流程 |
