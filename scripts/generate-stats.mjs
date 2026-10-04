// Generates assets/code-composition.svg from live GitHub API data.
// Usage: node scripts/generate-stats.mjs   (optional: GITHUB_TOKEN env for higher rate limits)
import { writeFile } from 'node:fs/promises';

const USER = 'asifnawaz23';
const OUTPUT = new URL('../assets/code-composition.svg', import.meta.url);

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

const data = await collect();
await writeFile(OUTPUT, render(data), 'utf8');
console.log(`Wrote code-composition.svg: ${data.repoCount} repos, ${data.languageCount} languages`);
for (const l of data.languages) console.log(`  ${l.name.padEnd(14)} ${l.share.toFixed(1)}%`);
