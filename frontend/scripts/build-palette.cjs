// Generates src/styles/palette.css from the colour decisions below. Run from frontend/: node scripts/build-palette.cjs
const tw = require(process.cwd() + '/node_modules/tailwindcss/colors');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ch = (h) => rgb(h).join(' ');
const mix = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v * t + rgb(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
const L = (h) => { const c = rgb(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const R = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const K = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Neutral greys from the Editorial-greeting sheet (#f9f9f9 surface, #eaeaea border, #1f201d ink).
const neutralBg = { 50: '#F9F9F8', 100: '#F2F2F0', 200: '#EAEAE8', 300: '#D9D9D6', 400: '#A9A9A5', 500: '#7A7A76', 600: '#5C5C59', 700: '#3D3D3A', 800: '#2B2C29', 900: '#1F201D', 950: '#121310' };
const neutralTx = { ...neutralBg, 400: '#686865', 500: '#636361', 600: '#4E4E4B' };
// Dark theme: ground #141513, surface #1B1C1A, raised #232421, border #30312E.
const PAGE = '#141513', PANEL = '#1A1B19', SURF = '#21221F';
const neutralDarkBg = { 50: PANEL, 100: '#232421', 200: '#30312E', 300: '#3E3F3B', 400: '#6E6F6A', 500: '#575853', 600: '#4D4E4A', 700: '#454642', 800: '#2A2B28', 900: '#0E0F0D', 950: '#090A09' };
const neutralDarkTx = { 50: '#FAFAF9', 100: '#F3F3F1', 200: '#E6E6E3', 300: '#D2D2CE', 400: '#9E9E99', 500: '#A3A39E', 600: '#B9B9B4', 700: '#CFCFCA', 800: '#E2E2DE', 900: '#EDEDEA', 950: '#FFFFFF' };

// Workspace identities: Solo deep teal, Group plum.
const solo = { 50: '#EEF6F5', 100: '#D6EBE8', 200: '#ADD6D1', 300: '#7DBBB3', 400: '#4C9A91', 500: '#2A8077', 600: '#1B6E66', 700: '#165A54', 800: '#134944', 900: '#113C38', 950: '#082321' };
const group = { 50: '#F7F0F6', 100: '#EEDDEC', 200: '#DDBBD9', 300: '#C690BF', 400: '#B57BAC', 500: '#8F4C85', 600: '#7B3F74', 700: '#66345F', 800: '#532B4E', 900: '#452541', 950: '#2A1327' };

const pals = { rose: tw.rose, emerald: tw.emerald, amber: tw.amber, purple: tw.purple, violet: tw.violet, sky: tw.sky, blue: tw.blue, cyan: tw.cyan, orange: tw.orange, green: tw.green, red: tw.red, teal: tw.teal, yellow: tw.yellow, solo, group };
const SOFT = ['emerald', 'amber', 'sky', 'cyan', 'orange', 'green', 'teal', 'yellow'];
const fillFix = (n, c) => (SOFT.includes(n) ? { ...c, 600: c[700], 700: c[800] } : c);
const lightTx = (n, c) => (SOFT.includes(n) ? { ...c, 500: c[700], 600: c[700] } : ['rose', 'red'].includes(n) ? { ...c, 500: c[600] } : c);
const darkBg = (c) => ({ 50: mix(c[500], SURF, 0.14), 100: mix(c[500], SURF, 0.2), 200: mix(c[500], SURF, 0.32), 300: mix(c[500], SURF, 0.45), 400: c[400], 500: c[500], 600: c[600], 700: c[700], 800: mix(c[700], PAGE, 0.55), 900: mix(c[800], PAGE, 0.45), 950: mix(c[900], PAGE, 0.35) });
const darkTx = (c) => ({ 50: c[50], 100: c[100], 200: c[200], 300: c[300], 400: c[400], 500: c[400], 600: c[400], 700: c[300], 800: c[200], 900: c[100], 950: c[50] });
const block = (pre, name, scale) => K.map((k) => `  --${pre}-${name}-${k}: ${ch(scale[k])};`).join('\n');

const lightSet = () => [
  '  --bg-white: 255 255 255;',
  block('bg', 'slate', neutralBg),
  block('tx', 'slate', neutralTx),
  ...Object.entries(pals).flatMap(([n, c]) => [block('bg', n, fillFix(n, c)), block('tx', n, lightTx(n, c))]),
].join('\n');
const darkSet = () => [
  `  --bg-white: ${ch(SURF)};`,
  block('bg', 'slate', neutralDarkBg),
  block('tx', 'slate', neutralDarkTx),
  ...Object.entries(pals).flatMap(([n, c]) => [block('bg', n, darkBg(fillFix(n, c))), block('tx', n, darkTx(c))]),
].join('\n');

// The workspace accent ("indigo"/"accent" classes) plus a whisper of its hue in the panel greys,
// so switching workspace changes the whole room, not just the buttons.
const room = (scale, dark) => {
  const acc = block('bg', 'accent', dark ? darkBg(scale) : scale) + '\n' + block('tx', 'accent', dark ? darkTx(scale) : scale);
  const tint = dark
    ? { 50: mix(scale[500], PANEL, 0.06), 100: mix(scale[500], '#232421', 0.08) }
    : { 50: mix(scale[500], '#F9F9F8', 0.045), 100: mix(scale[500], '#F2F2F0', 0.06) };
  return `${acc}\n  --bg-slate-50: ${ch(tint[50])};\n  --bg-slate-100: ${ch(tint[100])};\n  --color-room: ${ch(dark ? scale[400] : scale[600])};`;
};

const css = `/* Theme palette. GENERATED (see DESIGN.md): every Tailwind colour class reads one of these variables,
   so light/dark (<html data-theme>) and the Solo/Group room (<html data-workspace>) switch without
   touching components. Values are "R G B" channels so opacity modifiers keep working. Backgrounds (bg-*)
   and text (tx-*) have separate scales so a tinted background and its text both stay readable.
   slate = the warm neutral greys; indigo/accent = the current workspace; solo/group = fixed identities. */

:root,
.palette-light {
${lightSet()}
}

[data-theme='dark'] {
${darkSet()}
}

:root,
[data-workspace='solo'],
.palette-light {
${room(solo, false)}
}
[data-workspace='group'] {
${room(group, false)}
}
[data-theme='dark'],
[data-theme='dark'][data-workspace='solo'],
[data-theme='dark'] [data-workspace='solo'] {
${room(solo, true)}
}
[data-theme='dark'][data-workspace='group'],
[data-theme='dark'] [data-workspace='group'] {
${room(group, true)}
}
`;
require('fs').writeFileSync('src/styles/palette.css', css);

const W = '#FFFFFF';
const checks = [
  ['muted text on white', neutralTx[500], W], ['slate-400 text on panel', neutralTx[400], neutralBg[50]],
  ['white on solo-600', W, solo[600]], ['white on group-600', W, group[600]],
  ['solo-700 text on solo-50', solo[700], solo[50]], ['group-700 text on group-50', group[700], group[50]],
  ['dark muted on surface', neutralDarkTx[500], SURF], ['dark slate-400 on page', neutralDarkTx[400], PAGE],
  ['dark solo-400 text on surface', solo[400], SURF], ['dark group-400 text on surface', group[400], SURF],
  ['white on dark solo-600', W, solo[600]], ['dark ink on surface', neutralDarkTx[900], SURF],
];
for (const [n, a, b] of checks) console.log(n.padEnd(32), R(a, b).toFixed(2));
