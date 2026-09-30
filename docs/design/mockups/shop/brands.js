// Twelve invented makers, drawn procedurally: a badge mark (SVG, 200×200) and a wordmark (canvas), both from code.
// No real brand, logo, typeface licence or protected symbol: shields, crosses and rainbow bands never appear.
const FONTS = {
  grotesk: '"Avenir Next", "Helvetica Neue", Figtree, Arial, sans-serif',
  futura: 'Futura, Jost, "Century Gothic", sans-serif',
  serif: '"Iowan Old Style", Lora, Georgia, serif',
  didone: 'Didot, "Bodoni 72", "Bodoni Moda", Georgia, serif',
  script: '"Snell Roundhand", "Apple Chancery", "Great Vibes", cursive',
  mono: 'Menlo, "SF Mono", "JetBrains Mono", Consolas, monospace',
  round: '"Arial Rounded MT Bold", Nunito, sans-serif'
}
// 5×7 bitmaps for Lismer's cross-stitch letters
const STITCH = { L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'], I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'], S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'] }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

// ---------------------------------------------------------------- badge marks (SVG)
const MARKS = {
  swoosh: ([a, b, c]) => `<circle cx="100" cy="100" r="92" fill="${b}"/><path d="M26 128 C70 70 128 58 184 70 C128 72 82 92 40 138 Z" fill="${a}"/><path d="M50 150 C88 112 132 104 178 110 C136 114 100 126 64 158 Z" fill="${a}" opacity="0.55"/><text x="104" y="112" font-family='${FONTS.grotesk}' font-style="italic" font-weight="900" font-size="64" fill="${a}" text-anchor="middle" transform="skewX(-8)">F</text>`,
  horns: ([a, b, c]) => `<circle cx="100" cy="100" r="92" fill="${b}"/><path d="M84 160 C82 120 80 84 88 58 C93 40 82 28 66 38" fill="none" stroke="${a}" stroke-width="15" stroke-linecap="round"/><path d="M118 160 C120 120 122 84 130 58 C135 40 124 28 108 38" fill="none" stroke="${a}" stroke-width="15" stroke-linecap="round" opacity="0.78"/><circle cx="150" cy="52" r="12" fill="${c}"/>`,
  oval: ([a, b, c]) => `<ellipse cx="100" cy="100" rx="70" ry="94" fill="${c}"/><ellipse cx="100" cy="100" rx="62" ry="86" fill="${a}"/><ellipse cx="100" cy="100" rx="55" ry="79" fill="none" stroke="${b}" stroke-width="2.5"/><text x="100" y="118" font-family='${FONTS.didone}' font-weight="700" font-size="64" fill="${b}" text-anchor="middle">H</text><text x="100" y="64" font-family='${FONTS.serif}' font-size="11" letter-spacing="2" fill="${b}" text-anchor="middle">HARTLOT</text><text x="100" y="146" font-family='${FONTS.serif}' font-size="9.5" letter-spacing="1.5" fill="${b}" text-anchor="middle">RAHMENBAU</text>`,
  marmot: ([a, b, c]) => `<circle cx="100" cy="100" r="92" fill="${c}"/><circle cx="100" cy="100" r="82" fill="${a}"/><path d="M100 50 C114 50 122 60 122 72 C122 80 118 84 116 88 C130 96 136 116 134 140 C133 152 124 160 112 160 L88 160 C76 160 67 152 66 140 C64 116 70 96 84 88 C82 84 78 80 78 72 C78 60 86 50 100 50 Z M86 52 C84 44 88 40 92 44 Z M114 52 C116 44 112 40 108 44 Z M84 110 C74 112 72 122 80 124 C86 120 90 116 92 112 Z M116 110 C126 112 128 122 120 124 C114 120 110 116 108 112 Z" fill="${b}"/><circle cx="93" cy="70" r="3" fill="${a}"/><circle cx="107" cy="70" r="3" fill="${a}"/><ellipse cx="100" cy="79" rx="5" ry="3.5" fill="${a}"/>`,
  ticks: ([a, b, c]) => { let t = ''; for (let i = 0; i < 60; i++) { const L = i % 5 ? 8 : 18, w = i % 5 ? 2 : 4; t += `<rect x="${100 - w / 2}" y="12" width="${w}" height="${L}" fill="${a}" transform="rotate(${i * 6} 100 100)"/>` } let g = ''; for (let i = 0; i < 15; i++) g += `<path d="M100 58 L106 72 L94 72 Z" fill="${c}" transform="rotate(${i * 24} 100 100)"/>`; return `<circle cx="100" cy="100" r="94" fill="${b}"/>${t}${g}<circle cx="100" cy="100" r="30" fill="${c}"/><circle cx="100" cy="100" r="9" fill="${b}"/>` },
  stencil: ([a, b, c]) => `<circle cx="100" cy="100" r="92" fill="${c}"/><circle cx="100" cy="100" r="72" fill="none" stroke="${a}" stroke-width="16" stroke-dasharray="100 12"/><text x="100" y="124" font-family='${FONTS.futura}' font-weight="800" font-size="72" fill="${b}" text-anchor="middle">R</text><rect x="60" y="92" width="80" height="6" fill="${c}"/>`,
  ampersand: ([a, b, c]) => `<rect x="10" y="10" width="180" height="180" rx="36" fill="${a}"/><rect x="22" y="22" width="156" height="156" rx="26" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="8 7"/><text x="100" y="138" font-family='${FONTS.serif}' font-style="italic" font-weight="600" font-size="118" fill="${c}" text-anchor="middle">&amp;</text>`,
  screw: ([a, b, c]) => `<circle cx="100" cy="100" r="92" fill="${c}"/><circle cx="100" cy="100" r="66" fill="${a}"/><circle cx="100" cy="100" r="54" fill="none" stroke="${c}" stroke-width="3" opacity="0.5"/><rect x="50" y="90" width="100" height="20" rx="6" fill="${c}" transform="rotate(-28 100 100)"/><circle cx="146" cy="52" r="11" fill="${b}"/>`,
  stitch: ([a, b, c]) => { let s = ''; const L = STITCH.L; for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (L[y][x] === '1') { const X = 58 + x * 18, Y = 38 + y * 18; s += `<path d="M${X - 6} ${Y - 6} L${X + 6} ${Y + 6} M${X + 6} ${Y - 6} L${X - 6} ${Y + 6}" stroke="${b}" stroke-width="4" stroke-linecap="round"/>` } for (let i = 0; i < 12; i++) { const ang = (i / 12) * Math.PI * 2; const X = 100 + Math.cos(ang) * 82, Y = 100 + Math.sin(ang) * 82; s += `<path d="M${X - 4} ${Y - 4} L${X + 4} ${Y + 4} M${X + 4} ${Y - 4} L${X - 4} ${Y + 4}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>` } return `<circle cx="100" cy="100" r="94" fill="${a}"/>${s}` },
  thread: ([a, b, c]) => `<circle cx="100" cy="100" r="92" fill="${b}"/><path d="M52 62 L148 62 L56 142 L150 142" fill="none" stroke="${a}" stroke-width="16" stroke-linejoin="round" stroke-linecap="round"/><path d="M40 50 C80 30 120 90 160 60 M40 160 C80 130 120 190 164 150" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="7 6"/><path d="M150 34 L166 50" stroke="${a}" stroke-width="4" stroke-linecap="round"/><circle cx="152" cy="36" r="3" fill="${b}"/>`,
  dome: ([a, b, c]) => `<circle cx="100" cy="100" r="92" fill="${c}"/><path d="M34 128 C34 70 64 42 104 42 C144 42 170 74 170 110 C170 122 164 128 152 128 Z" fill="${a}"/><path d="M34 128 L160 128" stroke="${b}" stroke-width="8" stroke-linecap="round"/><path d="M78 60 C92 54 112 54 126 60 M70 82 C92 72 118 72 140 82" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/><text x="100" y="168" font-family='${FONTS.round}' font-weight="900" font-size="26" fill="${a}" text-anchor="middle">chopf</text>`,
  horizon: ([a, b, c]) => `<circle cx="100" cy="100" r="92" fill="${a}"/><path d="M34 118 L78 58 L96 82 L118 46 L166 118 Z" fill="${c}"/><path d="M70 69 L78 58 L86 69 L82 72 L78 67 L74 72 Z M110 57 L118 46 L127 60 L121 62 L118 57 L114 62 Z" fill="#f2eff6"/><path d="M24 118 L176 118" stroke="${b}" stroke-width="5"/><path d="M30 134 C60 126 90 142 120 134 C140 128 160 136 172 132 M40 152 C70 146 100 160 130 150 C146 146 156 150 162 150" fill="none" stroke="${b}" stroke-width="5" stroke-linecap="round"/>`
}
export function markSVG(brand, size = 64) {
  const draw = MARKS[brand.mark] ?? MARKS.screw
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-label="${esc(brand.name)} mark">${draw(brand.colours)}</svg>`
}

// ---------------------------------------------------------------- wordmarks (canvas): the shop's text logos and the frame decals
function stitchWord(ctx, word, x, y, cell, colour) {
  ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1.2, cell * 0.22); ctx.lineCap = 'round'
  let cx = x
  for (const ch of word) {
    const g = STITCH[ch]
    if (g) for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q] === '1') { const X = cx + q * cell + cell / 2, Y = y + r * cell + cell / 2, h = cell * 0.36; ctx.beginPath(); ctx.moveTo(X - h, Y - h); ctx.lineTo(X + h, Y + h); ctx.moveTo(X + h, Y - h); ctx.lineTo(X - h, Y + h); ctx.stroke() }
    cx += 6 * cell
  }
  return cx - x - cell
}
// draws the maker's wordmark centred in (w, h); colour is one ink (decals are white, tinted by the shader)
export function drawWordmark(ctx, brand, w, h, colour) {
  ctx.save()
  ctx.fillStyle = colour; ctx.strokeStyle = colour
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const mid = h / 2, fit = (txt, font, max) => { let s = h; do { ctx.font = font.replace('$', s); s -= 1 } while (ctx.measureText(txt).width > max && s > 6); return s }
  switch (brand.id) {
    case 'foehnwerk': { const s = fit('FÖHNWERK', 'italic 900 $px ' + FONTS.grotesk, w * 0.86); ctx.setTransform(1, 0, -0.18, 1, mid * 0.18, 0); ctx.fillText('FÖHNWERK', w / 2, mid - s * 0.06); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath(); ctx.moveTo(w * 0.1, mid + s * 0.46); ctx.quadraticCurveTo(w * 0.5, mid + s * 0.28, w * 0.94, mid + s * 0.3); ctx.quadraticCurveTo(w * 0.5, mid + s * 0.4, w * 0.1, mid + s * 0.52); ctx.fill(); break }
    case 'gaemsli': fit('gämsli', '700 $px ' + FONTS.round, w * 0.8); ctx.fillText('gämsli', w / 2, mid); break
    case 'hartlot': { const s = fit('HARTLOT', '700 $px ' + FONTS.didone, w * 0.72); ctx.fillText('HARTLOT', w / 2, mid - s * 0.12); ctx.font = `${Math.round(s * 0.26)}px ${FONTS.serif}`; ctx.letterSpacing = `${Math.round(s * 0.08)}px`; ctx.fillText('R A H M E N B A U', w / 2, mid + s * 0.46); break }
    case 'murmeli': fit('MURMELI', '800 $px ' + FONTS.futura, w * 0.84); ctx.fillText('MURMELI', w / 2, mid); break
    case 'hemmung': { fit('H E M M U N G', '300 $px ' + FONTS.futura, w * 0.9); ctx.fillText('H E M M U N G', w / 2, mid); break }
    case 'rundlauf': { const s = fit('RUNDLAUF', '800 $px ' + FONTS.futura, w * 0.86); ctx.fillText('RUNDLAUF', w / 2, mid); ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(0, mid - s * 0.05, w, Math.max(1.5, s * 0.08)); break }
    case 'korkleder': fit('Kork & Leder', 'italic 600 $px ' + FONTS.serif, w * 0.84); ctx.fillText('Kork & Leder', w / 2, mid); break
    case 'tueftelwerk': { const s = fit('tüftelwerk.', '600 $px ' + FONTS.mono, w * 0.86); ctx.fillText('tüftelwerk', w / 2 - s * 0.2, mid); ctx.beginPath(); ctx.arc(w / 2 + ctx.measureText('tüftelwerk').width / 2 - s * 0.05, mid + s * 0.18, s * 0.12, 0, Math.PI * 2); ctx.fill(); break }
    case 'lismer': { const cell = Math.min(h / 9, w / 38); const tw = 6 * 6 * cell - cell; stitchWord(ctx, 'LISMER', (w - tw) / 2, mid - 3.5 * cell, cell, colour); break }
    case 'zwirn': { const s = fit('ZWIRN', '800 $px ' + FONTS.grotesk, w * 0.6); ctx.globalAlpha = 0.5; ctx.fillText('ZWIRN', w / 2, mid); ctx.globalAlpha = 1; ctx.lineWidth = Math.max(2, s * 0.08); ctx.setLineDash([s * 0.12, s * 0.07]); ctx.strokeText('ZWIRN', w / 2, mid); ctx.setLineDash([]); break }
    case 'chopf': fit('chopf', '900 $px ' + FONTS.round, w * 0.6); ctx.fillText('chopf', w / 2, mid); break
    case 'nebelmeer': { const s = fit('N E B E L M E E R', '300 $px ' + FONTS.futura, w * 0.9); ctx.fillText('N E B E L M E E R', w / 2, mid - s * 0.12); ctx.fillRect(w * 0.08, mid + s * 0.42, w * 0.84, Math.max(1, s * 0.05)); ctx.font = `${Math.round(s * 0.3)}px ${FONTS.futura}`; ctx.fillText('O P T I K', w / 2, mid + s * 0.72); break }
    default: fit(brand.name, '700 $px ' + FONTS.grotesk, w * 0.86); ctx.fillText(brand.name, w / 2, mid)
  }
  ctx.restore()
}
export function wordmarkCanvas(brand, w = 512, h = 96, colour = '#ffffff') {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  drawWordmark(c.getContext('2d'), brand, w, h, colour)
  return c
}
export const BRAND_FONTS = FONTS
