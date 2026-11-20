/**
 * 快捷键解析 —— 纯逻辑，零 React 依赖（`src/lib/` 的硬规矩）。
 *
 * 键名一律沿用 `KeyboardEvent.key` 的写法（' ' / 'Tab' / 'Escape' / 'ArrowUp' …），
 * 不自己发明一套映射表：浏览器已经给了标准值，存进设置里用户导出备份后
 * 也能直接看懂，不会出现“我存的到底是什么”的问题。
 *
 * 为什么不把键位做成真正的组合键系统（Ctrl+Shift+X 之类）：
 * 这些快捷键全部发生在“双手正在打字”的流里，组合键要另一只手去够修饰键，
 * 反而打断节奏。所以只允许单键，且拒绝可打印字符（见 assignableKeyError）。
 */
import type { ShortcutAction, ShortcutMap } from '@/types';

/** 展示顺序，也是"同键冲突时谁被先判定"以外的纯 UI 顺序 */
export const SHORTCUT_ACTIONS: ShortcutAction[] = ['next', 'replay', 'backspace', 'exit'];

export const SHORTCUT_LABELS: Record<ShortcutAction, { label: string; hint: string }> = {
  next: { label: '提交 / 下一个', hint: '打完一个词进入下一个' },
  replay: { label: '再听一遍', hint: '重新朗读当前单词，练听写时最常用' },
  backspace: { label: '退格', hint: '退回一个字符（错误计数不回退）' },
  exit: { label: '退出练习', hint: '会二次确认，完成的词保留记录' },
};

/**
 * 浏览器历史遗留的别名统一到标准写法。
 *
 * 旧版 Firefox / IE 给的是 'Esc' / 'Left' / 'Spacebar' 这类值，
 * 用户从旧备份导入的配置可能带着它们；不归一化就会“看起来绑上了却按不动”。
 */
const KEY_ALIASES: Record<string, string> = {
  Spacebar: ' ',
  Space: ' ',
  Esc: 'Escape',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Del: 'Delete',
  Return: 'Enter',
};

export function normalizeKey(key: string): string {
  return KEY_ALIASES[key] ?? key;
}

/**
 * 只按修饰键、按下去不产生任何字符的键。
 * 录键时它们是“过程”不是“结果”：用户按 Ctrl+A 时先收到 Control，不能把它存下来。
 */
const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'OS',
  'AltGraph',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'Symbol',
  'SymbolLock',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/**
 * 判断一个键能否绑定，返回中文错误原因（能绑定则返回 null）。
 *
 * 核心限制：**拒绝可打印字符**。
 * 这些快捷键在输入流里被判定，如果允许绑成 'a'，那用户打任何含 a 的词
 * 都会触发退格/退出——功能直接坏掉，而且用户很难联想到是快捷键导致的。
 * 空格是唯一例外：它本来就是“提交”的默认键，输入时也只在一个词内部出现。
 */
export function assignableKeyError(rawKey: string): string | null {
  const key = normalizeKey(rawKey);
  if (!key || key === 'Unidentified' || key === 'Process' || key === 'Dead') {
    return '这个键无法识别，换一个试试';
  }
  if (MODIFIER_KEYS.has(key)) {
    return '不能只用修饰键，请带上真正的按键';
  }
  if (key.length === 1 && key !== ' ') {
    return '不能用普通字符键，会和打字冲突';
  }
  return null;
}

/**
 * 按当前配置把按键解析成动作；没有绑定则返回 null。
 *
 * 用一个函数集中判定，而不是在 onKeyDown 里写四个 if：
 * 用户改键后可能出现“两个动作想抢同一个键”的中间状态（导入旧备份、
 * 手工编辑 JSON），集中判定才能保证只会有一个赢家，且顺序是确定的。
 */
export function matchShortcut(map: ShortcutMap, rawKey: string): ShortcutAction | null {
  const key = normalizeKey(rawKey);
  if (!key) return null;
  for (const action of SHORTCUT_ACTIONS) {
    if (normalizeKey(map[action]) === key) return action;
  }
  return null;
}

/**
 * 把某个动作改绑到新键，返回新的映射。
 *
 * 新键已经被别的动作占用时**交换**两个动作的键位，而不是报错拒绝：
 * 改键的常见场景就是“这两个我不顺手，想对调”，让用户先改一个再改另一个
 * 是两步操作；直接交换一步到位，而且映射永远保持「一键一动作」的合法状态。
 */
export function assignShortcut(
  map: ShortcutMap,
  action: ShortcutAction,
  rawKey: string,
): ShortcutMap {
  const key = normalizeKey(rawKey);
  const prevKey = map[action];
  const next: ShortcutMap = { ...map };
  for (const other of SHORTCUT_ACTIONS) {
    if (other !== action && normalizeKey(next[other]) === key) next[other] = prevKey;
  }
  next[action] = key;
  return next;
}

/** 键位的人类可读写法：' ' → Space、'Backspace' → ⌫ … */
export function formatKeyLabel(rawKey: string): string {
  const key = normalizeKey(rawKey);
  switch (key) {
    case ' ':
      return 'Space';
    case 'Backspace':
      return '⌫';
    case 'Escape':
      return 'Esc';
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'Delete':
      return 'Del';
    default:
      // F1–F12、Enter、Tab、PageUp 这些本身就是可读的英文，原样显示
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** 是否与默认键位完全一致（用来决定「恢复默认」按钮要不要置灰） */
export function isDefaultShortcuts(map: ShortcutMap, defaults: ShortcutMap): boolean {
  return SHORTCUT_ACTIONS.every((a) => normalizeKey(map[a]) === normalizeKey(defaults[a]));
}
