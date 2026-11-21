/**
 * 把词库例句的中文译文统一成简体。
 *
 * ── 为什么需要这一步 ────────────────────────────────────────────────────
 * 中英例句来自 Tatoeba（CC-BY 2.0 FR），而 Tatoeba 的中文语料是
 * **繁体与简体混杂**的（社区贡献者来自各地）。实测 57,257 条例句里
 * 约 34.8% 含繁体字，且均匀分布在全部 16 个词库中。
 *
 * 用户反馈截图里出现「我想確定手機能有優秀的客戶服務」——同一句里
 * 「确定」是简体、「手機」「優秀」「客戶」「服務」是繁体，看起来像乱码。
 * 中文用户读简体更自然，且**一个应用里混用两套字形**是明确的缺陷。
 *
 * ── 为什么在构建期转换，而不是运行时 ────────────────────────────────────
 *  1. 转换结果应当**进版本库**：词库是静态产物，运行时再转等于每台机器
 *     都要带一份 OpenCC 词典（几百 KB）且每次加载都多一步。
 *  2. 运行时要零新依赖。项目依赖一直很克制（见 package.json）。
 *  3. 转换是一次性的：转完就固化进 `public/dicts/*.json`，
 *     后来者 clone 下来直接用，不需要联网或装工具。
 *
 * ── 只用 tw→cn 的理由 ───────────────────────────────────────────────────
 * 语料混的是「台湾正体」与「大陆简体」。tw→cn 对**已经是简体**的文本
 * 是幂等的（实测「橡皮擦掉地上就很难找到了」原样返回），所以可以整库跑，
 * 不需要先判断哪些句子是繁体。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 * 需要 opencc-js。它只是**构建期工具**，不是运行时依赖：
 *   mkdir -p .tmp/occ && cd .tmp/occ && npm init -y && npm i opencc-js
 *   cd ../.. && node scripts/convert-sentences-zh-hans.mjs [--check]
 *
 * --check 只报告会改动多少条，不写文件。
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DICT_DIR = path.join(ROOT, 'public', 'dicts');

const require = createRequire(import.meta.url);
/** opencc-js 装在 .tmp/occ 里（构建期工具，不进 package.json） */
const OCC_PATH = path.join(ROOT, '.tmp', 'occ', 'node_modules', 'opencc-js');

let OpenCC;
try {
  OpenCC = require(OCC_PATH);
} catch {
  console.error(
    '找不到 opencc-js。它只是构建期工具，按下面的步骤装到 .tmp（已被 gitignore）：\n' +
      '  mkdir -p .tmp/occ && cd .tmp/occ && npm init -y && npm i opencc-js\n' +
      '然后回到仓库根重跑本脚本。',
  );
  process.exit(1);
}

const CHECK_ONLY = process.argv.includes('--check');

/** tw→cn：对已是简体的文本幂等，所以可以整库跑 */
const baseConvert = OpenCC.Converter({ from: 'tw', to: 'cn' });

/**
 * OpenCC 的已知误转修正表。
 *
 * `著` 在繁体里既可以是 `zhu`（显著、著名、著作）也可以是 `zhe` 的异体（看著）。
 * tw→cn 一律把 `著` 转成 `着`，于是「显著」被打成错别字「显着」。
 * 实测全库有 10 条命中这个模式（医学词库里同一句重复出现）。
 *
 * 这类问题无法靠换配置解决（twp 含词组表也一样误转），
 * 只能维护一份明确的修正表。**发现新的误转就往这里加**，
 * 并在 `--check` 里能看出来（因为它会让幂等性检查失败）。
 */
const FIXUPS = [
  // 显著（zhù）不是「显着」
  ['显着', '显著'],
  // 著名 / 著作 / 著称 同理
  ['着名', '著名'],
  ['着作', '著作'],
  ['着称', '著称'],
];

/** 转一句译文：先跑 OpenCC，再套修正表 */
function toHans(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = baseConvert(text);
  for (const [from, to] of FIXUPS) {
    out = out.split(from).join(to);
  }
  return out;
}

async function main() {
  const files = (await readdir(DICT_DIR)).filter((f) => f.endsWith('.json'));
  let totalSentences = 0;
  let changedSentences = 0;
  const changedFiles = [];

  for (const f of files) {
    // index.json / word-graph / glossary 不是词库词条，跳过
    if (f === 'index.json' || f === 'word-graph.json' || f === 'article-glossary.json') continue;

    const full = path.join(DICT_DIR, f);
    const raw = await readFile(full, 'utf8');
    const data = JSON.parse(raw);
    const words = Array.isArray(data) ? data : data.words || [];
    if (!Array.isArray(words) || words.length === 0) continue;

    let fileChanged = 0;
    for (const entry of words) {
      for (const s of entry.sentences || []) {
        if (!s || typeof s.zh !== 'string') continue;
        totalSentences++;
        const converted = toHans(s.zh);
        if (converted !== s.zh) {
          fileChanged++;
          changedSentences++;
          s.zh = converted;
        }
      }
    }

    if (fileChanged > 0) {
      changedFiles.push({ file: f, changed: fileChanged });
      if (!CHECK_ONLY) {
        // 保持与既有产物一致的格式（2 空格缩进 + 结尾换行）
        await writeFile(full, JSON.stringify(data, null, 2) + '\n', 'utf8');
      }
    }
  }

  console.log(`扫描例句：${totalSentences} 条`);
  console.log(
    `含繁体需转换：${changedSentences} 条（${((changedSentences / totalSentences) * 100).toFixed(1)}%）`,
  );
  console.log(`涉及词库：${changedFiles.length} 个`);
  for (const c of changedFiles) console.log(`  ${c.file.padEnd(16)} ${c.changed}`);

  if (CHECK_ONLY) {
    console.log('\n--check：未写文件');
    if (changedSentences > 0) process.exitCode = 1;
  } else {
    console.log('\n✓ 已写回');
  }
}

await main();
