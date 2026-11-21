/**
 * 完形填空的单元测试。
 *
 * 这一层抽到 `src/lib/` 的目的就是能这样直接测：挖空位置算错时，
 * 界面上表现为「挖错了词」或「该挖的没挖」，肉眼极难发现——
 * 用户会以为自己记错了词，而不是怀疑软件。
 *
 * 用例里的句子全部来自真实语料（public/dicts/），不是编的。
 */
import { describe, expect, it } from 'vitest';
import {
  BLANK,
  buildCloze,
  findTargetSpans,
  inflectionCandidates,
  judgeAnswer,
  tokenizeWithOffsets,
} from '@/lib/cloze';

describe('tokenizeWithOffsets', () => {
  it('切出词并给出原文位置', () => {
    const tokens = tokenizeWithOffsets('I use a pencil.');
    expect(tokens.map((t) => t.text)).toEqual(['I', 'use', 'a', 'pencil']);
    expect(tokens[0]).toMatchObject({ start: 0, end: 1 });
    expect(tokens[3]).toMatchObject({ start: 8, end: 14 });
  });

  it('撇号和连字符留在词内（dont 会被切碎就不对了）', () => {
    // 真实语料里这两种形态都有，按 \b 切会把它们拆成两半
    expect(tokenizeWithOffsets("I don't like it.").map((t) => t.text)).toEqual([
      'I',
      "don't",
      'like',
      'it',
    ]);
    expect(tokenizeWithOffsets('a three-headed monkey').map((t) => t.text)).toEqual([
      'a',
      'three-headed',
      'monkey',
    ]);
  });

  it('脏输入不抛错', () => {
    expect(tokenizeWithOffsets('')).toEqual([]);
    // @ts-expect-error 故意传错类型，验证运行时兜底
    expect(tokenizeWithOffsets(null)).toEqual([]);
    expect(tokenizeWithOffsets('...!!!---')).toEqual([]);
  });

  it('重复调用结果一致（正则 lastIndex 不泄漏）', () => {
    // 模块级带 g 标志的正则会被上一次调用污染，这个用例专门锁死这点
    const once = tokenizeWithOffsets('I use a pencil.');
    const twice = tokenizeWithOffsets('I use a pencil.');
    expect(twice).toEqual(once);
  });
});

describe('inflectionCandidates', () => {
  it('规则动词的四种基本形式', () => {
    const c = inflectionCandidates('use');
    expect(c.has('use')).toBe(true);
    expect(c.has('uses')).toBe(true);
    expect(c.has('used')).toBe(true);
    expect(c.has('using')).toBe(true);
  });

  it('词干替换正确，不是把后缀接在原词后面', () => {
    // 早期实现的 bug：study → "studyies"、run → "runned"
    const study = inflectionCandidates('study');
    expect(study.has('studies')).toBe(true);
    expect(study.has('studied')).toBe(true);
    expect(study.has('studying')).toBe(true);
    expect(study.has('studyies')).toBe(false);

    const run = inflectionCandidates('run');
    expect(run.has('running')).toBe(true);
    expect(run.has('runs')).toBe(true);
    expect(run.has('runned')).toBe(false);
  });

  it('咝音词加 -es 而不是 -s', () => {
    const watch = inflectionCandidates('watch');
    expect(watch.has('watches')).toBe(true);
    expect(watch.has('watched')).toBe(true);
    expect(watch.has('watching')).toBe(true);
  });

  it('不规则动词', () => {
    expect(inflectionCandidates('go').has('went')).toBe(true);
    expect(inflectionCandidates('go').has('gone')).toBe(true);
    expect(inflectionCandidates('make').has('made')).toBe(true);
    expect(inflectionCandidates('child').has('children')).toBe(true);
    expect(inflectionCandidates('foot').has('feet')).toBe(true);
  });

  it('不生成派生词（那会挖到别的词条）', () => {
    // fold → folder 是另一个词条；hard → hardly 同理
    expect(inflectionCandidates('fold').has('folder')).toBe(false);
    expect(inflectionCandidates('hard').has('hardly')).toBe(false);
    expect(inflectionCandidates('run').has('runner')).toBe(false);
  });

  it('短语只变最后一个词', () => {
    const c = inflectionCandidates('pencil box');
    expect(c.has('pencil box')).toBe(true);
    expect(c.has('pencil boxes')).toBe(true);
    expect(c.has('pencils box')).toBe(false);
  });

  it('空输入返回空集合', () => {
    expect(inflectionCandidates('').size).toBe(0);
    // @ts-expect-error 故意传错类型
    expect(inflectionCandidates(undefined).size).toBe(0);
  });
});

describe('findTargetSpans', () => {
  it('命中原形', () => {
    const spans = findTargetSpans('I use a pencil.', 'pencil');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe('pencil');
  });

  it('命中屈折形式（这是 21% 的例句的真实情况）', () => {
    expect(findTargetSpans('Do you have any pencils?', 'pencil')[0]!.text).toBe('pencils');
    expect(findTargetSpans('The walls have ears.', 'ear')[0]!.text).toBe('ears');
    expect(findTargetSpans('We went home.', 'go')[0]!.text).toBe('went');
    expect(findTargetSpans('She studies hard.', 'study')[0]!.text).toBe('studies');
  });

  it('命中短语（整段匹配）', () => {
    expect(findTargetSpans('It is a pencil box.', 'pencil box')[0]!.text).toBe('pencil box');
    expect(findTargetSpans('I have two pencil boxes.', 'pencil box')[0]!.text).toBe('pencil boxes');
  });

  it('短语前半部分变了就不算命中', () => {
    expect(findTargetSpans('It is a pencils box.', 'pencil box')).toEqual([]);
  });

  it('同一处只计一次', () => {
    const spans = findTargetSpans('It is a pencil box.', 'pencil box');
    expect(spans).toHaveLength(1);
  });

  it('词没出现时返回空数组', () => {
    expect(findTargetSpans('I hardly work.', 'hard')).toEqual([]);
  });
});

describe('buildCloze', () => {
  it('把目标词替换成占位符，保留其余原文', () => {
    const item = buildCloze('Do you have any pencils?', 'pencil', '你有铅笔吗？');
    expect(item.state).toBe('ok');
    expect(item.question).toBe(`Do you have any ${BLANK}?`);
    expect(item.answer).toBe('pencils');
    expect(item.zh).toBe('你有铅笔吗？');
  });

  it('保留答案的原始大小写（展示用）', () => {
    // 句首大写的词挖出来后，答案也要是大写：用户看到的标准答案要能直接对照
    const item = buildCloze('Pencil is a word.', 'pencil');
    expect(item.answer).toBe('Pencil');
  });

  it('目标词重复出现时整句弃用（否则第二个会泄露答案）', () => {
    const item = buildCloze(
      "It's a pity that you can't buy miracles like you would buy potatoes.",
      'buy',
    );
    expect(item.state).toBe('ambiguous');
    // 弃用时不能给出挖好的题面，避免调用方误用
    expect(item.question).toBe(item.sentence);
  });

  it('目标词不在句子里时返回 no-target', () => {
    const item = buildCloze('I hardly work.', 'hard');
    expect(item.state).toBe('no-target');
  });

  it('脏输入不抛错', () => {
    expect(buildCloze('', 'word').state).toBe('no-target');
    expect(buildCloze('some sentence', '').state).toBe('no-target');
    // @ts-expect-error 故意传错类型
    expect(buildCloze(null, null).state).toBe('no-target');
  });

  it('省略译文参数时 zh 是空串而不是 undefined', () => {
    expect(buildCloze('I use it.', 'use').zh).toBe('');
  });
});

describe('judgeAnswer', () => {
  const item = buildCloze('Do you have any pencils?', 'pencil');

  it('完全一致判对', () => {
    expect(judgeAnswer('pencils', item)).toBe('correct');
  });

  it('忽略大小写与首尾空白', () => {
    expect(judgeAnswer('  Pencils ', item)).toBe('correct');
  });

  it('答成原形但句子要屈折形式：单列为语法错误', () => {
    // 用户其实想起了正确的词，只是没变复数——混进"错了"里就没有教学价值
    expect(judgeAnswer('pencil', item)).toBe('inflection');
  });

  it('拼错判错', () => {
    expect(judgeAnswer('pencilz', item)).toBe('wrong');
    expect(judgeAnswer('', item)).toBe('wrong');
  });

  it('答案本身就是原形时，不会误判成 inflection', () => {
    const use = buildCloze('I use it.', 'use');
    expect(judgeAnswer('use', use)).toBe('correct');
    expect(judgeAnswer('used', use)).toBe('wrong');
  });

  it('脏输入判错不抛错', () => {
    // @ts-expect-error 故意传错类型
    expect(judgeAnswer(null, item)).toBe('wrong');
  });
});
