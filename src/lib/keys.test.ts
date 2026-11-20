/**
 * 快捷键逻辑的单元测试。
 *
 * 这层被抽到 `src/lib/` 就是为了能这样直接测：改键功能一旦有 bug，
 * 症状是「按了没反应」或「打字突然坏掉」，在界面上极难定位。
 */
import { describe, expect, it } from 'vitest';
import {
  SHORTCUT_ACTIONS,
  assignShortcut,
  assignableKeyError,
  formatKeyLabel,
  isDefaultShortcuts,
  matchShortcut,
  normalizeKey,
} from '@/lib/keys';
import { DEFAULT_SHORTCUTS, type ShortcutMap } from '@/types';

describe('normalizeKey', () => {
  it('把浏览器历史别名统一成标准键名', () => {
    expect(normalizeKey('Spacebar')).toBe(' ');
    expect(normalizeKey('Space')).toBe(' ');
    expect(normalizeKey('Esc')).toBe('Escape');
    expect(normalizeKey('Left')).toBe('ArrowLeft');
    expect(normalizeKey('Return')).toBe('Enter');
  });

  it('标准键名原样返回', () => {
    expect(normalizeKey('Tab')).toBe('Tab');
    expect(normalizeKey('F5')).toBe('F5');
    expect(normalizeKey(' ')).toBe(' ');
  });
});

describe('assignableKeyError', () => {
  it('普通字符键不能绑定（会和打字冲突）', () => {
    expect(assignableKeyError('a')).toBeTruthy();
    expect(assignableKeyError('Z')).toBeTruthy();
    expect(assignableKeyError('1')).toBeTruthy();
    expect(assignableKeyError('.')).toBeTruthy();
  });

  it('空格是唯一的字符键例外', () => {
    expect(assignableKeyError(' ')).toBeNull();
  });

  it('修饰键单独按不能绑定', () => {
    expect(assignableKeyError('Shift')).toBeTruthy();
    expect(assignableKeyError('Control')).toBeTruthy();
    expect(assignableKeyError('Alt')).toBeTruthy();
    expect(assignableKeyError('Meta')).toBeTruthy();
    expect(assignableKeyError('CapsLock')).toBeTruthy();
  });

  it('功能键、导航键、退格都可以绑定', () => {
    for (const k of ['Tab', 'Backspace', 'Escape', 'Enter', 'F1', 'F12', 'ArrowUp', 'Delete']) {
      expect(assignableKeyError(k)).toBeNull();
    }
  });

  it('无法识别的键给出明确拒绝', () => {
    expect(assignableKeyError('')).toBeTruthy();
    expect(assignableKeyError('Unidentified')).toBeTruthy();
    expect(assignableKeyError('Process')).toBeTruthy();
  });
});

describe('matchShortcut', () => {
  it('默认配置下四个动作都能命中', () => {
    expect(matchShortcut(DEFAULT_SHORTCUTS, ' ')).toBe('next');
    expect(matchShortcut(DEFAULT_SHORTCUTS, 'Tab')).toBe('replay');
    expect(matchShortcut(DEFAULT_SHORTCUTS, 'Backspace')).toBe('backspace');
    expect(matchShortcut(DEFAULT_SHORTCUTS, 'Escape')).toBe('exit');
  });

  it('未绑定的键返回 null', () => {
    expect(matchShortcut(DEFAULT_SHORTCUTS, 'F9')).toBeNull();
    expect(matchShortcut(DEFAULT_SHORTCUTS, 'a')).toBeNull();
  });

  it('匹配走归一化，旧别名也能触发', () => {
    expect(matchShortcut(DEFAULT_SHORTCUTS, 'Esc')).toBe('exit');
    expect(matchShortcut(DEFAULT_SHORTCUTS, 'Spacebar')).toBe('next');
  });

  it('改键后旧键位失效、新键位生效', () => {
    const map: ShortcutMap = { ...DEFAULT_SHORTCUTS, replay: 'F2' };
    expect(matchShortcut(map, 'F2')).toBe('replay');
    expect(matchShortcut(map, 'Tab')).toBeNull();
  });
});

describe('assignShortcut', () => {
  it('改绑一个动作只动它自己', () => {
    const next = assignShortcut(DEFAULT_SHORTCUTS, 'replay', 'F2');
    expect(next.replay).toBe('F2');
    expect(next.next).toBe(' ');
    expect(next.backspace).toBe('Backspace');
    expect(next.exit).toBe('Escape');
  });

  it('新键已被占用时交换两个动作的键位', () => {
    // 把「下一个」改成 Tab：Tab 原本是「再听一遍」，两者对调
    const next = assignShortcut(DEFAULT_SHORTCUTS, 'next', 'Tab');
    expect(next.next).toBe('Tab');
    expect(next.replay).toBe(' ');
  });

  it('交换后映射仍然一键一动作，不产生重复', () => {
    let map: ShortcutMap = { ...DEFAULT_SHORTCUTS };
    // 连着改几次，模拟用户来回折腾
    map = assignShortcut(map, 'next', 'F1');
    map = assignShortcut(map, 'exit', 'F1');
    map = assignShortcut(map, 'backspace', 'Tab');
    const keys = SHORTCUT_ACTIONS.map((a) => normalizeKey(map[a]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('不修改原对象（避免 store 里被就地改坏）', () => {
    const original: ShortcutMap = { ...DEFAULT_SHORTCUTS };
    const next = assignShortcut(original, 'next', 'F3');
    expect(next).not.toBe(original);
    expect(original.next).toBe(' ');
  });
});

describe('formatKeyLabel', () => {
  it('常见键给出紧凑写法', () => {
    expect(formatKeyLabel(' ')).toBe('Space');
    expect(formatKeyLabel('Backspace')).toBe('⌫');
    expect(formatKeyLabel('Escape')).toBe('Esc');
    expect(formatKeyLabel('ArrowUp')).toBe('↑');
    expect(formatKeyLabel('Delete')).toBe('Del');
  });

  it('功能键与单字符键可读', () => {
    expect(formatKeyLabel('F7')).toBe('F7');
    expect(formatKeyLabel('Tab')).toBe('Tab');
    expect(formatKeyLabel('a')).toBe('A');
  });
});

describe('isDefaultShortcuts', () => {
  it('默认配置判定为真', () => {
    expect(isDefaultShortcuts({ ...DEFAULT_SHORTCUTS }, DEFAULT_SHORTCUTS)).toBe(true);
  });

  it('任一动作不同即判定为假', () => {
    expect(isDefaultShortcuts({ ...DEFAULT_SHORTCUTS, replay: 'F2' }, DEFAULT_SHORTCUTS)).toBe(
      false,
    );
  });

  it('只是别名写法不同不算改动', () => {
    const aliased: ShortcutMap = { ...DEFAULT_SHORTCUTS, exit: 'Esc' };
    expect(isDefaultShortcuts(aliased, DEFAULT_SHORTCUTS)).toBe(true);
  });
});
