/**
 * 学习报告导出 —— 生成一张可分享的卡片（SVG）+ PDF。
 *
 * ── 为什么用 SVG 自绘而不是引 PDF 库 ──────────────────────────────────────
 * 引 jsPDF 之类要 +200KB，而报告的内容其实很简单：标题 + 几个数字 + 一张曲线。
 * 用 SVG 手绘有几个好处：
 *  - 零依赖，产物是矢量图，放大不糊
 *  - 同一份 SVG 既能直接下载，也能交给浏览器打印成 PDF
 *  - 用户还可以直接截图分享
 *
 * 输出两条路径：
 *  1. downloadReportSvg()  —— 下载 .svg
 *  2. printReport()        —— 打开打印对话框，选"另存为 PDF"
 */
import type { DailyStat, OverviewStats, PracticeSession, UserWord } from '@/types';
import { aggregateDaily, computeLongestStreak, computeStreak, summarize } from '@/lib/stats';
import { todayCounts } from '@/services/learning';
import { db } from '@/db';

export interface ReportData {
  overview: OverviewStats;
  daily: DailyStat[];
  streak: number;
  longestStreak: number;
  generatedAt: number;
  /** 词库分布（前 5）*/
  bankTop: { bankId: string; learned: number; mastered: number }[];
}

/** 汇总生成报告所需的数据 */
export async function collectReportData(): Promise<ReportData> {
  const [sessions, words] = await Promise.all([db.sessions.toArray(), db.userWords.toArray()]);
  const counts = await todayCounts();
  const daily = aggregateDaily(sessions);
  const overview = summarize(sessions, words, counts.todayNew, counts.todayReviewed);

  const bankMap = new Map<string, { learned: number; mastered: number }>();
  for (const w of words) {
    const cur = bankMap.get(w.bankId) ?? { learned: 0, mastered: 0 };
    cur.learned++;
    if (w.mastered) cur.mastered++;
    bankMap.set(w.bankId, cur);
  }
  const bankTop = [...bankMap.entries()]
    .map(([bankId, v]) => ({ bankId, ...v }))
    .sort((a, b) => b.learned - a.learned)
    .slice(0, 5);

  return {
    overview,
    daily,
    streak: computeStreak(daily),
    longestStreak: computeLongestStreak(daily),
    generatedAt: Date.now(),
    bankTop,
  };
}

/** 主题色，与 App 保持一致 */
const C = {
  bg: '#0d1117',
  card: '#161b22',
  border: '#2d333b',
  text: '#e6edf3',
  muted: '#8b949e',
  accent: '#58a6ff',
  correct: '#3fb950',
  error: '#f85149',
};

/**
 * 生成报告 SVG。
 *
 * 尺寸固定 800×520，内容排布：
 *   顶部  标题 + 生成日期
 *   第一行 4 个核心数字
 *   中间  WPM 趋势曲线
 *   底部  连续天数 / 掌握进度 / 词库分布
 */
export function renderReportSvg(data: ReportData): string {
  const W = 800;
  const H = 520;
  const pad = 32;

  const { overview, daily, streak, longestStreak, generatedAt, bankTop } = data;
  const dateStr = new Date(generatedAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // 取最近 30 天用于曲线
  const recent = daily.slice(-30);
  const chartW = W - pad * 2;
  const chartH = 110;

  // 曲线点坐标
  const maxWpm = Math.max(40, ...recent.map((d) => d.bestWpm));
  const points = recent.map((d, i) => {
    const x = pad + (recent.length === 1 ? chartW / 2 : (i / (recent.length - 1)) * chartW);
    const y = 300 + chartH - (d.bestWpm / maxWpm) * chartH;
    return { x, y };
  });
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${300 + chartH} L${points[0].x.toFixed(1)},${300 + chartH} Z`
      : '';

  // 掌握率
  const learnedTotal = overview.masteredCount + overview.wrongCount;
  const masteredPct =
    learnedTotal > 0 ? Math.round((overview.masteredCount / Math.max(1, learnedTotal)) * 100) : 0;

  /** 四个核心数字块 */
  const stats = [
    { label: '连续天数', value: String(streak), unit: '天', sub: `最长 ${longestStreak} 天` },
    {
      label: '最佳 WPM',
      value: String(overview.bestWpm),
      unit: '',
      sub: `平均 ${overview.avgWpm}`,
    },
    {
      label: '正确率',
      value: `${Math.round(overview.accuracy * 100)}%`,
      unit: '',
      sub: `${overview.totalKeystrokes} 次击键`,
    },
    {
      label: '累计练习',
      value: String(overview.totalWords),
      unit: '词次',
      sub: `${overview.totalSessions} 轮`,
    },
  ];

  const statBlocks = stats
    .map((s, i) => {
      const x = pad + i * ((W - pad * 2) / 4);
      const bw = (W - pad * 2) / 4 - 12;
      return `
    <g>
      <rect x="${x}" y="96" width="${bw}" height="76" rx="10" fill="${C.card}" stroke="${C.border}"/>
      <text x="${x + 16}" y="120" fill="${C.muted}" font-size="12">${esc(s.label)}</text>
      <text x="${x + 16}" y="150" fill="${C.text}" font-size="26" font-weight="600" font-family="ui-monospace, Consolas, monospace">${esc(s.value)}</text>
      ${s.unit ? `<text x="${x + 16 + s.value.length * 15}" y="150" fill="${C.muted}" font-size="11">${esc(s.unit)}</text>` : ''}
      <text x="${x + 16}" y="165" fill="${C.muted}" font-size="10">${esc(s.sub)}</text>
    </g>`;
    })
    .join('');

  /** 词库分布条 */
  const bankRows = bankTop
    .map((b, i) => {
      const y = 448 + i * 0;
      const maxLearned = Math.max(1, ...bankTop.map((x) => x.learned));
      const w = (b.learned / maxLearned) * 180;
      return `
    <g transform="translate(${pad + (i % 3) * 250}, ${y})">
      <text x="0" y="0" fill="${C.muted}" font-size="11">${esc(shortBankName(b.bankId))}</text>
      <text x="200" y="0" fill="${C.text}" font-size="11" text-anchor="end" font-family="ui-monospace, monospace">${b.learned}</text>
      <rect x="0" y="6" width="180" height="4" rx="2" fill="${C.border}"/>
      <rect x="0" y="6" width="${w.toFixed(1)}" height="4" rx="2" fill="${C.accent}"/>
    </g>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${C.bg}"/>

  <!-- 标题 -->
  <text x="${pad}" y="52" fill="${C.text}" font-size="22" font-weight="600">EnglishMate · 学习报告</text>
  <text x="${W - pad}" y="52" fill="${C.muted}" font-size="12" text-anchor="end">${esc(dateStr)}</text>
  <line x1="${pad}" y1="70" x2="${W - pad}" y2="70" stroke="${C.border}"/>

  ${statBlocks}

  <!-- WPM 趋势 -->
  <text x="${pad}" y="220" fill="${C.text}" font-size="13" font-weight="500">WPM 趋势</text>
  <text x="${W - pad}" y="220" fill="${C.muted}" font-size="11" text-anchor="end">最近 ${recent.length} 天 · 每日最佳</text>
  ${
    recent.length > 0
      ? `
  <path d="${areaPath}" fill="url(#area)"/>
  <path d="${linePath}" fill="none" stroke="${C.accent}" stroke-width="2" stroke-linejoin="round"/>
  ${points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="${C.accent}"/>`).join('')}
  <text x="${pad}" y="${300 + chartH + 16}" fill="${C.muted}" font-size="10">峰值 ${maxWpm} WPM</text>
  `
      : `<text x="${W / 2}" y="${300 + chartH / 2}" fill="${C.muted}" font-size="12" text-anchor="middle">还没有练习记录</text>`
  }

  <!-- 底部：掌握进度 + 词库分布 -->
  <line x1="${pad}" y1="424" x2="${W - pad}" y2="424" stroke="${C.border}"/>
  <text x="${pad}" y="444" fill="${C.text}" font-size="12" font-weight="500">掌握进度</text>
  <text x="${pad + 70}" y="444" fill="${C.correct}" font-size="12" font-family="ui-monospace, monospace">${masteredPct}%</text>
  <text x="${pad + 110}" y="444" fill="${C.muted}" font-size="10">已掌握 ${overview.masteredCount} · 学习中 ${overview.wrongCount}</text>
  ${bankRows}

  <!-- 页脚 -->
  <text x="${pad}" y="${H - 12}" fill="${C.muted}" font-size="10">EnglishMate · 打字即学习 · 开源 MIT</text>
  <text x="${W - pad}" y="${H - 12}" fill="${C.muted}" font-size="10" text-anchor="end">数据仅存本地</text>
</svg>`;
}

/** XML 转义，防止词库名里的特殊字符破坏 SVG */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 词库 id 缩略，避免报告里出现过长的自定义 id */
function shortBankName(id: string): string {
  const map: Record<string, string> = {
    cet4: 'CET-4',
    cet6: 'CET-6',
    kaoyan: '考研',
    ielts: '雅思',
    toefl: '托福',
    gre: 'GRE',
    gaokao: '高考',
    primary: '小学',
    junior: '初中',
    tem4: '专四',
    tem8: '专八',
    sat: 'SAT',
    bec: 'BEC',
    coding: '编程',
    medical: '医学',
    linux: 'Linux',
  };
  if (id.startsWith('custom:')) return '自定义';
  return map[id] ?? id.slice(0, 8);
}

/** 下载 SVG 文件 */
export async function downloadReportSvg(): Promise<void> {
  const data = await collectReportData();
  const svg = renderReportSvg(data);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `englishmate-report-${new Date().toISOString().slice(0, 10)}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 打印报告（用户可在打印对话框选「另存为 PDF」）。
 *
 * 新开一个只含 SVG 的窗口再调用 print()，
 * 比在原页面上套 @media print 样式更干净——原页面有侧栏、导航，隐藏起来很麻烦。
 */
export async function printReport(): Promise<void> {
  const data = await collectReportData();
  const svg = renderReportSvg(data);

  const win = window.open('', '_blank', 'width=840,height=580');
  if (!win) throw new Error('浏览器拦截了弹窗，请允许后重试');

  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>EnglishMate 学习报告</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  html,body { margin:0; padding:0; background:#fff; }
  svg { width:100%; height:auto; display:block; }
  .tip { font:12px/1.6 system-ui,sans-serif; color:#666; padding:10px 16px; }
  @media print { .tip { display:none; } }
</style></head>
<body>
  <div class="tip">在打印对话框里选择「另存为 PDF」即可保存。</div>
  ${svg}
</body></html>`);
  win.document.close();
  // 等 SVG 渲染完再触发打印
  win.setTimeout(() => {
    win.focus();
    win.print();
  }, 350);
}

/** 供测试使用：从原始数据直接渲染，不碰数据库 */
export function renderReportFromRaw(
  sessions: PracticeSession[],
  words: UserWord[],
  now = Date.now(),
): string {
  const daily = aggregateDaily(sessions);
  return renderReportSvg({
    overview: summarize(sessions, words, 0, 0),
    daily,
    streak: computeStreak(daily),
    longestStreak: computeLongestStreak(daily),
    generatedAt: now,
    bankTop: [],
  });
}
