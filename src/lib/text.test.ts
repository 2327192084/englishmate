import { describe, expect, it } from 'vitest';
import { normalizeForCompare, tokenizeForCompare } from './text';
import { ARTICLES } from '@/data/articles';

describe('文本归一化', () => {
  it('省略号展开成三个点（键盘可以打出来）', () => {
    expect(normalizeForCompare('Liberty…')).toBe('Liberty...');
  });

  it('弯撇号归一成直引号', () => {
    expect(normalizeForCompare('don’t')).toBe("don't");
  });

  it('弯双引号归一', () => {
    expect(normalizeForCompare('“hello”')).toBe('"hello"');
  });

  it('各种破折号归一成连字符', () => {
    expect(normalizeForCompare('well—known')).toBe('well-known');
    expect(normalizeForCompare('well–known')).toBe('well-known');
  });

  it('不间断空格归一成普通空格', () => {
    expect(normalizeForCompare('a\u00A0b')).toBe('a b');
  });

  it('压缩多余空白', () => {
    expect(normalizeForCompare('  a   b  ')).toBe('a b');
  });

  it('不动普通 ASCII', () => {
    expect(normalizeForCompare('Four score and seven')).toBe('Four score and seven');
  });

  it('切词结果稳定', () => {
    expect(tokenizeForCompare('a  b…c')).toEqual(['a', 'b...c']);
  });
});

describe('文章语料可打字性', () => {
  /**
   * 回归测试：语料里可以有印刷字符，但用户必须能用普通键盘打对。
   * 归一化之后，任何句子都不该再包含无法输入的字符。
   */
  it('每一句归一化后只剩键盘可输入的 ASCII', () => {
    for (const article of ARTICLES) {
      for (const [i, s] of article.sentences.entries()) {
        const normalized = normalizeForCompare(s.en);
        expect(
          /^[\x20-\x7E]*$/.test(normalized),
          `${article.id} 第 ${i + 1} 句含非 ASCII：${JSON.stringify(s.en)}`,
        ).toBe(true);
      }
    }
  });

  it('归一化是幂等的', () => {
    for (const article of ARTICLES) {
      for (const s of article.sentences) {
        const once = normalizeForCompare(s.en);
        expect(normalizeForCompare(once)).toBe(once);
      }
    }
  });

  it('文章字段齐全且符合约定', () => {
    expect(ARTICLES.length).toBeGreaterThanOrEqual(6);
    const levels = new Set(['CET-4', 'CET-6', '考研', '雅思']);
    for (const a of ARTICLES) {
      expect(a.id).toBeTruthy();
      expect(a.title).toBeTruthy();
      expect(a.titleZh).toBeTruthy();
      expect(levels.has(a.level), `非法 level: ${a.level}`).toBe(true);
      expect(a.source).toBeTruthy();
      expect(a.sentences.length).toBeGreaterThanOrEqual(4);
      for (const s of a.sentences) {
        expect(s.en.trim().length).toBeGreaterThan(0);
        expect(s.zh.trim().length).toBeGreaterThan(0);
        expect(s.en.length).toBeLessThanOrEqual(140);
      }
    }
  });

  it('文章 id 不重复', () => {
    const ids = ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
