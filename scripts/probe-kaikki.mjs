/**
 * 探测 kaikki.org 能否作为"英文例句"补充源。
 *
 * 背景：Tatoeba 的英中对照只有 7.8 万对，实测只能覆盖 60% 的词条。
 * kaikki（Wiktionary 结构化提取）例句覆盖率高，但**没有中文译文**。
 * 这里先验证：能否稳定取到、例句质量如何、单页体积与耗时。
 */
import { writeFile, mkdir } from 'node:fs/promises';

const WORDS = ['elect', 'hale', 'supplant', 'abrupt', 'predispose', 'spontaneous', 'belligerent'];

/** 词形 → kaikki 的路径分片规则：/dictionary/English/meaning/<首字母>/<前两字母>/<word>.html */
function kaikkiUrl(word) {
  const w = word.toLowerCase();
  const a = w[0];
  const b = w.slice(0, 2);
  return `https://kaikki.org/dictionary/English/meaning/${a}/${b}/${w}.html`;
}

function unescapeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** 从页面里抽出 examples[].text */
function extractExamples(html) {
  const un = unescapeHtml(html);
  const out = [];
  // JSON 里 "text": "..." 可能是转义过的
  const re = /"text":\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(un)) !== null) {
    let t = m[1];
    try {
      // 处理 \\\" 这类转义
      t = JSON.parse('"' + t + '"');
    } catch {
      /* 保留原样 */
    }
    t = t.trim();
    if (t.length < 15 || t.length > 120) continue;
    // 过滤掉明显是语法标注/非句子内容
    if (/^[A-Z]{2,}$/.test(t)) continue;
    if (!/[a-z]/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= 3) break;
  }
  return out;
}

async function main() {
  await mkdir('.tmp', { recursive: true });
  console.log('■ 探测 kaikki.org\n');

  const report = [];
  for (const w of WORDS) {
    const url = kaikkiUrl(w);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'EnglishMate-build/0.1 (dictionary enrichment)' },
      });
      const ms = Date.now() - t0;
      if (!res.ok) {
        console.log(`  ${w.padEnd(14)} HTTP ${res.status}  (${ms}ms)`);
        report.push({ word: w, ok: false, status: res.status });
        continue;
      }
      const html = await res.text();
      const examples = extractExamples(html);
      console.log(
        `  ${w.padEnd(14)} ${(html.length / 1024).toFixed(0)}KB  ${ms}ms  例句 ${examples.length}`,
      );
      if (examples.length) console.log(`      例：${examples[0].slice(0, 90)}`);
      report.push({ word: w, ok: true, kb: Math.round(html.length / 1024), ms, examples });
    } catch (e) {
      console.log(`  ${w.padEnd(14)} ERR ${e.message}`);
      report.push({ word: w, ok: false, error: e.message });
    }
    // 温和限速，别把对方打疼
    await new Promise((r) => setTimeout(r, 800));
  }

  await writeFile('.tmp/kaikki-probe.json', JSON.stringify(report, null, 2));

  const ok = report.filter((r) => r.ok);
  const withEx = ok.filter((r) => r.examples?.length);
  const avgKb = ok.length ? Math.round(ok.reduce((s, r) => s + r.kb, 0) / ok.length) : 0;
  const avgMs = ok.length ? Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length) : 0;

  console.log('\n■ 结论');
  console.log(`  可达: ${ok.length}/${report.length}`);
  console.log(`  有例句: ${withEx.length}/${ok.length}`);
  console.log(`  平均体积: ${avgKb}KB | 平均耗时: ${avgMs}ms`);
  console.log(
    `  全量 13987 词估算: ${((avgKb * 13987) / 1024 / 1024).toFixed(1)}GB / ${((avgMs * 13987) / 1000 / 3600).toFixed(1)}小时`,
  );
  console.log('  注意：kaikki 例句无中文译文');
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
