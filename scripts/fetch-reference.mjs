/**
 * 抓 TypeWords 的关键源码文件，用于对照功能差距。
 * 只读分析，不复制代码（对方是 GPL-3.0，我们 MIT，不能混许可）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const REPO = 'zyronon/TypeWords';
const BRANCH = 'master';
const FILES = [
  'app/core/composables/practice-words/practice-flow-config.ts',
  'app/core/composables/practice-words/practice-question.ts',
  'app/core/composables/practice-words/study-task.ts',
  'app/core/composables/practice-words/usePracticeDisplayPolicy.ts',
  'app/core/composables/practice-words/usePracticeIdleTimer.ts',
  'app/core/hooks/fsrs.ts',
  'app/core/hooks/useWordLookup.ts',
  'app/core/hooks/translate.ts',
  'app/core/utils/word-test.ts',
  'app/core/types/enum.ts',
];

mkdirSync('.tmp/tw', { recursive: true });

function b64decode(s) {
  return Buffer.from(s.replace(/\n/g, ''), 'base64').toString('utf8');
}

for (const f of FILES) {
  try {
    const url = `https://api.github.com/repos/${REPO}/contents/${encodeURI(f)}?ref=${BRANCH}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'englishmate-analysis' } });
    if (!res.ok) {
      console.log('SKIP', f, res.status);
      continue;
    }
    const j = await res.json();
    const txt = b64decode(j.content);
    const out = '.tmp/tw/' + f.split('/').pop();
    writeFileSync(out, txt);
    console.log('OK  ', f, '->', txt.length, 'chars');
  } catch (e) {
    console.log('ERR ', f, e.message);
  }
}
