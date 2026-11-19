# 推送到 GitHub

> 仓库已就绪：4.9MB、105 个文件、15 次提交、最大单文件 2MB（远低于 GitHub 100MB 限制）。
> 等待远程仓库地址后执行本文命令。

## 一、你要做的（在 GitHub 上建空仓库）

1. 打开 <https://github.com/new>
2. **Repository name** 填 `englishmate`
3. **Description**（可选）填：`打字即学习的开源英语学习应用 · Type-to-learn English`
4. 可见性选 **Public**（开源项目）或 Private（先私有、之后可转公开）
5. **下面三个复选框全部不要勾**：
   - ❌ Add a README file
   - ❌ Add .gitignore
   - ❌ Choose a license

   > 为什么不勾：本地已经有完整内容了。勾了会在远程产生一个初始提交，
   > 推送时会和本地历史冲突（需要额外 merge 或 force push）。

6. 点 **Create repository**
7. 把仓库地址发我，形如：
   - `https://github.com/<你的用户名>/englishmate.git`

## 二、我拿到地址后会执行的命令

```bash
cd /e/EnglishMate

# 1. 配置远端
git remote add origin https://github.com/<owner>/englishmate.git

# 2. 确认分支叫 main（GitHub 默认）
git branch -M main

# 3. 推送（此时你的 Git 客户端会弹窗要求登录）
git push -u origin main
```

## 三、关于凭据

本机没有存储任何 GitHub 凭据。推送时会由 Git 凭据助手弹窗要求认证：

- **推荐**：浏览器弹窗登录 GitHub（最省事，Git 会自动保存）
- 或者填 **Personal Access Token**（Settings → Developer settings → Personal access tokens → Fine-grained tokens，勾 `Contents: Read and write`）
- **不要用账户密码**——GitHub 早已不支持密码推送

如果想提前保存凭据，可以先跑一次：

```bash
git config --global credential.helper manager
```

Windows 上通常已默认是 `manager`，首次推送会自动弹窗。

## 四、推送后建议做的三件事

1. **补仓库元信息**（网页上操作）
   - About → Description：`打字即学习的开源英语学习应用`
   - Topics：`english-learning` `typing-practice` `spaced-repetition` `fsrs` `react` `typescript` `education`

2. **确认 License 被识别**
   - 仓库首页右侧应显示 `MIT license`
   - 若没显示，检查 `LICENSE` 文件是否在根目录（它已在）

3. **开启 GitHub Pages（可选，做在线 Demo）**
   - Settings → Pages → Source 选 `GitHub Actions`
   - 因为项目用 Vite + SPA 路由，需要 404 回退。仓库里已有 `vercel.json`，
     若走 Pages 需额外加一个 `404.html`（内容同 `index.html`）。这一步我可以代做。

## 五、仓库体积说明（避免以后踩坑）

历史里曾误提交过 `release/` 打包产物（含 215MB 的 exe），已用 `git filter-branch`
从**全部历史**清除，`.git` 从 169MB 降到 4.9MB。`.gitignore` 已加入：

```
release/
*.exe
*.dll
*.pak
*.dat
```

**以后不要把这些提交进去**，否则推送会因单文件超限失败。

## 六、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `remote origin already exists` | 已配过远端 | `git remote set-url origin <新地址>` |
| `Updates were rejected` | 远程有初始提交（建仓库时勾了 README） | `git pull --rebase origin main` 后再推，或 `git push -f`（仅当确认远程无内容） |
| `Authentication failed` | 用了密码而非 token | 改用 token 或浏览器登录 |
| 推送卡住很久 | 网络 | 项目仅 4.9MB，正常几秒；卡住建议 `git config --global http.postBuffer 524288000` |
