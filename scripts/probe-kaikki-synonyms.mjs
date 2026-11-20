/**
 * 探测 kaikki.org 能否作为近义词数据源。
 *
 * 背景：我们的 `synos`（近义词）字段 0% 覆盖，是当前最大的内容空缺。
 * ECDICT 没有近义词列，但 kaikki（Wiktionary 结构化提取）有。
 *
 * 要验证三件事：
 *  1. 可达性（之前测过指数可用）
 *  2. 同义词的**数量与质量**（是否会抓到冷僻义项）
 *  3. 耗时（决定能否全量跑）
 */
const WORDS = ['large', 'happy', 'quick', 'begin', 'difficult', 'important', 'reduce', 'obvious'];

function kaikkiUrl(word) {
  const w = word.toLowerCase();
  return `https://kaikki.org/dictionary/English/meaning/${w[0]}/${w.slice(0, 2)}/${w}.html`;
}

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
}

/** 从页面里抽出所有 synonyms[].word */
function extractSynonyms(html) {
  const un = unescapeHtml(html);
  const syns = new Set();
  const re = /"synonyms":\s*\[([\s\S]{0,800}?)\]/g;
  let m;
  while ((m = re.exec(un)) !== null) {
    const words = m[1].match(/"word":\s*"([^"]+)"/g) || [];
    for (const x of words) {
      const v = x.match(/"word":\s*"([^"]+)"/);
      if (v) syns.add(v[1]);
    }
  }
  return [...syns];
}

async function main() {
  let ok = 0;
  let withSyn = 0;
  let totalSyns = 0;
  const started = Date.now();

  for (const w of WORDS) {
    try {
      const res = await fetch(kaikkiUrl(w));
      if (!res.ok) {
        console.log(`  ${w.padEnd(12)} HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      ok++;
      const syns = extractSynonyms(html);
      totalSyns += syns.length;
      if (syns.length > 0) withSyn++;
      console.log(
        `  ${w.padEnd(12)} ${(html.length / 1024).toFixed(0)}KB  同义词 ${syns.length}: ${syns.slice(0, 5).join(', ')}`,
      );
    } catch (e) {
      console.log(`  ${w.padEnd(12)} ERR ${e.message.slice(0, 40)}`);
    }
    // 温和限速
    await new Promise((r) => setTimeout(r, 600));
  }

  const elapsed = (Date.now() - started) / 1000;
  const perWord = elapsed / WORDS.length;
  console.log('');
  console.log('■ 结论');
  console.log(`  可达: ${ok}/${WORDS.length}`);
  console.log(`  有同义词: ${withSyn}/${ok}`);
  console.log(`  平均: ${(totalSyns / Math.max(1, ok)).toFixed(1)} 个/词`);
  console.log(`  单次耗时: ${perWord.toFixed(2)}s`);
  console.log(`  全量 18,716 词估算: ${((perWord * 18716) / 3600).toFixed(1)} 小时`);
  console.log('');
  console.log('  ⚠️ 同义词是**义项级**的：同一个词不同义项有不同的同义词，');
  console.log('     直接合并会混入「不是这个意思」的词（如 adapt 的 proportion）。');
}

main();
