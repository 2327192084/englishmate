/**
 * 文章语料 —— 中英对照，逐句跟打 / 听写用。
 *
 * 数据放在 `public/articles/index.json`，由 `scripts/build-articles.mjs` 生成。
 * 这里只做类型断言与导出，页面代码从 `@/data/articles` 取 `ARTICLES`，无需改动。
 *
 * 为什么用 JSON 而不是继续硬编码在这里：
 *   - 文章已经到 50+ 篇、几千行 TS 字面量，维护和 diff 都很痛；
 *   - 语料与代码分离后，加文章只需重跑构建脚本，不碰源码；
 *   - 构建期脚本负责校验（长度、字符、字段、id 唯一），错误在提交前就暴露。
 *
 * 选文原则：
 *  1. 只用**公版**（public domain）作品，译文由本项目人工翻译；
 *  2. 英文尽量保留原文措辞与标点，便于读者逐句核对；
 *  3. 遇到过长的原句，在自然分句处截断，并用省略号 `…` 明确标出：
 *     - 句末 `…` 表示后文被略去；
 *     - 句首 `…` 表示承接上一句的被略部分。
 *     两半拼起来即为原句全文，不增删任何词。
 *  4. 每句 `en` 控制在 140 字符以内 —— 长句逐字符跟打体验太差。
 *
 * 难度标签（level）取 "CET-4" / "CET-6" / "考研" / "雅思" 之一。
 *
 * 语料来源与许可：见 docs/article-sources.md。
 */

import type { Article } from '@/types';
// public/ 下的静态资源同时可被 Vite 当模块解析；构建产物会把它内联进 bundle，
// 因此运行时不依赖 http 请求，桌面版（file://）下也能正常工作。
import data from '../../public/articles/index.json';

export const ARTICLES: Article[] = data as Article[];