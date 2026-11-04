// Generates branded placeholder images (not photos) for the real catalogue: node tools/gen-catalogue-img.js
const fs = require('fs'); const path = require('path'); const { PRODUCTS, CATEGORIES } = require('../src/catalogue');
const OUT = path.join(__dirname, '..', 'web', 'img', 'catalogue'); fs.mkdirSync(OUT, { recursive: true });
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const MIXER = '<g fill="none" stroke="#F8FAFC" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M40 40 L40 250 M40 40 L150 40 M150 40 L150 250"/><path d="M40 100h110M40 160h110"/><path d="M190 90 l90 -30 a60 60 0 0 1 40 110 l-90 30 z" fill="#F59E0B" stroke="#F59E0B"/><path d="M200 210 h120 M260 210 v40"/><circle cx="220" cy="262" r="20"/><circle cx="310" cy="262" r="20"/></g>';
const ENGINE = '<g fill="none" stroke="#F8FAFC" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><rect x="60" y="90" width="200" height="130" rx="14"/><rect x="100" y="50" width="120" height="40" rx="6" fill="#F59E0B" stroke="#F59E0B"/><circle cx="300" cy="155" r="40"/><circle cx="300" cy="155" r="12" fill="#F8FAFC"/><path d="M90 130h40M90 160h40M90 190h40M60 250h220"/></g>';
function wrap(t, n) { const w = t.split(' '); const L = []; let c = ''; for (const x of w) { if ((c + ' ' + x).trim().length > n) { L.push(c.trim()); c = x; } else c += ' ' + x; } if (c.trim()) L.push(c.trim()); return L; }
function card(title, sub, brand, icon) {
  const lines = wrap(title, 30).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="${esc(title)} (illustration)"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#123B65"/><stop offset="1" stop-color="#0B2744"/></linearGradient></defs>
<rect width="800" height="600" fill="url(#g)"/><circle cx="700" cy="80" r="220" fill="#F59E0B" opacity=".08"/>
<g transform="translate(440 60) scale(0.95)">${icon}</g>
<text x="48" y="80" font-family="Segoe UI,Roboto,Arial,sans-serif" font-size="26" font-weight="800" fill="#F59E0B" letter-spacing="3">${esc(brand)}</text>
<text font-family="Segoe UI,Roboto,Arial,sans-serif" font-size="34" font-weight="700" fill="#F8FAFC">${lines.map((l, i) => `<tspan x="48" y="${400 + i * 44}">${esc(l)}</tspan>`).join('')}</text>
${sub ? `<text x="48" y="${400 + lines.length * 44 + 8}" font-family="Segoe UI,Roboto,Arial,sans-serif" font-size="22" fill="#CBD5E1">${esc(sub)}</text>` : ''}
<rect x="48" y="530" width="210" height="36" rx="18" fill="#F59E0B" opacity=".18"/><text x="153" y="554" text-anchor="middle" font-family="Segoe UI,Roboto,Arial,sans-serif" font-size="16" font-weight="700" fill="#FCD34D">PHOTO COMING SOON</text>
<text x="752" y="556" text-anchor="end" font-family="Segoe UI,Roboto,Arial,sans-serif" font-size="18" font-weight="700" fill="#94A3B8">Mohan Mishra</text></svg>`;
}
for (const p of PRODUCTS) { const m = p.name.split(' – '); fs.writeFileSync(path.join(OUT, path.basename(p.image)), card(m[0], m.slice(1).join(' – '), p.brand, p.category.startsWith('Engine') ? ENGINE : MIXER)); }
for (const c of CATEGORIES) fs.writeFileSync(path.join(OUT, `cat-${c.slug}.svg`), card(c.name, c.subs.join(', ') || 'Diesel engines', 'MOHAN MISHRA', c.icon === 'engine' ? ENGINE : MIXER));
console.log('ok', fs.readdirSync(OUT).length);
// small square category icons (used on home tiles / categories page)
for (const [n, ic] of [['construction', MIXER], ['engine', ENGINE]]) fs.writeFileSync(path.join(OUT, `icon-${n}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" rx="72" fill="#123B65"/><g transform="translate(20 40)">${ic}</g></svg>`);
