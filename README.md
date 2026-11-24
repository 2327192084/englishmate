# EnglishMate · 打字即学习

> 把背单词、练打字和磨语感合成一件事的开源英语学习应用。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)

**免费 · 无广告 · 无内购 · 数据本地优先**

## 项目介绍

EnglishMate 通过“看拼写、听发音、敲键盘”的方式练习英语词汇。应用提供四种练习模式、分组循环流程和 FSRS 间隔复习，并支持文章、例句、错词本与学习统计。

- 逐字符校验，错误原地纠正，避免把错拼练成肌肉记忆
- Enter 提交下一个词，Space 可正常输入多词拼写中的空格
- 支持 Web 和 Windows 桌面版
- 无需账号，学习数据保存在本机

## 主要功能

| 模块 | 能力 |
| --- | --- |
| 四种练习模式 | 跟打、听写、默写、四选一辨认 |
| 分组循环 | 跟打 → 默写 → 听写，逐层减少提示 |
| 间隔复习 | FSRS-4.5 安排复习与错词重练 |
| 文章练习 | 逐句跟打、听写、中英对照、点词查释义 |
| 句子练习 | 整句输入、完形填空、窄式精听 |
| 内置词库 | 16 个词库，覆盖中小学、考试、程序员和医学等场景 |
| 学习记录 | 错词本、收藏、已掌握、WPM、正确率和学习热力图 |
| 本地数据 | IndexedDB 存储，支持 JSON 导入与导出 |
| 个性化 | 深浅主题、发音口音与语速、键盘音效、自定义快捷键 |

## 快速开始

需要 Node.js 18+。

```bash
git clone https://github.com/2327192084/englishmate.git
cd englishmate
npm install
npm run dev
```

开发服务器默认运行在 `http://localhost:5173`。

常用命令：

```bash
npm run build        # 类型检查 + 生产构建
npm run preview      # 预览生产构建
npm run test         # 单元、集成和渲染测试
npm run typecheck    # TypeScript 类型检查
npm run verify       # 校验词库与文章数据
```

## Windows 桌面版

可以从 [Releases](https://github.com/2327192084/englishmate/releases/latest) 下载安装包。

桌面版使用 Electron，页面通过 `app://englishmate/` 加载，以保证 IndexedDB 等本地存储正常工作。安装包使用 Inno Setup 构建，采用每用户安装，不删除用户学习数据。

本地构建桌面版：

```bash
npm run build:desktop
"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" packaging\englishmate.iss
```

安装包输出到 `release/installer/EnglishMate-Setup-0.1.0.exe`。

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 前端 | React 18、TypeScript 5.7、Vite 6 |
| 桌面端 | Electron 43 |
| 状态管理 | Zustand 5 |
| 本地存储 | IndexedDB、Dexie 4 |
| 样式 | Tailwind CSS 3 |
| 复习算法 | FSRS-4.5 |
| 发音与音效 | Web Speech API、Web Audio API |
| Windows 安装包 | Inno Setup 6 |

## 目录结构

```text
src/
├── components/   UI 组件
├── pages/        页面
├── store/        练习与设置状态
├── services/     学习记录写入
├── db/           IndexedDB 表结构与导入导出
├── data/         词库、文章和出题策略
└── lib/          打字、复习、统计等纯逻辑

electron/         Electron 主进程与预加载脚本
public/dicts/     内置词库数据
packaging/        Windows 安装包脚本
```

## 数据与隐私

- 所有学习数据保存在本机，不上传服务器。
- 没有账号系统、埋点或第三方统计。
- 可在设置页导出 JSON 备份、导入恢复或清空数据。
- 清理浏览器数据会丢失记录，建议定期导出备份。

## 许可

代码采用 [MIT](./LICENSE)。

数据来源与许可：

| 数据 | 来源 | 许可 |
| --- | --- | --- |
| 词表 | [Qwerty Learner](https://github.com/RealKai42/qwerty-learner) | MIT |
| 词性释义 | [ECDICT](https://github.com/skywind3000/ECDICT) | MIT |
| 英中例句 | [Tatoeba](https://tatoeba.org) | CC-BY 2.0 FR（需署名） |

应用“设置 → 关于 → 数据来源”中已标注以上来源。
