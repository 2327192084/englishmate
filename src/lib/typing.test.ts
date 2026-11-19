import { describe, expect, it } from 'vitest';
import {
  initTyping,
  isComplete,
  typeBackspace,
  typeChar,
  elapsedMs,
  hadMistake,
  normalizeChar,
  isWrongAt,
  noUnfixedErrors,
  sameChar,
  isNonLatinChar,
} from './typing';
import { computeAccuracy, computeWpm } from './stats';

describe('打字引擎', () => {
  it('逐字符打对会推进光标', () => {
    let s = initTyping('cat');
    s = typeChar(s, 'c', 1000);
    expect(s.cursor).toBe(1);
    s = typeChar(s, 'a', 1100);
    s = typeChar(s, 't', 1200);
    expect(s.cursor).toBe(3);
    expect(isComplete(s)).toBe(true);
    expect(s.finishedAt).toBe(1200);
  });

  it('打错不推进光标，但计入错误与击键', () => {
    let s = initTyping('cat');
    s = typeChar(s, 'x', 1000);
    expect(s.cursor).toBe(0);
    expect(s.errors).toBe(1);
    expect(s.keystrokes).toBe(1);
    expect(s.lastError).toBe(true);
    expect(hadMistake(s)).toBe(true);
    // 改对后错误计数不回退 —— 错误已经发生
    s = typeChar(s, 'c', 1100);
    expect(s.cursor).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.lastError).toBe(false);
  });

  it('大小写不敏感：小写打大写的词也算对', () => {
    let s = initTyping('Cat');
    s = typeChar(s, 'c', 1000);
    expect(s.cursor).toBe(1);
    expect(s.errors).toBe(0);
  });

  it('大小写不敏感：大写打小写的词也算对', () => {
    let s = initTyping('cat');
    s = typeChar(s, 'C', 1000);
    expect(s.cursor).toBe(1);
    expect(s.errors).toBe(0);
  });

  it('CapsLock 全大写能打完整个词', () => {
    let s = initTyping('english');
    for (const ch of 'ENGLISH') s = typeChar(s, ch, 1000);
    expect(isComplete(s)).toBe(true);
    expect(s.errors).toBe(0);
  });

  it('大小写混着打也算对', () => {
    let s = initTyping('Liberty');
    for (const ch of 'lIbErTy') s = typeChar(s, ch, 1000);
    expect(isComplete(s)).toBe(true);
    expect(s.errors).toBe(0);
  });

  it('全角字符归一后判对（中文输入法常见）', () => {
    let s = initTyping('hello');
    // ｈｅｌｌｏ 全角
    for (const ch of 'ｈｅｌｌｏ') s = typeChar(s, ch, 1000);
    expect(isComplete(s)).toBe(true);
    expect(s.errors).toBe(0);
  });

  it('打错一个字母仍然判错（不能因放宽大小写而变宽松）', () => {
    let s = initTyping('Cat');
    s = typeChar(s, 'k', 1000);
    expect(s.cursor).toBe(0);
    expect(s.errors).toBe(1);
  });

  it('完成后再输入不改变状态', () => {
    let s = initTyping('a');
    s = typeChar(s, 'a', 1000);
    const done = s;
    s = typeChar(s, 'b', 1100);
    expect(s).toBe(done);
  });

  it('没有目标串时永远不会完成', () => {
    const s = initTyping('');
    expect(isComplete(s)).toBe(false);
    expect(typeChar(s, 'a', 1000)).toBe(s);
  });

  it('退格可以回退到 0，但不会变成负数', () => {
    let s = initTyping('cat');
    s = typeChar(s, 'c', 1000);
    s = typeBackspace(s);
    expect(s.cursor).toBe(0);
    s = typeBackspace(s);
    expect(s.cursor).toBe(0);
  });

  it('完成后不能退格', () => {
    let s = initTyping('a');
    s = typeChar(s, 'a', 1000);
    expect(typeBackspace(s)).toBe(s);
  });

  it('以首次击键作为开始时间', () => {
    let s = initTyping('ab');
    s = typeChar(s, 'a', 5000);
    expect(s.startedAt).toBe(5000);
    expect(elapsedMs(s, 6000)).toBe(1000);
  });

  it('未开始计时时 elapsed 为 0', () => {
    const s = initTyping('abc');
    expect(elapsedMs(s, 9999)).toBe(0);
  });

  it('归一化花引号与破折号', () => {
    expect(normalizeChar('’')).toBe("'");
    expect(normalizeChar('“')).toBe('"');
    expect(normalizeChar('—')).toBe('-');
  });

  it('全角 ASCII 归一成半角', () => {
    expect(normalizeChar('ａ')).toBe('a');
    expect(normalizeChar('Ｚ')).toBe('Z');
    expect(normalizeChar('１')).toBe('1');
    expect(normalizeChar('　')).toBe(' ');
  });

  it('sameChar：大小写、全角、弯引号都算相同', () => {
    expect(sameChar('A', 'a')).toBe(true);
    expect(sameChar('ａ', 'a')).toBe(true);
    expect(sameChar('’', "'")).toBe(true);
    expect(sameChar('a', 'b')).toBe(false);
  });
});

describe('非严格模式（strictCorrection 关闭）', () => {
  it('打错会占位前进，并记录错误位置', () => {
    let s = initTyping('cat');
    s = typeChar(s, 'x', 1000, false);
    expect(s.cursor).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.wrongAt).toEqual([0]);
    expect(isWrongAt(s, 0)).toBe(true);
  });

  it('打满全部字符即算完成', () => {
    let s = initTyping('ab');
    s = typeChar(s, 'x', 1000, false);
    s = typeChar(s, 'b', 1100, false);
    expect(isComplete(s)).toBe(true);
    expect(s.finishedAt).toBe(1100);
  });

  it('有未修正的错字时不算干净通过', () => {
    let s = initTyping('ab');
    s = typeChar(s, 'x', 1000, false);
    s = typeChar(s, 'b', 1100, false);
    expect(isComplete(s)).toBe(true);
    expect(noUnfixedErrors(s)).toBe(false);
  });

  it('打满后仍可退格改正遗留错字，改完算干净通过', () => {
    let s = initTyping('ab');
    s = typeChar(s, 'x', 1000, false);
    s = typeChar(s, 'b', 1100, false);
    expect(isComplete(s)).toBe(true);

    // 退回到错字位置：必须能"重开"这个词，否则非严格模式无法补救
    s = typeBackspace(s);
    expect(s.cursor).toBe(1);
    s = typeBackspace(s);
    expect(s.cursor).toBe(0);
    expect(s.wrongAt).toEqual([]);
    expect(isComplete(s)).toBe(false);

    s = typeChar(s, 'a', 1200, false);
    s = typeChar(s, 'b', 1300, false);
    expect(noUnfixedErrors(s)).toBe(true);
    expect(isComplete(s)).toBe(true);
    expect(s.errors).toBe(1); // 错误发生过，计数不回退
  });

  it('严格模式不前进；同样输入在非严格模式前进', () => {
    const strict = typeChar(initTyping('cat'), 'x', 1000, true);
    const loose = typeChar(initTyping('cat'), 'x', 1000, false);
    expect(strict.cursor).toBe(0);
    expect(loose.cursor).toBe(1);
  });

  it('默认参数就是严格模式', () => {
    const s = typeChar(initTyping('cat'), 'x', 1000);
    expect(s.cursor).toBe(0);
    expect(s.wrongAt).toEqual([]);
  });
});

describe('WPM 与正确率', () => {
  it('WPM 按 5 字符为 1 词计算', () => {
    // 50 字符 / 5 = 10 词，用时 60000ms = 1 分钟 → 10 WPM
    expect(computeWpm(50, 60_000)).toBe(10);
    // 100 字符 / 5 = 20 词，30 秒 = 0.5 分钟 → 40 WPM
    expect(computeWpm(100, 30_000)).toBe(40);
  });

  it('WPM 分母为 0 时返回 0', () => {
    expect(computeWpm(100, 0)).toBe(0);
    expect(computeWpm(100, -5)).toBe(0);
  });

  it('正确率分母为 0 时视作 100%', () => {
    expect(computeAccuracy(0, 0)).toBe(1);
  });

  it('正确率是正确击键 / 总击键', () => {
    expect(computeAccuracy(90, 100)).toBe(0.9);
    expect(computeAccuracy(100, 100)).toBe(1);
  });

  describe('打错时的可见反馈', () => {
    it('记录用户实际按错的字符', () => {
      let s = initTyping('cat');
      s = typeChar(s, 'x', 1000);
      expect(s.lastWrongChar).toBe('x');
      expect(s.lastError).toBe(true);
    });

    it('每次打错都递增 errorSeq，便于重放动画', () => {
      let s = initTyping('cat');
      s = typeChar(s, 'x', 1000);
      expect(s.errorSeq).toBe(1);
      s = typeChar(s, 'y', 1100); // 再错一次，同一个位置
      expect(s.errorSeq).toBe(2);
      expect(s.lastWrongChar).toBe('y'); // 显示最新的错字
    });

    it('打对后清掉错误提示', () => {
      let s = initTyping('cat');
      s = typeChar(s, 'x', 1000);
      s = typeChar(s, 'c', 1100);
      expect(s.lastWrongChar).toBeNull();
      expect(s.lastError).toBe(false);
    });

    it('退格也清掉错误提示（用户开始改正了）', () => {
      let s = initTyping('cat');
      s = typeChar(s, 'c', 1000);
      s = typeChar(s, 'x', 1100);
      s = typeBackspace(s);
      expect(s.lastWrongChar).toBeNull();
    });

    it('非严格模式同样记录错字与序号', () => {
      let s = initTyping('ab');
      s = typeChar(s, 'x', 1000, false);
      expect(s.lastWrongChar).toBe('x');
      expect(s.errorSeq).toBe(1);
      expect(s.wrongAt).toEqual([0]);
    });

    it('错误次数累积但提示只显示当前错字', () => {
      let s = initTyping('abc');
      s = typeChar(s, 'x', 1000);
      s = typeChar(s, 'y', 1100);
      expect(s.errors).toBe(2);
      expect(s.lastWrongChar).toBe('y');
    });
  });

  describe('非英文输入法识别', () => {
    it('中文字符算非拉丁', () => {
      expect(isNonLatinChar('中')).toBe(true);
      expect(isNonLatinChar('你')).toBe(true);
    });

    it('日文与韩文算非拉丁', () => {
      expect(isNonLatinChar('あ')).toBe(true);
      expect(isNonLatinChar('한')).toBe(true);
    });

    it('英文与数字不算', () => {
      expect(isNonLatinChar('a')).toBe(false);
      expect(isNonLatinChar('Z')).toBe(false);
      expect(isNonLatinChar('1')).toBe(false);
      expect(isNonLatinChar(' ')).toBe(false);
    });

    it('全角 ASCII 不算（那是全角模式，可归一处理）', () => {
      expect(isNonLatinChar('ａ')).toBe(false);
      expect(isNonLatinChar('Ｚ')).toBe(false);
    });

    it('常见全角标点不算', () => {
      expect(isNonLatinChar('，')).toBe(false);
      expect(isNonLatinChar('。')).toBe(false);
    });

    it('空字符不算', () => {
      expect(isNonLatinChar('')).toBe(false);
    });
  });
});
