// Generates the profile's data-driven charts from live GitHub data:
//   assets/code-composition.svg  language share across original repos (GitHub REST API)
//   assets/activity-3d.svg       3D contribution skyline + monthly bars (public contribution calendar)
// Usage: node scripts/generate-stats.mjs   (optional: GITHUB_TOKEN env for higher rate limits)
import { writeFile } from 'node:fs/promises';

const USER = 'asifnawaz23';
const OUTPUT = new URL('../assets/code-composition.svg', import.meta.url);
const ACTIVITY_OUTPUT = new URL('../assets/activity-3d.svg', import.meta.url);

// Markup, styling, and notebook output inflate byte counts without reflecting authored logic.
const EXCLUDED = new Set(['HTML', 'CSS', 'SCSS', 'Jupyter Notebook', 'Batchfile', 'Procfile', 'Dockerfile']);
const VENDOR_DIRS = new Set(['venv', '.venv', 'env', 'node_modules', 'site-packages']);
const PALETTE = ['#B8FF5A', '#6CE5E8', '#E9ECE4', '#8FB35C', '#3FA7AA', '#9AA09A', '#5C625D'];

const headers = { 'User-Agent': `${USER}-profile-stats`, Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  return res.json();
}

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

async function collect() {
  const repos = (await api(`/users/${USER}/repos?per_page=100&type=owner`))
    .filter((r) => !r.fork && r.size > 0 && r.name.toLowerCase() !== USER);

  const totals = new Map();
  for (const repo of repos) {
    // Committed dependency folders (venv, node_modules) would dominate byte counts, so skip those repos.
    const root = await api(`/repos/${USER}/${repo.name}/contents/`);
    const vendored = Array.isArray(root) && root.some((e) => e.type === 'dir' && VENDOR_DIRS.has(e.name));
    if (vendored) {
      console.log(`  skipped ${repo.name}: committed dependency folder`);
      continue;
    }
    const langs = await api(`/repos/${USER}/${repo.name}/languages`);
    for (const [lang, bytes] of Object.entries(langs)) {
      if (!EXCLUDED.has(lang)) totals.set(lang, (totals.get(lang) ?? 0) + bytes);
    }
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const sum = sorted.reduce((acc, [, b]) => acc + b, 0) || 1;
  const top = sorted.slice(0, 6);
  const rest = sorted.slice(6).reduce((acc, [, b]) => acc + b, 0);
  if (rest > 0) top.push(['Other', rest]);

  const lastPush = repos.map((r) => r.pushed_at).sort().at(-1);
  return {
    languages: top.map(([name, bytes]) => ({ name, share: (bytes / sum) * 100 })),
    repoCount: repos.length,
    languageCount: sorted.length,
    lastPush: lastPush ? lastPush.slice(0, 10) : 'n/a',
    generated: new Date().toISOString().slice(0, 10),
  };
}

function isoBar(cx, baseY, height, color, index) {
  const a = 30; // half width of the rhombus
  const b = 15; // half depth of the rhombus
  const ty = baseY - height;
  const top = `M${cx} ${ty - b}L${cx + a} ${ty}L${cx} ${ty + b}L${cx - a} ${ty}Z`;
  const left = `M${cx - a} ${ty}L${cx} ${ty + b}L${cx} ${baseY + b}L${cx - a} ${baseY}Z`;
  const right = `M${cx + a} ${ty}L${cx} ${ty + b}L${cx} ${baseY + b}L${cx + a} ${baseY}Z`;
  return `
    <ellipse cx="${cx}" cy="${baseY + b + 4}" rx="${a + 10}" ry="8" fill="#000" opacity="0.65"/>
    <g class="bar" style="animation-delay:${(index * 0.28).toFixed(2)}s">
      <path d="${left}" fill="${color}" fill-opacity="0.42"/>
      <path d="${right}" fill="${color}" fill-opacity="0.22"/>
      <path d="${top}" fill="${color}" fill-opacity="0.95"/>
      <path d="M${cx} ${ty + b}V${baseY + b}" stroke="#050505" stroke-opacity="0.35"/>
    </g>`;
}

function render(data) {
  const baseY = 300;
  const maxH = 170;
  const maxShare = Math.max(...data.languages.map((l) => l.share), 1);
  // Spread bars across the chart area regardless of how many languages qualify.
  const spacing = Math.min(150, 620 / Math.max(data.languages.length - 1, 1));
  const startX = 84;

  const bars = data.languages.map((lang, i) => {
    const cx = startX + i * spacing;
    const h = Math.max(10, (lang.share / maxShare) * maxH);
    const color = PALETTE[i % PALETTE.length];
    return `${isoBar(cx, baseY, h, color, i)}
    <text x="${cx}" y="${baseY - h - 26}" text-anchor="middle" fill="#F2F3ED" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="600">${lang.share.toFixed(1)}%</text>
    <text x="${cx}" y="${baseY + 46}" text-anchor="middle" fill="#9AA09A" font-family="Consolas, monospace" font-size="10" letter-spacing="0.6">${escapeXml(lang.name.toUpperCase())}</text>`;
  }).join('');

  const kpi = (y, label, value, accent) => `
    <g transform="translate(790 ${y})">
      <text fill="#5F655F" font-family="Consolas, monospace" font-size="9" letter-spacing="1.6">${label}</text>
      <text y="34" fill="${accent}" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="600">${escapeXml(value)}</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400" role="img" aria-labelledby="title desc">
  <title id="title">Code composition across original public repositories</title>
  <desc id="desc">Isometric bar chart of programming language share by code volume, generated from the GitHub API on ${data.generated}.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#070807"/><stop offset="1" stop-color="#0E110F"/></linearGradient>
    <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#F2F3ED" stroke-opacity="0.03"/></pattern>
    <clipPath id="frame"><rect x="8" y="8" width="1184" height="384" rx="14"/></clipPath>
    <style>
      .bar{animation:breathe 4.5s ease-in-out infinite}.scan{animation:scan 8s linear infinite}.pulse{animation:pulse 2.6s ease-in-out infinite}
      @keyframes breathe{0%,100%{opacity:.78}50%{opacity:1}}@keyframes scan{0%{transform:translateX(-140px);opacity:0}10%,85%{opacity:.5}100%{transform:translateX(760px);opacity:0}}@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
      @media(prefers-reduced-motion:reduce){.bar,.scan,.pulse{animation:none!important}}
    </style>
  </defs>
  <rect x="8" y="8" width="1184" height="384" rx="14" fill="url(#bg)" stroke="#F2F3ED" stroke-opacity="0.16"/>
  <g clip-path="url(#frame)">
    <rect x="8" y="8" width="1184" height="384" fill="url(#grid)"/>
    <rect class="scan" x="20" y="60" width="120" height="300" fill="#B8FF5A" opacity="0.05"/>
    <text x="34" y="42" fill="#B8FF5A" font-family="Consolas, monospace" font-size="11" letter-spacing="2">CODE COMPOSITION / LIVE GITHUB DATA</text>
    <text x="1166" y="42" text-anchor="end" fill="#5F655F" font-family="Consolas, monospace" font-size="10" letter-spacing="1.4">GENERATED ${data.generated}</text>
    <path d="M34 58H1166" stroke="#F2F3ED" stroke-opacity="0.1"/>
    <path d="M34 ${baseY + 15}H730" stroke="#F2F3ED" stroke-opacity="0.08"/>
    ${bars}
    <path d="M760 80V360" stroke="#F2F3ED" stroke-opacity="0.08"/>
    ${kpi(96, 'ORIGINAL PUBLIC REPOS', String(data.repoCount).padStart(2, '0'), '#F2F3ED')}
    ${kpi(176, 'PROGRAMMING LANGUAGES', String(data.languageCount).padStart(2, '0'), '#6CE5E8')}
    ${kpi(256, 'LATEST PUSH', data.lastPush, '#B8FF5A')}
    <circle class="pulse" cx="1150" cy="300" r="4" fill="#B8FF5A"/>
    <text x="790" y="356" fill="#5F655F" font-family="Consolas, monospace" font-size="9" letter-spacing="1.1">SHARE BY BYTES · EXCLUDES MARKUP, STYLES &amp; NOTEBOOKS</text>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Activity: 3D contribution skyline + monthly bar chart
// ---------------------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

async function collectActivity() {
  const res = await fetch(`https://github.com/users/${USER}/contributions`, {
    headers: { 'User-Agent': `${USER}-profile-stats` },
  });
  if (!res.ok) throw new Error(`contributions page returned ${res.status}`);
  const html = await res.text();

  // Each calendar cell is a <td> carrying data-date and an id of the form contribution-day-component-<weekday>-<week>.
  const cells = new Map();
  for (const [tag] of html.matchAll(/<td\b[^>]*data-date="[^"]+"[^>]*>/g)) {
    const date = tag.match(/data-date="([\d-]+)"/)?.[1];
    const id = tag.match(/id="(contribution-day-component-(\d+)-(\d+))"/);
    const level = Number(tag.match(/data-level="(\d)"/)?.[1] ?? 0);
    if (!date || !id) continue;
    cells.set(id[1], { date, dow: Number(id[2]), week: Number(id[3]), level, count: 0 });
  }
  // Exact counts live in the matching <tool-tip> ("3 contributions on ...", "No contributions on ...").
  for (const [, forId, text] of html.matchAll(/<tool-tip\b[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const cell = cells.get(forId);
    const n = text.trim().match(/^(\d[\d,]*) contributions?/);
    if (cell && n) cell.count = Number(n[1].replace(/,/g, ''));
  }

  const days = [...cells.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 300) throw new Error(`parsed only ${days.length} calendar days; markup may have changed`);

  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  const byMonth = new Map();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + d.count);
  }
  const months = [...byMonth.entries()].slice(-12).map(([key, count]) => ({
    key,
    label: MONTHS[Number(key.slice(5, 7)) - 1],
    count,
  }));
  const busiest = months.reduce((best, m) => (m.count > best.count ? m : best), months[0]);

  return {
    days,
    total: days.reduce((acc, d) => acc + d.count, 0),
    activeDays: days.filter((d) => d.count > 0).length,
    longest,
    months,
    busiest: busiest.count > 0 ? `${busiest.label} ${busiest.key.slice(0, 4)}` : 'n/a',
    weeks: Math.max(...days.map((d) => d.week)) + 1,
    generated: new Date().toISOString().slice(0, 10),
  };
}

// Darken a #RRGGBB colour by a factor (0..1) to shade the side faces of a 3D block.
function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.round(((n >> shift) & 255) * factor);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

const LEVEL_COLORS = ['#1A1F1B', '#3E5F22', '#5E8A31', '#8BC34A', '#B8FF5A'];

function renderActivity(act) {
  // Dimetric projection: weeks run to the right, weekdays run toward the viewer.
  const W = [12.2, 3.0];
  const D = [-8.0, 4.6];
  const ox = 120;
  const oy = 182;
  const gap = 0.14;
  const maxCount = Math.max(1, ...act.days.map((d) => d.count));
  const maxH = 150;
  const p = (w, d, lift = 0) => [ox + w * W[0] + d * D[0], oy + w * W[1] + d * D[1] - lift];
  const pts = (...list) => list.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L');

  const sorted = [...act.days].sort((a, b) => (a.week * W[1] + a.dow * D[1]) - (b.week * W[1] + b.dow * D[1]));
  const lastActive = [...act.days].reverse().find((d) => d.count > 0);

  const tiles = sorted.map((cell) => {
    const w0 = cell.week + gap;
    const w1 = cell.week + 1 - gap;
    const d0 = cell.dow + gap;
    const d1 = cell.dow + 1 - gap;
    if (cell.count === 0) {
      return `<path d="M${pts(p(w0, d0), p(w1, d0), p(w1, d1), p(w0, d1))}Z" fill="${LEVEL_COLORS[0]}"/>`;
    }
    const level = Math.min(4, Math.max(1, cell.level || Math.ceil((cell.count / maxCount) * 4)));
    const top = LEVEL_COLORS[level];
    const h = 8 + Math.pow(cell.count / maxCount, 0.7) * maxH;
    const A = p(w0, d0, h);
    const B = p(w1, d0, h);
    const C = p(w1, d1, h);
    const E = p(w0, d1, h);
    const Bb = p(w1, d0);
    const Cb = p(w1, d1);
    const Eb = p(w0, d1);
    const delay = (cell.week * 0.025).toFixed(3);
    return `<g class="tower" style="animation-delay:${delay}s">
      <path d="M${pts(Eb, Cb, C, E)}Z" fill="${shade(top, 0.42)}"/>
      <path d="M${pts(Bb, Cb, C, B)}Z" fill="${shade(top, 0.62)}"/>
      <path d="M${pts(A, B, C, E)}Z" fill="${top}"/>
    </g>`;
  }).join('\n    ');

  // Month labels along the front edge of the skyline, placed at the first week of each month.
  let previous = '';
  const monthLabels = [];
  for (const cell of act.days.filter((d) => d.dow === 0)) {
    const label = MONTHS[Number(cell.date.slice(5, 7)) - 1];
    if (label !== previous) {
      const [x, y] = p(cell.week + 0.5, 7);
      monthLabels.push(`<text x="${x.toFixed(1)}" y="${(y + 18).toFixed(1)}" text-anchor="middle">${label}</text>`);
      previous = label;
    }
  }
  monthLabels.shift(); // the first column is usually a partial month

  let marker = '';
  if (lastActive) {
    const h = 8 + Math.pow(lastActive.count / maxCount, 0.7) * maxH;
    const [mx, my] = p(lastActive.week + 0.5, lastActive.dow + 0.5, h);
    marker = `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="9" fill="none" stroke="#B8FF5A" class="ping"/>`;
  }

  // Monthly 3D bars in the side panel.
  const baseY = 416;
  const barMax = 128;
  const monthMax = Math.max(1, ...act.months.map((m) => m.count));
  const bars = act.months.map((m, i) => {
    const cx = 884 + i * 25.5;
    const a = 9;
    const b = 4.5;
    const h = m.count > 0 ? 6 + (m.count / monthMax) * barMax : 0;
    const ty = baseY - h;
    const color = m.count === monthMax && m.count > 0 ? '#B8FF5A' : m.count > 0 ? '#6F9E35' : '#2A302B';
    const topFace = `M${cx} ${ty - b}L${cx + a} ${ty}L${cx} ${ty + b}L${cx - a} ${ty}Z`;
    const label = `<text x="${cx}" y="${baseY + 24}" text-anchor="middle" fill="#6F756F" font-size="8">${m.label}</text>`;
    if (h === 0) return `<path d="${topFace}" fill="${color}"/>${label}`;
    const left = `M${cx - a} ${ty}L${cx} ${ty + b}L${cx} ${baseY + b}L${cx - a} ${baseY}Z`;
    const right = `M${cx + a} ${ty}L${cx} ${ty + b}L${cx} ${baseY + b}L${cx + a} ${baseY}Z`;
    return `<g class="bar" style="animation-delay:${(i * 0.08).toFixed(2)}s">
      <path d="${left}" fill="${shade(color, 0.5)}"/><path d="${right}" fill="${shade(color, 0.32)}"/><path d="${topFace}" fill="${color}"/>
    </g>
    <text x="${cx}" y="${(ty - b - 6).toFixed(1)}" text-anchor="middle" fill="#E9ECE4" font-size="9" font-family="Segoe UI, Arial, sans-serif" font-weight="600">${m.count}</text>${label}`;
  }).join('\n    ');

  const kpi = (x, y, label, value, accent) => `<g transform="translate(${x} ${y})">
      <text fill="#5F655F" font-family="Consolas, monospace" font-size="9" letter-spacing="1.4">${label}</text>
      <text y="30" fill="${accent}" font-family="Segoe UI, Arial, sans-serif" font-size="26" font-weight="600">${escapeXml(value)}</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="480" viewBox="0 0 1200 480" role="img" aria-labelledby="title desc">
  <title id="title">Contribution activity, last 12 months</title>
  <desc id="desc">3D skyline of daily GitHub contributions, one tower per day, with a monthly bar chart. ${act.total} contributions on ${act.activeDays} active days; longest streak ${act.longest} days. Generated ${act.generated}.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#070807"/><stop offset="1" stop-color="#0E110F"/></linearGradient>
    <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#F2F3ED" stroke-opacity="0.03"/></pattern>
    <clipPath id="frame"><rect x="8" y="8" width="1184" height="464" rx="14"/></clipPath>
    <style>
      .tower,.bar{transform-box:fill-box;transform-origin:50% 100%;animation:grow 1.2s cubic-bezier(.2,.8,.2,1) both}
      .ping{transform-box:fill-box;transform-origin:center;animation:ping 2.4s ease-out infinite}
      .scan{animation:scan 9s linear infinite}
      @keyframes grow{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}
      @keyframes ping{0%{transform:scale(.4);opacity:.9}100%{transform:scale(2.4);opacity:0}}
      @keyframes scan{0%{transform:translateX(-160px);opacity:0}10%,85%{opacity:.45}100%{transform:translateX(860px);opacity:0}}
      @media(prefers-reduced-motion:reduce){.tower,.bar,.ping,.scan{animation:none!important}}
    </style>
  </defs>
  <rect x="8" y="8" width="1184" height="464" rx="14" fill="url(#bg)" stroke="#F2F3ED" stroke-opacity="0.16"/>
  <g clip-path="url(#frame)">
    <rect x="8" y="8" width="1184" height="464" fill="url(#grid)"/>
    <rect class="scan" x="20" y="60" width="140" height="380" fill="#B8FF5A" opacity="0.04"/>
    <text x="34" y="34" fill="#B8FF5A" font-family="Consolas, monospace" font-size="11" letter-spacing="2">CONTRIBUTION SKYLINE / LAST 12 MONTHS</text>
    <text x="1166" y="34" text-anchor="end" fill="#5F655F" font-family="Consolas, monospace" font-size="10" letter-spacing="1.4">GENERATED ${act.generated}</text>
    <path d="M34 46H1166" stroke="#F2F3ED" stroke-opacity="0.1"/>

    ${tiles}
    ${marker}
    <g fill="#6F756F" font-family="Consolas, monospace" font-size="9" letter-spacing="1">
      ${monthLabels.join('\n      ')}
    </g>

    <path d="M846 64V452" stroke="#F2F3ED" stroke-opacity="0.08"/>
    ${kpi(872, 80, 'CONTRIBUTIONS', String(act.total), '#F2F3ED')}
    ${kpi(1026, 80, 'ACTIVE DAYS', String(act.activeDays), '#6CE5E8')}
    ${kpi(872, 150, 'LONGEST STREAK', `${act.longest} day${act.longest === 1 ? '' : 's'}`, '#B8FF5A')}
    ${kpi(1026, 150, 'BUSIEST MONTH', act.busiest, '#E9ECE4')}
    <text x="872" y="236" fill="#D8DAD4" font-family="Consolas, monospace" font-size="10" letter-spacing="1.5">MONTHLY CONTRIBUTIONS</text>
    <path d="M868 ${baseY + 5}H1170" stroke="#F2F3ED" stroke-opacity="0.08"/>
    <g font-family="Consolas, monospace">
    ${bars}
    </g>

    <text x="34" y="458" fill="#5F655F" font-family="Consolas, monospace" font-size="9" letter-spacing="1.1">EACH TOWER = ONE DAY · HEIGHT = CONTRIBUTIONS · SOURCE: PUBLIC GITHUB CONTRIBUTION CALENDAR</text>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Each chart is generated independently so one data-source failure never blocks the other;
// on failure the previously committed SVG is left untouched.
// ---------------------------------------------------------------------------

let failures = 0;

try {
  const data = await collect();
  await writeFile(OUTPUT, render(data), 'utf8');
  console.log(`Wrote code-composition.svg: ${data.repoCount} repos, ${data.languageCount} languages`);
  for (const l of data.languages) console.log(`  ${l.name.padEnd(14)} ${l.share.toFixed(1)}%`);
} catch (err) {
  failures += 1;
  console.warn(`code-composition.svg not updated: ${err.message}`);
}

try {
  const act = await collectActivity();
  await writeFile(ACTIVITY_OUTPUT, renderActivity(act), 'utf8');
  console.log(`Wrote activity-3d.svg: ${act.total} contributions, ${act.activeDays} active days, longest streak ${act.longest}, busiest ${act.busiest}`);
  console.log(`  monthly: ${act.months.map((m) => `${m.label} ${m.count}`).join(' · ')}`);
} catch (err) {
  failures += 1;
  console.warn(`activity-3d.svg not updated: ${err.message}`);
}

if (failures === 2) process.exitCode = 1;
