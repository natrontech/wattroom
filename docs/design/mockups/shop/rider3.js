// Rider & bike studio v3 — a procedural cyclist on a procedural bike, ONE SkinnedMesh (one draw call) per rider,
// posed on the CPU from data; no keyframes. Research build for WattRoom Ride Worlds (M11, M15 garage).
// v3: every shop slot of the research outline (39 slots, catalogue.json wardrobe/3) is swappable and visible:
// frames, finishes, forks, wheels, hubs, tyres, groupsets, cranks, rings, pedals, saddles, cockpits, tape,
// bottles, cages, computers, lights, bells, bags, fenders, charms; jerseys, cuts, layers, bibs, warmers, socks,
// shoes, overshoes, gloves, helmets, helmet decoration, eyewear, lenses, caps, race numbers, armbands, hair.
//
// Drop-in successor of cyclist-spec/model.js: the 18 bone names keep their order and meaning (fork, handL, handR
// are appended), and makeRider(hue, lod, material) / paint(geo, paletteFor(hue)) / pose(mesh, {crank, wheel,
// stand, rock, rockBody, nod}) / riderMaterial / buildGeometry keep their signatures (qa.mjs G21 runs that exact
// call pattern). New code should drive riders through the animator instead:
//
//   const mesh = buildRider(resolveLoadout(loadout, catalogue), catalogue)   // bike, body and kit from data
//   const anim = new RiderAnimator(mesh, { seed, remote })                   // per rider
//   pose(mesh, anim.update(dt, { cadence, power, ftp, speed, grade, curvature, sprint }))   // every frame
//
// Host notes for world-proto Riders.svelte: pitch the rider group by the FULL road grade (not 0.6×), or leave it
// level and let the animator's `pitch` do it; wheel spin comes from speed / rig.wheelR (not 0.34); the legs only
// move when cadence ≥ 5 or power ≥ 20 W (SPEC.md:468) and never backwards.
//
// Conventions (bike space, metres): +X forward, +Y up, +Z to the rider's right; origin on the ground under the
// bottom bracket. Crank angle `a` is the right crank measured from 3 o'clock, positive = forward pedalling
// (a = π/2 is bottom dead centre); theta = a + π/2 is the right crank measured from top dead centre.
import * as THREE from 'three'

const DEG = Math.PI / 180
const TAU = Math.PI * 2
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const lerp = (a, b, t) => a + (b - a) * t
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const fin = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const X_ = V(1, 0, 0), Y_ = V(0, 1, 0), Z_ = V(0, 0, 1)
const A0 = [0, 0, 0]

// ---------------------------------------------------------------- contract
export const BONES = ['root', 'bike', 'frontWheel', 'rearWheel', 'crank', 'pelvis', 'torso', 'head', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'armL', 'foreL', 'armR', 'foreR',
  /* v2, appended so indices 0..17 keep their meaning */ 'fork', 'handL', 'handR']
const B = Object.fromEntries(BONES.map((n, i) => [n, i]))
export const SLOTS = ['jersey', 'jerseyAccent', 'helmet', 'skin', 'shorts', 'shoe', 'frame', 'tyre', 'rim', 'metal', 'glasses',
  /* v2 */ 'frameAccent', 'sock', 'glove', 'helmetAccent', 'lens', 'saddle', 'barTape', 'groupset', 'bottle', 'sole', 'spokes', 'hair', 'shortsAccent', 'tyreWall', 'bottleCap', 'hood', 'chain', 'sockAccent', 'leather',
  /* v3 */ 'pedal', 'warmer', 'layer', 'layerAccent', 'cap', 'capAccent', 'screen', 'bag', 'bagAccent', 'logo', 'overshoe', 'plate', 'armband', 'charm', 'lightF', 'lightR', 'brass', 'flower', 'foliage', 'cork', 'chrome', 'anodised']
const S = Object.fromEntries(SLOTS.map((n, i) => [n, i]))
// pattern spaces (aux.x): which fragment rule paints a vertex
const SP = { none: 0, torso: 1, sleeve: 2, decal: 3, spokes: 4, blades: 5, leg: 6, tape: 7, logo: 8, tread: 9, plate: 10, ringcut: 11, helmet: 12, cap: 13, saddle: 14, bag: 15 }
// shader enums: the index is the GLSL int (order is the contract; append only)
export const PATTERNS = ['plain', 'hoops', 'sash', 'stripes', 'gradient', 'yoke', 'sidepanel', 'chevron', 'gipfelpunkte', 'pinstripe', 'crew', 'blocks', 'karo', 'topo', 'stickerei', 'edelweiss', 'jass', 'scherenschnitt', 'sprinter', 'nebelkit', 'raeppli']
export const SOCK_PATTERNS = ['plain', 'stripe', 'nordic', 'jass', 'edelweiss', 'karo', 'z6', 'metronome', 'spring', 'profile']
export const FINISHES = ['matte', 'gloss', 'satin', 'metallic', 'carbon', 'fade', 'chrome', 'teamlack', 'rings']
export const TAPES = ['plain', 'cork', 'leather', 'perforated', 'cloth', 'twotone']
export const CAP_PATTERNS = ['plain', 'knit', 'check', 'stripes', 'band', 'trim', 'faded', 'profile']
export const LAYERS = ['none', 'gilet', 'rain', 'winter', 'solstice']
export const SHORTS_PATTERNS = ['plain', 'side', 'gripper', 'stripe', 'wool']
export const SADDLE_PATTERNS = ['plain', 'cutout', 'lattice', 'suede']
export const CUTS = ['race', 'club', 'wool', 'skinsuit']
const DECALS = { none: 0, logo: 1, band: 2, grooves: 3 }

// ---------------------------------------------------------------- colour (OKLCH, for identity hues and the kit guard)
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
export function hexToOklch(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = toLin(((n >> 16) & 255) / 255), g = toLin(((n >> 8) & 255) / 255), b = toLin((n & 255) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, Bb), h: ((Math.atan2(Bb, A) / DEG) % 360 + 360) % 360, a: A, b: Bb }
}
function oklchToRgb(L, C, h) {
  const a = C * Math.cos(h * DEG), b = C * Math.sin(h * DEG)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}
export function oklchToHex(L, C, h) {
  let c = C, rgb = oklchToRgb(L, c, h)
  for (let i = 0; i < 24 && rgb.some((x) => x < -1e-4 || x > 1.0001); i++) { c *= 0.9; rgb = oklchToRgb(L, c, h) } // gamut: shed chroma, keep hue and lightness
  return '#' + rgb.map((x) => Math.round(clamp(toSrgb(clamp(x, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0')).join('')
}
export const deltaEok = (x, y) => { const p = hexToOklch(x), q = hexToOklch(y); return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b) }
const WATT = { hex: '#ff3d8b', h: hexToOklch('#ff3d8b').h }
// Identity hue from anything, remapped out of ±24° of --color-watt (ADR-0005: watt is live data only).
export const safeHue = (h) => { if (MUT.has('hueWatt')) return ((h % 360) + 360) % 360; const d = ((((h - WATT.h) % 360) + 540) % 360) - 180; return Math.abs(d) >= 24 ? ((h % 360) + 360) % 360 : (WATT.h + Math.sign(d || 1) * 24 + 360) % 360 }

// ---------------------------------------------------------------- tiny profile curve (C1 cubic Hermite through knots)
function curve(pts) {
  const n = pts.length
  return (t) => {
    if (t <= pts[0][0]) return pts[0][1]
    if (t >= pts[n - 1][0]) return pts[n - 1][1]
    let i = 0
    while (t > pts[i + 1][0]) i++
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1], h = t1 - t0, u = (t - t0) / h
    const m0 = i > 0 ? (v1 - pts[i - 1][1]) / (t1 - pts[i - 1][0]) : (v1 - v0) / h
    const m1 = i < n - 2 ? (pts[i + 2][1] - v0) / (pts[i + 2][0] - t0) : (v1 - v0) / h
    const u2 = u * u, u3 = u2 * u
    return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * m1
  }
}
// QA only (node): RIDER_MUTATE=crank90,standTall,… re-injects known bugs so qa-mutants.mjs can prove every gate bites.
const MUT = new Set(String(globalThis.process?.env?.RIDER_MUTATE ?? '').split(',').filter(Boolean))
const smin = (a, b, k) => { const m = Math.min(a, b); return m - k * Math.log(Math.exp((m - a) / k) + Math.exp((m - b) / k)) } // smooth min
const mulberry = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

// ---------------------------------------------------------------- body, bike geometry, fit
export const BUILDS = { slim: 0.9, athletic: 1.0, strong: 1.12 }
export function riderDims(body = {}) {
  const H = clamp(fin(body.height, 1.8), 1.5, 2.05), k = H / 1.8
  const b = BUILDS[body.build] ?? 1
  return {
    H, k, b,
    thigh: 0.44 * k, shin: 0.445 * k, torso: 0.5 * k, upperArm: 0.3 * k, foreArm: 0.255 * k,
    hipHalf: 0.087 * k * (0.96 + 0.04 * b), shoulderHalf: 0.18 * k * (0.93 + 0.07 * b),
    cleat: V(0.115 * k, -(0.075 * k + 0.012), 0), // pedal spindle centre in foot-local (foot origin = ankle joint)
    grip: V(0.068 * k, -0.04 * k, 0), // grip centre in hand-local (hand origin = wrist): inside the finger hook
    sit: V(-0.03 * k, -0.092 * k, 0) // sit-bone contact in pelvis-local (pelvis origin = hip-joint centre)
  }
}
// Pedal angle (toe-down, rad) from the crank angle measured from TDC: flattest early in the downstroke.
export const toeDown = (theta) => (12 - 11 * Math.cos(theta - 75 * DEG)) * DEG
const kneeReach = (d, flexDeg) => Math.sqrt(d.thigh ** 2 + d.shin ** 2 + 2 * d.thigh * d.shin * Math.cos(flexDeg * DEG))
export const PELVIS_TILT = 0.35 // share of the torso's forward lean the pelvis takes
export const REST_FLEX = { knee: 70 * DEG, elbow: 40 * DEG } // bind pose of the smooth-skinned joints: mid-range keeps linear blend skinning honest

export function bikeGeometry(frame, tyre, k = 1) {
  const g = frame.geometry
  const s = k // frame size follows the rider (standover scales with the inseam); wheels do not
  const tw = tyre.widthMm / 1000
  const Rb = (g.bead ?? 622) / 2000 // ISO bead seat radius: 622 (700C), 584 (650B)
  const R = Rb + (tyre.casing === 'tubular' ? 1.0 : 0.95) * tw // bead seat + tyre height
  const rt = tw * 0.56 // tyre tube radius as drawn
  const drop = g.bbDrop / 1000, cs = g.chainstay / 1000
  const bb = V(0, R - drop, 0)
  const rear = V(-Math.sqrt(cs * cs - drop * drop), R, 0)
  const hta = g.hta * DEG, sta = g.sta * DEG
  const htTop = V((g.reach / 1000) * s + (MUT.has('geomDrift') ? 0.005 : 0), bb.y + (g.stack / 1000) * s, 0)
  const down = V(Math.cos(hta), -Math.sin(hta), 0) // down the steering axis
  const htBot = htTop.clone().addScaledVector(down, (g.headTube / 1000) * s)
  const tAx = (htTop.y - R) / Math.sin(hta)
  const front = V(htTop.x + tAx * down.x + g.forkOffset / 1000 / Math.sin(hta), R, 0)
  const stDir = V(-Math.cos(sta), Math.sin(sta), 0)
  const ttFront = htTop.clone().addScaledVector(down, (g.ttDrop ?? 24) / 1000).add(V(0, MUT.has('ttHigh') ? 0.09 : 0, 0)) // where the top tube meets the head tube
  const clusterLen = g.topTube === 'level' ? (ttFront.y - bb.y) / Math.sin(sta) : (g.seatTube / 1000) * s
  const cluster = bb.clone().addScaledVector(stDir, clusterLen)
  const dtFront = htBot.clone().addScaledVector(down, -0.032)
  return { R, Rb, rt, tw, bb, rear, front, htTop, htBot, down, up: down.clone().negate(), hta, sta, stDir, cluster, clusterLen, ttFront, dtFront, size: s, wheelbase: front.x - rear.x }
}

// Grip centres relative to the bar clamp, and the right hand's orientation (fwd = knuckles, up = back of hand).
const BARS = {
  drop: { hoods: [0.105, 0.028, 0.2], drops: [-0.005, -0.118, 0.2], tops: [0.0, 0.006, 0.11], width: 0.2 },
  aero: { hoods: [0.105, 0.03, 0.2], drops: [-0.005, -0.115, 0.2], tops: [0.012, 0.012, 0.12], width: 0.2 },
  flare: { hoods: [0.098, 0.026, 0.2], drops: [-0.01, -0.108, 0.245], tops: [0.0, 0.006, 0.11], width: 0.2 },
  track: { hoods: [0.072, -0.01, 0.19], drops: [-0.03, -0.14, 0.195], tops: [0.0, 0.005, 0.1], width: 0.19 },
  tt: { hoods: [0.15, -0.024, 0.2], drops: [0.15, -0.024, 0.2], tops: [0.02, 0.004, 0.1], width: 0.2 },
  bullhorn: { hoods: [0.142, 0.03, 0.19], drops: [0.142, 0.03, 0.19], tops: [0.0, 0.006, 0.11], width: 0.19 },
  upright: { hoods: [-0.155, 0.07, 0.262], drops: [-0.155, 0.07, 0.262], tops: [-0.155, 0.07, 0.262], width: 0.27 }
}
const HANDS = {
  hoods: { fwd: [1, 0.3, -0.06], up: [0, 0.88, 0.47] },
  drops: { fwd: [1, -0.32, 0.04], up: [0.1, 0.36, 0.93] },
  tops: { fwd: [0.25, -0.12, -1], up: [0.22, 0.97, 0.05] },
  aero: { fwd: [1, 0.22, -0.05], up: [0, 0.22, 1] },
  base: { fwd: [1, 0.06, 0], up: [0, 0.76, 0.65] },
  bend: { fwd: [1, 0.12, 0], up: [0, 0.86, 0.5] },
  upright: { fwd: [0.86, -0.34, 0.2], up: [0.22, 0.86, 0.46] }
}
function handQuat(h, side) {
  const x = V(h.fwd[0], h.fwd[1], h.fwd[2] * side).normalize()
  const y = V(h.up[0], h.up[1], h.up[2] * side)
  y.addScaledVector(x, -y.dot(x)).normalize()
  const z = V().crossVectors(x, y)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

// Circle-circle intersection in the XY plane, upper solution (fallbacks keep it finite).
function circles(c1, r1, c2, r2, out) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y, d = Math.max(Math.hypot(dx, dy), 1e-6)
  const ux = dx / d, uy = dy / d
  if (d >= r1 + r2) return out.set(c1.x + ux * r1, c1.y + uy * r1, 0) // too far: reach along the line
  if (d <= Math.abs(r1 - r2)) return out.set(c1.x - uy * r1, c1.y + ux * r1, 0)
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(r1 * r1 - a * a, 0))
  const px = c1.x + ux * a, py = c1.y + uy * a
  const y1 = py + ux * h, y2 = py - ux * h
  return y1 >= y2 ? out.set(px - uy * h, y1, 0) : out.set(px + uy * h, y2, 0)
}

export const barKey = (style) => (style === 'clipon' ? 'drop' : style) // clip-ons ride on a round drop bar
export function fitRider(d, bk, frame, barStyleIn, crankMm = null) {
  const barStyle = barKey(barStyleIn)
  const crank = crankMm ? clamp(crankMm, 165, 175) / 1000 : 0.1725 * (d.k < 0.95 ? 0.986 : d.k > 1.05 ? 1.014 : 1) // 170 / 172.5 / 175 mm
  const pedalZ = (barStyle === 'upright' ? 0.14 : 0.127) + Math.max(0, d.k - 1) * 0.04
  const cp = frame.cockpit
  // Saddle height: knee flexion 35° at bottom dead centre (cleat on the spindle, pedal at its BDC angle).
  const off = d.cleat.clone().applyAxisAngle(Z_, -toeDown(Math.PI))
  const ankle = V(bk.bb.x, bk.bb.y - crank, 0).sub(off)
  const alpha = cp.torsoDeg * DEG
  const tilt = PELVIS_TILT * (Math.PI / 2 - alpha)
  const sit = d.sit.clone().applyAxisAngle(Z_, -tilt)
  const reach = kneeReach(d, MUT.has('saddleHigh') ? 18 : MUT.has('saddleDown') ? 52 : 35)
  const q = bk.bb.clone().sub(sit).sub(ankle)
  const bq = q.dot(bk.stDir), cq = q.lengthSq() - reach * reach
  const L = -bq + Math.sqrt(Math.max(bq * bq - cq, 0))
  const contact = bk.bb.clone().addScaledVector(bk.stDir, L)
  const hipSeat = contact.clone().sub(sit)
  // Standing: hips ~0.16 m forward; height set by knee flexion (never straighter than 20° over a revolution).
  const standX = hipSeat.x + (barStyle === 'tt' ? 0.1 : 0.16) * d.k
  const dMax = kneeReach(d, 20)
  let standY = Infinity
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU, th = a + Math.PI / 2
    const o = d.cleat.clone().applyAxisAngle(Z_, -(toeDown(th) + 8 * DEG))
    const an = V(bk.bb.x + crank * Math.cos(a), bk.bb.y - crank * Math.sin(a), 0).sub(o)
    const dx = an.x - standX
    standY = Math.min(standY, an.y + Math.sqrt(Math.max(dMax * dMax - dx * dx, 0)))
  }
  const hipStand = V(standX, Math.min(standY, hipSeat.y + 0.07 * d.k), 0)
  // Cockpit: shoulder from the torso angle, hands from the arm angle, then spacers + stem solved to put the bars there.
  const T = d.torso, u = d.upperArm, f = d.foreArm
  const Sh = hipSeat.clone().add(V(Math.cos(alpha) * T, Math.sin(alpha) * T, 0))
  const armA = alpha - cp.shoulderDeg * DEG
  const Dw = Math.sqrt(u * u + f * f + 2 * u * f * Math.cos(18 * DEG))
  const bar = BARS[barStyle] ?? BARS.drop
  let target, pad = null, ext = null
  if (barStyle === 'tt') {
    const Sa = hipSeat.clone().add(V(Math.cos(alpha) * T, Math.sin(alpha) * T, 0))
    const elbow = Sa.clone().add(V(Math.cos(-78 * DEG) * u, Math.sin(-78 * DEG) * u, 0))
    const dir = V(Math.cos(11 * DEG), Math.sin(11 * DEG), 0)
    const wrist = elbow.clone().addScaledVector(dir, f)
    pad = elbow.clone().add(V(0.0, -0.047 * d.k, 0))
    ext = { elbow, wrist, dir }
    target = pad.clone().add(V(-0.03, -0.075, 0)) // base-bar clamp sits under the pads on 7.5 cm risers
  } else {
    const G = Sh.clone().add(V(Math.cos(armA), Math.sin(armA), 0).multiplyScalar(Dw + 0.055 * d.k))
    target = G.sub(V(bar.hoods[0], bar.hoods[1], 0))
  }
  const a = bk.up, n = V(Math.sin(bk.hta), Math.cos(bk.hta), 0).applyAxisAngle(Z_, (cp.stemDeg ?? -6) * DEG)
  const rhs = target.clone().sub(bk.htTop)
  const det = a.x * n.y - a.y * n.x
  let sp = (rhs.x * n.y - rhs.y * n.x) / det, stem = (a.x * rhs.y - a.y * rhs.x) / det
  sp = clamp(sp, cp.spacer[0], cp.spacer[1]); stem = clamp(stem, cp.stem[0], cp.stem[1])
  const steererTop = bk.htTop.clone().addScaledVector(a, sp)
  const clampPt = steererTop.clone().addScaledVector(n, stem)
  // grips (right side; left mirrors z)
  const grips = {}
  const mk = (p, hand) => ({ R: { p: V(p[0], p[1], p[2]), q: handQuat(HANDS[hand], 1) }, L: { p: V(p[0], p[1], -p[2]), q: handQuat(HANDS[hand], -1) } })
  const at = (o) => [clampPt.x + o[0], clampPt.y + o[1], o[2]]
  if (barStyle === 'upright') {
    grips.hoods = mk(at(bar.hoods), 'upright')
  } else if (barStyle === 'tt') {
    grips.hoods = mk(at(bar.hoods), 'base')
    grips.tops = mk(at(bar.tops), 'tops')
    const hq = handQuat(HANDS.aero, 1)
    const tipR = ext.wrist.clone().add(d.grip.clone().applyQuaternion(hq))
    grips.aero = mk([tipR.x, tipR.y, 0.062], 'aero')
    grips.aero.R.p.z = 0.062; grips.aero.L.p.z = -0.062
  } else {
    grips.hoods = mk(at(bar.hoods), barStyle === 'track' ? 'bend' : 'hoods')
    grips.drops = mk(at(bar.drops), barStyle === 'bullhorn' ? 'hoods' : 'drops') // bullhorn: the sprint grip is the horn tip
    grips.tops = mk(at(bar.tops), 'tops')
  }
  if (MUT.has('saddleLow')) contact.y -= 0.03
  return { crank, pedalZ: MUT.has('narrowQ') ? 0.085 : pedalZ, contact, hipSeat, hipStand, saddleLen: L, steererTop, spacer: sp, stem, stemDir: n, clampPt, grips, pad, ext, alpha }
}

// ---------------------------------------------------------------- mesh builder
class MB {
  constructor(rest, lod) { this.rest = rest; this.lod = lod; this.P = []; this.N = []; this.SI = []; this.SW = []; this.SL = []; this.PC = []; this.AX = []; this.I = []; this.acc = {}; this.meta = { parts: {} }; this.detail = 1 }
  // vertex ranges of named parts, for the QA gates (clearances between parts that share no bone)
  tag(name, fn) { const v0 = this.n; const r = fn(); (this.meta.parts[name] ??= []).push([v0, this.n]); return r }
  // small accessories share a LOD0 pool and drop at LOD1 (qa G19c reports the pool)
  sg(n, min = 3) { return this.lod ? Math.max(min, Math.round(n * 0.6)) : n } // LOD-aware segment count for fixed primitives
  accessory(name, fn) { if (this.lod) return; const t0 = this.I.length; fn(); this.acc[name] = (this.acc[name] ?? 0) + (this.I.length - t0) / 3 }
  get n() { return this.P.length / 3 }
  vert(p, nr, bones, w, slot, pc, aux = A0) {
    this.P.push(p.x, p.y, p.z); this.N.push(nr.x, nr.y, nr.z)
    this.SI.push(bones[0] ?? 0, bones[1] ?? 0, 0, 0); this.SW.push(w[0] ?? 1, w[1] ?? 0, 0, 0)
    this.SL.push(slot); this.PC.push(pc.x, pc.y, pc.z); this.AX.push(aux[0], aux[1], aux[2])
    return this.n - 1
  }
  // A THREE geometry authored in bone-local space (optionally placed by m).
  geo(g, bone, slot, m = null, o = {}) {
    const pos = g.attributes.position
    if (!g.attributes.normal) g.computeVertexNormals()
    const nor = g.attributes.normal
    const M = m ? m.clone() : new THREE.Matrix4()
    const R = this.rest[bone], full = R.clone().multiply(M), nm = new THREE.Matrix3().getNormalMatrix(full)
    const flip = M.determinant() < 0
    const base = this.n, lp = V(), wp = V(), nn = V()
    for (let i = 0; i < pos.count; i++) {
      lp.fromBufferAttribute(pos, i).applyMatrix4(M)
      wp.copy(lp).applyMatrix4(R)
      nn.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize()
      const wv = o.weights ? o.weights(wp) : null
      this.vert(wp, nn, wv ? wv[0] : [bone], wv ? wv[1] : [1], typeof slot === 'function' ? slot(lp) : slot, o.pc ? o.pc(lp) : lp, o.aux ?? A0)
    }
    const idx = g.index, cnt = idx ? idx.count : pos.count, get = idx ? (i) => idx.getX(i) : (i) => i
    for (let i = 0; i < cnt; i += 3) {
      const a = base + get(i), b = base + get(i + 1), c = base + get(i + 2)
      if (flip) this.I.push(a, c, b); else this.I.push(a, b, c)
    }
    g.dispose()
  }
  // Rings of equal size joined into a skin. ring: {pts: V3[] (rest space), c: V3 centre, bones, w, slot, pc: V3[]|null, aux, seam}
  loft(rings, o = {}) {
    const sides = rings[0].pts.length, base = [], acc = []
    for (const r of rings) {
      base.push(this.n)
      for (let j = 0; j < sides; j++) { this.vert(r.pts[j], Z_, r.bones, r.w, r.slot, r.pc ? r.pc[j] : r.pts[j], r.aux ?? A0); acc.push(V()) }
    }
    const first = base[0], fn = V(), e1 = V(), e2 = V(), cen = V(), mid = V()
    const P = (i) => V(this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2])
    const face = (a, b, c, out) => {
      const pa = P(a), pb = P(b), pc = P(c)
      fn.crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa))
      cen.copy(pa).add(pb).add(pc).divideScalar(3)
      if (fn.dot(cen.sub(out)) < 0) { this.I.push(a, c, b); fn.negate() } else this.I.push(a, b, c)
      for (const v of [a, b, c]) acc[v - first].add(fn)
    }
    for (let i = 0; i + 1 < rings.length; i++) {
      if (rings[i + 1].seam) continue
      mid.copy(rings[i].c).add(rings[i + 1].c).multiplyScalar(0.5)
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides
        const a = base[i] + j, b = base[i] + j1, c = base[i + 1] + j1, d = base[i + 1] + j
        face(a, b, c, mid); face(a, c, d, mid)
      }
    }
    const cap = (ri, pole, inside) => {
      const ci = this.vert(pole, Z_, rings[ri].bones, rings[ri].w, rings[ri].slot, o.capPc ? o.capPc(pole) : pole, rings[ri].aux ?? A0); acc.push(V())
      for (let j = 0; j < sides; j++) face(base[ri] + j, base[ri] + ((j + 1) % sides), ci, inside)
    }
    if (o.capStart) cap(0, o.capStart, rings[1].c)
    if (o.capEnd) cap(rings.length - 1, o.capEnd, rings[rings.length - 2].c)
    // seam duplicates share their normals so colour edges do not crease the shading
    for (let i = 1; i < rings.length; i++) if (rings[i].seam) for (let j = 0; j < sides; j++) {
      const a = acc[base[i - 1] - first + j], b = acc[base[i] - first + j], s = a.clone().add(b); a.copy(s); b.copy(s)
    }
    for (let v = 0; v < acc.length; v++) {
      const nrm = acc[v].lengthSq() > 1e-20 ? acc[v].normalize() : Y_
      this.N[(first + v) * 3] = nrm.x; this.N[(first + v) * 3 + 1] = nrm.y; this.N[(first + v) * 3 + 2] = nrm.z
    }
  }
  // Revolve a (rho, z) profile about local Z (wheels, discs, hubs, bottles). prof: [{r, z, slot, aux}] closed or open.
  revolve(prof, bone, o = {}) {
    const seg = Math.max(6, Math.round((o.segments ?? 32) * this.detail)), m = o.m ?? null
    const R = this.rest[bone].clone().multiply(m ?? new THREE.Matrix4()), nm = new THREE.Matrix3().getNormalMatrix(R)
    const np = prof.length, cz = prof.reduce((s, p) => s + p.z, 0) / np, cr = prof.reduce((s, p) => s + p.r, 0) / np
    const n2 = prof.map((p, i) => {
      if (p.n) return p.n
      const prev = i > 0 && !(Math.abs(prof[i - 1].r - p.r) < 1e-7 && Math.abs(prof[i - 1].z - p.z) < 1e-7) ? prof[i - 1] : o.closed && i === 0 ? prof[np - 1] : p
      const next = i < np - 1 && !(Math.abs(prof[i + 1].r - p.r) < 1e-7 && Math.abs(prof[i + 1].z - p.z) < 1e-7) ? prof[i + 1] : o.closed && i === np - 1 ? prof[0] : p
      let tr = next.r - prev.r, tz = next.z - prev.z
      if (Math.hypot(tr, tz) < 1e-9) { tr = 1; tz = 0 }
      let nr = tz, nz = -tr
      const outR = o.outward ? o.outward(p)[0] : p.r - cr, outZ = o.outward ? o.outward(p)[1] : p.z - cz
      if (nr * outR + nz * outZ < 0) { nr = -nr; nz = -nz }
      const l = Math.hypot(nr, nz)
      return [nr / l, nz / l]
    })
    const base = this.n, lp = V(), wp = V(), nn = V()
    for (let s = 0; s < seg; s++) {
      const ph = (s / seg) * TAU + (o.phase ?? 0), c = Math.cos(ph), sn = Math.sin(ph)
      for (let i = 0; i < np; i++) {
        const p = prof[i]
        lp.set(p.r * c, p.r * sn, p.z)
        if (m) lp.applyMatrix4(m)
        wp.copy(lp).applyMatrix4(this.rest[bone])
        nn.set(n2[i][0] * c, n2[i][0] * sn, n2[i][1]).applyMatrix3(nm).normalize()
        this.vert(wp, nn, [bone], [1], p.slot, V(p.r * c, p.r * sn, p.z), p.aux ?? o.aux ?? A0)
      }
    }
    const e = o.closed ? np : np - 1
    for (let s = 0; s < seg; s++) for (let i = 0; i < e; i++) {
      const i1 = (i + 1) % np
      if (Math.abs(prof[i].r - prof[i1].r) < 1e-7 && Math.abs(prof[i].z - prof[i1].z) < 1e-7) continue
      const s1 = (s + 1) % seg
      const a = base + s * np + i, b = base + s1 * np + i, c = base + s1 * np + i1, d = base + s * np + i1
      this.orient(a, b, c); this.orient(a, c, d)
    }
  }
  // push a triangle facing along its vertices' normals
  orient(a, b, c) {
    const p = (i) => V(this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2]), nv = (i) => V(this.N[i * 3], this.N[i * 3 + 1], this.N[i * 3 + 2])
    const f = V().crossVectors(p(b).sub(p(a)), p(c).sub(p(a)))
    if (f.dot(nv(a).add(nv(b)).add(nv(c))) < 0) this.I.push(a, c, b); else this.I.push(a, b, c)
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3))
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4))
    g.setAttribute('slot', new THREE.Float32BufferAttribute(this.SL, 1))
    g.setAttribute('pc', new THREE.Float32BufferAttribute(this.PC, 3))
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.AX, 3))
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1))
    g.boundingSphere = new THREE.Sphere(V(0.1, 0.9, 0), 1.6)
    return g
  }
}

// Sweep a cross-section along a Catmull-Rom path (bone-local points). Parallel-transport frames; `ref` fixes the first frame's normal.
function sweep(mb, pts, o) {
  const bone = o.bone, R = mb.rest[bone]
  const q = (mb.lod ? 0.5 : 1) * mb.detail
  const sides = Math.max(4, Math.round((o.sides ?? 10) * q))
  const path = pts.length === 2 ? null : new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5)
  const nS = pts.length === 2 ? 1 : Math.max(2, Math.round((o.samples ?? pts.length * 4) * q))
  const at = (t) => (path ? path.getPoint(t) : pts[0].clone().lerp(pts[1], t))
  const tan = (t) => (path ? path.getTangent(t) : pts[1].clone().sub(pts[0]).normalize())
  let nrm = (o.ref ?? Z_).clone()
  const t0 = tan(0)
  nrm.addScaledVector(t0, -nrm.dot(t0))
  if (nrm.lengthSq() < 1e-8) nrm = V(0, 1, 0).addScaledVector(t0, -t0.y)
  nrm.normalize()
  const rings = []
  let prevT = t0
  const rad = typeof o.r === 'function' ? o.r : () => o.r
  const uvLen = o.uv ? (path ? path.getLength() : pts[0].distanceTo(pts[1])) : 0 // pc = (arc length, around) for wrapped patterns
  for (let i = 0; i <= nS; i++) {
    const t = i / nS, c = at(t), tg = tan(t)
    const ax = V().crossVectors(prevT, tg)
    if (ax.lengthSq() > 1e-12) nrm.applyAxisAngle(ax.normalize(), Math.acos(clamp(prevT.dot(tg), -1, 1)))
    nrm.addScaledVector(tg, -nrm.dot(tg)).normalize()
    prevT = tg
    const bin = V().crossVectors(tg, nrm)
    const r = rad(t), ra = Array.isArray(r) ? r[0] : r, rb = Array.isArray(r) ? r[1] : r
    const pl = [], pw = []
    for (let j = 0; j < sides; j++) {
      const ph = (j / sides) * TAU
      let cx = Math.cos(ph), cy = Math.sin(ph)
      if (o.shape === 'kamm') { if (cx < 0) cx *= 0.72; cy = Math.sign(cy) * Math.abs(cy) ** 0.8 }
      const p = c.clone().addScaledVector(nrm, cx * ra).addScaledVector(bin, cy * rb)
      pl.push(o.uv ? V(t * uvLen, j / sides, 0) : p.clone()); pw.push(p.applyMatrix4(R))
    }
    const cw = c.clone().applyMatrix4(R), wv = o.weights ? o.weights(cw) : null
    rings.push({ pts: pw, pc: pl, c: cw, bones: wv ? wv[0] : [bone], w: wv ? wv[1] : [1], slot: typeof o.slot === 'function' ? o.slot(t) : o.slot, aux: o.aux })
  }
  const tipS = at(0).clone().addScaledVector(t0, -0.0006), tipE = at(1).clone().addScaledVector(tan(1), 0.0006)
  mb.loft(rings, { capStart: o.cap !== false ? tipS.applyMatrix4(R) : null, capEnd: o.cap !== false ? tipE.applyMatrix4(R) : null })
}
const tube = (mb, a, b, r, o) => sweep(mb, [a, b], { ...o, r })

// Loft along a local axis with superellipse cross-sections (torso, pelvis, shoe, saddle).
// st: stations [{t, ...}]; shape(t) -> {c: V3 centre, u: V3 axis, v: V3 axis, ru+, ru-, rv, n}
function axisLoft(mb, stations, shape, bone, o = {}) {
  const sides = Math.max(8, Math.round((o.sides ?? 20) * (mb.lod ? 0.6 : 1) * mb.detail))
  const R = mb.rest[bone]
  const rings = stations.map((st) => {
    const sh = shape(st.t)
    const pl = [], pw = []
    for (let j = 0; j < sides; j++) {
      const ph = (j / sides) * TAU + (o.phase ?? 0), c = Math.cos(ph), s = Math.sin(ph)
      const e = 2 / (sh.n ?? 2.4)
      const cu = Math.sign(c) * Math.abs(c) ** e, sv = Math.sign(s) * Math.abs(s) ** e
      const p = sh.c.clone().addScaledVector(sh.u, cu * (c >= 0 ? sh.ruP : sh.ruN)).addScaledVector(sh.v, sv * (s >= 0 ? sh.rvP ?? sh.rv : sh.rvN ?? sh.rv))
      pl.push(o.pcOf ? o.pcOf(p) : p.clone()); pw.push(p.applyMatrix4(R))
    }
    const wv = o.weights ? o.weights(sh.c) : null
    return { pts: pw, pc: pl, c: sh.c.clone().applyMatrix4(R), bones: wv ? wv[0] : [bone], w: wv ? wv[1] : [1], slot: st.slot, aux: st.aux ?? o.aux, seam: st.seam }
  })
  mb.loft(rings, { capStart: o.capStart ? o.capStart.clone().applyMatrix4(R) : null, capEnd: o.capEnd ? o.capEnd.clone().applyMatrix4(R) : null })
}

const M4 = () => new THREE.Matrix4()
const TR = (x, y, z) => M4().makeTranslation(x, y, z)
const place = (pos, q, s = V(1, 1, 1)) => M4().compose(pos, q, s)
const qAxis = (ax, a) => new THREE.Quaternion().setFromAxisAngle(ax, a)
const qFromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize())
const sphere = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h)
const ell = (mb, bone, slot, c, rx, ry, rz, q = new THREE.Quaternion(), o = {}) => {
  const lod = (mb.lod ? 0.6 : 1) * mb.detail
  mb.geo(sphere(1, Math.max(6, Math.round((o.w ?? 12) * lod)), Math.max(4, Math.round((o.h ?? 8) * lod))), bone, slot, place(c, q, V(rx, ry, rz)), o)
}

// ---------------------------------------------------------------- rider body
// Two-bone limb as ONE smooth-skinned loft: rest pose bent at REST_FLEX, a ±band blend across the joint.
function limb(mb, o) {
  const { a, b, L1, L2, restFlex, band, prof, sides } = o
  const Fs = TR(0, -L1, 0).multiply(M4().makeRotationZ(-restFlex))
  const n = Math.max(8, Math.round(sides * (mb.lod ? 0.6 : 1) * mb.detail))
  const stations = o.stations
  const rings = []
  const pA = V(), pB = V(), off = V()
  for (const st of stations) {
    const s = st.s, w = sstep(L1 - band, L1 + band, s)
    const pr = prof(s)
    const pts = [], pcs = []
    for (let j = 0; j < n; j++) {
      const ph = (j / n) * TAU, c = Math.cos(ph), sn = Math.sin(ph)
      off.set(c * (c >= 0 ? pr.xP : pr.xN), 0, sn * pr.z)
      pA.set(0, -s, 0).add(off)
      pB.set(0, -(s - L1), 0).add(off).applyMatrix4(Fs)
      pts.push(pA.clone().lerp(pB, w))
      pcs.push(V(s / (L1 + L2), ph / TAU, o.side))
    }
    const cA = V(0, -s, 0), cB = V(0, -(s - L1), 0).applyMatrix4(Fs)
    rings.push({ pts, pc: pcs, c: cA.lerp(cB, w), bones: [a, b], w: [1 - w, w], slot: st.slot, aux: st.aux, seam: st.seam })
  }
  const last = stations[stations.length - 1].s, firstS = stations[0].s
  const endC = V(0, -(last - L1) - (o.capEnd ?? 0.004), 0).applyMatrix4(Fs)
  mb.loft(rings, { capStart: V(0, -firstS + 0.003, 0), capEnd: endC })
}
// stations with duplicated seams where the slot changes
function stationsFor(s0, s1, n, bands) {
  // bands: [{from, slot, aux}] sorted by from; returns stations covering [s0, s1] with seams at band edges
  const cuts = new Set()
  for (let i = 0; i <= n; i++) cuts.add(+(s0 + ((s1 - s0) * i) / n).toFixed(5))
  for (const b of bands) if (b.from > s0 && b.from < s1) cuts.add(+b.from.toFixed(5))
  const list = [...cuts].sort((x, y) => x - y)
  const bandAt = (s) => { let r = bands[0]; for (const b of bands) if (s >= b.from - 1e-7) r = b; return r }
  const out = []
  for (const s of list) {
    const isEdge = bands.some((b) => Math.abs(b.from - s) < 1e-6 && b.from > s0)
    if (isEdge) {
      const before = bandAt(s - 1e-4)
      out.push({ s, slot: before.slot, aux: before.aux })
      const after = bandAt(s + 1e-6)
      out.push({ s, slot: after.slot, aux: after.aux, seam: true })
    } else { const b = bandAt(s); out.push({ s, slot: b.slot, aux: b.aux }) }
  }
  return out
}


const LEG = [SP.leg, 0, 0], TORSO = [SP.torso, 0, 0], SLEEVE = [SP.sleeve, 0, 0]

function buildLegs(mb, d, lo) {
  const { k, b } = d, L1 = d.thigh, L2 = d.shin, L = L1 + L2
  const thigh = curve([[-0.05 * k, 0.078], [0, 0.08], [0.12 * k, 0.078], [0.26 * k, 0.067], [0.37 * k, 0.056], [L1, 0.048], [L1 + 0.05 * k, 0.045], [L1 + 0.14 * k, 0.044], [L1 + 0.28 * k, 0.036], [L1 + L2 - 0.05 * k, 0.027], [L1 + L2, 0.03]])
  const calf = curve([[L1 + 0.02 * k, 0], [L1 + 0.12 * k, 0.027], [L1 + 0.22 * k, 0.017], [L1 + 0.34 * k, 0]])
  const quad = curve([[0.02 * k, 0], [0.15 * k, 0.013], [0.3 * k, 0.006], [L1 - 0.03 * k, 0.008], [L1 + 0.005, 0.011], [L1 + 0.05 * k, 0]])
  const cap = 0.08 * b * k
  const prof = (s) => {
    if (s < 0) { const r = Math.sqrt(Math.max(cap * cap - s * s, 1e-6)); return { xP: r, xN: r, z: r * 0.97 } }
    const r = thigh(s) * b * k
    return { xP: r + quad(s) * b * k, xN: r + calf(s) * b * k, z: r * (s < L1 ? 0.95 : 0.92) }
  }
  // bands from the hip down: shorts · gripper · (warmer) · skin · (reflective band) · sock · (overshoe cuff)
  const sockTop = L - (MUT.has('sockGap') ? 0.004 : lo.p.sockH * k)
  const shortsEnd = lo.p.shortsLen === 'knicker' ? L1 + 0.13 * k : lo.p.shortsLen === 'tights' ? sockTop - 0.05 * k : 0.8 * L1
  const bands = [{ from: -cap, slot: S.shorts, aux: LEG }, { from: shortsEnd, slot: S.shortsAccent, aux: LEG }]
  const cur = shortsEnd + 0.035 * k
  if (lo.legWarm === 'leg') bands.push({ from: cur, slot: S.warmer, aux: LEG })
  else if (lo.legWarm === 'knee') bands.push({ from: cur, slot: S.warmer, aux: LEG }, { from: L1 + 0.1 * k, slot: S.skin, aux: LEG })
  else bands.push({ from: cur, slot: S.skin, aux: LEG })
  if (lo.nightBands) bands.push({ from: sockTop - 0.032 * k, slot: S.chrome, aux: LEG })
  const cuff = lo.overshoe === 'aero' || lo.overshoe === 'winter' ? L - (lo.overshoe === 'winter' ? 0.095 : 0.05) * k : Infinity
  if (sockTop < cuff - 0.01) bands.push({ from: sockTop, slot: S.sock, aux: LEG }) // a low sock under a tall cuff is simply hidden
  if (Number.isFinite(cuff)) bands.push({ from: cuff, slot: S.overshoe, aux: LEG })
  bands.sort((x, y) => x.from - y.from)
  // a cuff covers everything below it; a band left shorter than 1 cm is covered by the next (qa G23b, G23c)
  for (let i = bands.length - 1; i >= 0; i--) if (bands[i].slot !== S.overshoe && bands[i].from >= cuff - 1e-9) bands.splice(i, 1)
  if (!MUT.has('bandOrder')) for (let i = bands.length - 2; i >= 1; i--) if (bands[i + 1].from - bands[i].from < 0.01) bands.splice(i, 1)
  const st = stationsFor(-cap + 0.004, L1 + L2, Math.round((mb.lod ? 10 : 18) * mb.detail), bands)
  for (const [side, th, sh] of [[1, B.thighR, B.shinR], [-1, B.thighL, B.shinL]]) {
    limb(mb, { a: th, b: sh, L1, L2, restFlex: REST_FLEX.knee, band: 0.05 * k, prof, sides: 12, stations: st, side, capEnd: 0.028 * k })
  }
  mb.meta.legs = { sockTop, shortsEnd, L, bands: bands.map((x) => [x.from, SLOTS[x.slot]]) }
}

function buildArms(mb, d, lo) {
  const { k, b } = d, L1 = d.upperArm, L2 = d.foreArm, L = L1 + L2
  const r = curve([[-0.06 * k, 0.056], [0, 0.058], [0.06 * k, 0.054], [0.15 * k, 0.047], [0.25 * k, 0.042], [L1, 0.036], [L1 + 0.05 * k, 0.041], [L1 + 0.12 * k, 0.036], [L1 + L2 - 0.02 * k, 0.026], [L1 + L2, 0.027]])
  const bic = curve([[0.05 * k, 0], [0.15 * k, 0.011], [0.26 * k, 0], [L1 + 0.02 * k, 0], [L1 + 0.07 * k, 0.006], [L1 + 0.15 * k, 0]])
  const cap = 0.058 * b * k
  const prof = (s) => {
    if (s < 0) { const rr = Math.sqrt(Math.max(cap * cap - s * s, 1e-6)); return { xP: rr, xN: rr, z: rr } }
    const rr = r(s) * b * k
    return { xP: rr, xN: rr + bic(s) * b * k, z: rr * 0.95 }
  }
  const layerSleeve = lo.layerStyle === 'rain' || lo.layerStyle === 'winter'
  const long = layerSleeve || lo.sleeveLen === 'long'
  const sleeveSlot = layerSleeve ? S.layer : S.jersey, cuffSlot = layerSleeve ? S.layerAccent : S.jerseyAccent, sleeveAux = layerSleeve ? A0 : SLEEVE
  const sleeveEnd = long ? L - 0.03 * k : lo.sleeveLen === 'none' ? 0.015 * k : (lo.cut.style === 'club' ? 0.56 : 0.44) * L1
  const tail = long && lo.gloves.fingers !== 'none' ? S.glove : S.skin
  for (const [side, up, fo] of [[1, B.armR, B.foreR], [-1, B.armL, B.foreL]]) {
    const bands = [{ from: -cap, slot: sleeveSlot, aux: sleeveAux }, { from: sleeveEnd, slot: cuffSlot }]
    const after = sleeveEnd + (lo.sleeveLen === 'none' && !long ? 0.018 : 0.03) * k
    if (lo.armWarm && !long) bands.push({ from: after, slot: S.warmer }, { from: L - 0.035 * k, slot: S.skin })
    else bands.push({ from: after, slot: tail })
    // the captain's armband goes on the left upper arm, over whatever is there
    if (lo.armband.style === 'captain' && side < 0) {
      const a0 = 0.2 * L1, a1 = 0.29 * L1, under = [...bands].sort((x, y) => x.from - y.from).filter((x) => x.from <= a1 + 1e-6).pop()
      bands.push({ from: a0, slot: S.armband }, { from: a1, slot: under.slot, aux: under.aux })
    }
    bands.sort((x, y) => x.from - y.from)
    const st = stationsFor(-cap + 0.004, L1 + L2, Math.round((mb.lod ? 8 : 14) * mb.detail), bands)
    limb(mb, { a: up, b: fo, L1, L2, restFlex: REST_FLEX.elbow, band: 0.045 * k, prof, sides: 10, stations: st, side, capEnd: 0.022 * k })
  }
}

// Torso and pelvis share a smooth-skinned waist: both rest at the hip centre, weights by rest height, the jersey hem wraps the hips.
const waist = (k) => (c) => { const w = sstep(-0.02 * k, 0.2 * k, c.y); return [[B.pelvis, B.torso], [1 - w, w]] }
function buildTorso(mb, d, lo) {
  const { k, b } = d, T = d.torso
  const hw = curve([[-0.14, 0.168], [-0.06, 0.172], [0.04, 0.166], [0.16, 0.146], [0.3, 0.142], [0.45, 0.15], [0.62, 0.164], [0.8, 0.176], [0.92, 0.168], [1.0, 0.138], [1.05, 0.1], [1.1, 0.064]])
  const fr = curve([[-0.14, 0.098], [-0.05, 0.1], [0.05, 0.1], [0.2, 0.094], [0.35, 0.098], [0.55, 0.11], [0.75, 0.102], [0.92, 0.08], [1.02, 0.056], [1.1, 0.038]])
  const bk = curve([[-0.14, 0.11], [-0.05, 0.112], [0.05, 0.106], [0.2, 0.09], [0.4, 0.086], [0.62, 0.092], [0.8, 0.098], [0.95, 0.085], [1.04, 0.058], [1.1, 0.038]])
  const shift = curve([[-0.14, 0], [0.9, 0], [1.1, -0.016]])
  const cut = lo.cut.style, layer = lo.layerStyle
  const loose = cut === 'club' ? 1.035 : cut === 'wool' ? 1.02 : 1
  const inflate = layer === 'none' ? 0 : MUT.has('layerFat') ? 0.03 : layer === 'winter' ? 0.011 : 0.0065 // metres: the layer is a shell over the jersey
  const hemT = -0.035, rampT = 0.03
  const infl = (t) => inflate * sstep(hemT, hemT + rampT, t) * (1 - sstep(1.02, 1.1, t) * 0.6)
  const belly = (t) => (MUT.has('layerFat') ? 1 : sstep(0.45, 0.78, t)) // the front below the chest stays jersey-tight: that is where the thighs come up in the drops
  const shape = (t) => {
    const i = infl(t), lf = 1 + (loose - 1) * belly(t)
    return { c: V(shift(t) * k, t * T, 0), u: X_, v: Z_, ruP: fr(t) * k * b * lf + i * belly(t), ruN: bk(t) * k * b * loose + i, rv: hw(t) * k * (0.94 + 0.06 * b) * lf + i * (0.3 + 0.7 * belly(t)), n: 2.5 }
  }
  const N = Math.round((mb.lod ? 10 : 18) * mb.detail)
  const ts = []
  for (let i = 0; i <= N; i++) ts.push(-0.14 + (1.16 * i) / N)
  const body = layer === 'none' ? S.jersey : S.layer
  const st2 = []
  if (layer !== 'none') {
    // the jersey shows below the layer's hem; the hem is a ledge (a seam ring, then the inflated shell)
    for (const t of ts) if (t < hemT - 0.005) st2.push({ t, slot: S.jersey, aux: TORSO })
    st2.push({ t: hemT, slot: S.jersey, aux: TORSO }, { t: hemT, slot: S.layerAccent, aux: TORSO, seam: true }, { t: hemT + rampT * 0.5, slot: S.layerAccent, aux: TORSO }, { t: hemT + rampT * 0.5, slot: S.layer, aux: TORSO, seam: true })
    for (const t of ts) if (t > hemT + rampT * 0.5 + 0.02) st2.push({ t, slot: S.layer, aux: TORSO })
  } else for (const t of ts) st2.push({ t, slot: S.jersey, aux: TORSO })
  // collar: low shows the neck, std a band, high climbs the neck (jackets always high)
  const collar = layer === 'rain' || layer === 'winter' ? 'high' : lo.p.collar
  const cSlot = layer === 'none' ? S.jerseyAccent : S.layer
  if (collar === 'low') st2.push({ t: 1.02, slot: cSlot, seam: true }, { t: 1.045, slot: cSlot }, { t: 1.045, slot: S.skin, seam: true }, { t: 1.1, slot: S.skin })
  else st2.push({ t: 1.02, slot: cSlot, seam: true }, { t: 1.06, slot: cSlot }, { t: 1.1, slot: collar === 'high' ? cSlot : S.jerseyAccent })
  if (collar === 'high') st2.push({ t: 1.13, slot: cSlot }, { t: 1.13, slot: layer === 'none' ? S.jerseyAccent : S.layerAccent, seam: true }, { t: 1.145, slot: layer === 'none' ? S.jerseyAccent : S.layerAccent })
  const topT = collar === 'high' ? 1.16 : 1.12
  // above t = 1.1 the curves hold their last value: the high collar is a short tube round the neck base
  axisLoft(mb, st2, (t) => { const s = shape(Math.min(t, 1.1)), g = t > 1.1 ? 1 + (t - 1.1) * 0.6 : 1; return { ...s, c: V(shift(Math.min(t, 1.1)) * k, t * T, 0), ruP: s.ruP * g, ruN: s.ruN * g, rv: s.rv * g } }, B.torso, { sides: 20, capStart: V(0, -0.15 * T, 0), capEnd: V(-0.016 * k, topT * T, 0), weights: waist(k) })
  // rear pockets and their hem ride the same waist weights as the back they sit on (a skinsuit has none)
  if (cut !== 'skinsuit') {
    for (const z of [-0.075, 0, 0.075]) {
      const t = 0.22, back = bk(t) * k * b * loose + (MUT.has('pocketIn') ? 0 : infl(t))
      mb.tag('pocket', () => ell(mb, B.torso, body, V(-back + 0.001, t * T, z * k), 0.007, 0.05 * k, 0.033 * k, undefined, { aux: TORSO, w: 8, h: 4, weights: waist(k) }))
      ;(mb.meta.pockets ??= []).push({ t, x: -back + 0.001, z: z * k })
    }
    tube(mb, V(-bk(0.32) * k * b * loose - infl(0.32) - 0.003, 0.32 * T, -0.11 * k), V(-bk(0.32) * k * b * loose - infl(0.32) - 0.003, 0.32 * T, 0.11 * k), 0.0035, { bone: B.torso, slot: layer === 'none' ? S.jerseyAccent : S.layerAccent, sides: 6, weights: waist(k) })
  }
  if (cut === 'wool' && layer === 'none') for (const t of [0.97, 0.9, 0.83]) mb.geo(new THREE.OctahedronGeometry(1, 0), B.torso, S.jerseyAccent, place(V(fr(t) * k * b * loose + 0.001, t * T, 0), new THREE.Quaternion(), V(0.004, 0.006, 0.006)))
  if (lo.bags.style === 'musette') {
    // the feed bag rides on the back, low on the left; its strap is painted (torso kit), so it never clips an arm
    const t = 0.16, back = bk(t) * k * b * loose + infl(t)
    ell(mb, B.torso, S.bag, V(-back - 0.012, t * T, -0.085 * k), 0.016, 0.085 * k, 0.07 * k, qAxis(X_, 0.12), { w: 10, h: 6, weights: waist(k) })
  }
  mb.meta.torso = { T, shape: (t) => shape(clamp(t, -0.14, 1.1)), inflate, hemT, loose }
}

function buildPelvis(mb, d) {
  const { k, b } = d
  const hw = curve([[-0.105, 0.06], [-0.08, 0.118], [-0.045, 0.148], [-0.01, 0.154], [0.03, 0.138]])
  const fr = curve([[-0.105, 0.03], [-0.07, 0.07], [-0.02, 0.084], [0.03, 0.08]])
  const bk = curve([[-0.105, 0.05], [-0.075, 0.094], [-0.04, 0.102], [0.0, 0.098], [0.03, 0.09]])
  const st = []
  const N = mb.lod ? 6 : 9
  for (let i = 0; i <= N; i++) st.push({ t: -0.105 + (0.135 * i) / N, slot: S.shorts })
  axisLoft(mb, st, (t) => ({ c: V(-0.01 * k, t * k, 0), u: X_, v: Z_, ruP: fr(t) * k * b, ruN: bk(t) * k * b, rv: hw(t) * k * (0.95 + 0.05 * b), n: 2.3 }), B.pelvis, { sides: 18, capStart: V(-0.01 * k, -0.112 * k, 0), capEnd: V(-0.01 * k, 0.04 * k, 0), weights: waist(k) })
}

// Head-local: origin at C7 (the neck base), +X the face, +Y up. The skull sits forward of C7: a cyclist's neck is extended.
export const HEAD_SCALE = 1.08 // stylised athletic: a touch more head (and helmet) than life, ~7 helmeted heads tall
// helmet shells as (x → width, crown, rim) knots in head units, x from the brow (+) to the tail (−)
const HELMETS = {
  road: { X: [0.104, 0.085, 0.045, 0.0, -0.045, -0.085, -0.108, -0.122], W: [0.04, 0.078, 0.1, 0.105, 0.101, 0.088, 0.068, 0.034], TOP: [0.04, 0.078, 0.102, 0.11, 0.104, 0.082, 0.052, 0.012], RIM: [0.03, 0.022, 0.016, 0.005, -0.012, -0.03, -0.044, -0.042] },
  aero: { X: [0.104, 0.085, 0.045, 0.0, -0.05, -0.1, -0.15, -0.2, -0.245], W: [0.04, 0.078, 0.1, 0.104, 0.1, 0.086, 0.064, 0.038, 0.012], TOP: [0.04, 0.078, 0.102, 0.108, 0.1, 0.083, 0.058, 0.032, 0.008], RIM: [0.03, 0.022, 0.016, 0.006, -0.012, -0.028, -0.034, -0.03, -0.018] },
  tt: { X: [0.108, 0.09, 0.05, 0.0, -0.06, -0.12, -0.18, -0.24, -0.29, -0.33], W: [0.05, 0.088, 0.106, 0.108, 0.1, 0.082, 0.06, 0.04, 0.022, 0.006], TOP: [0.045, 0.082, 0.104, 0.11, 0.1, 0.082, 0.06, 0.036, 0.016, 0.0], RIM: [0.034, 0.012, -0.004, -0.012, -0.02, -0.026, -0.026, -0.022, -0.016, -0.01] },
  hardshell: { X: [0.1, 0.082, 0.04, 0.0, -0.045, -0.085, -0.11, -0.124], W: [0.05, 0.086, 0.105, 0.11, 0.106, 0.092, 0.07, 0.036], TOP: [0.042, 0.078, 0.1, 0.108, 0.102, 0.082, 0.052, 0.014], RIM: [0.032, 0.021, 0.006, -0.008, -0.022, -0.04, -0.054, -0.052] }
}
function helmetShape(style) {
  const h = HELMETS[style]
  if (!h) return null
  const rev = (A) => curve(h.X.map((x, i) => [x, A[i]]).reverse())
  return { X: h.X, w: rev(h.W), top: rev(h.TOP), rim: rev(h.RIM) }
}
function buildHead(mb, d, lo) {
  const kN = d.k, b = d.b, k = d.k * HEAD_SCALE
  const K = V(0.07 * k, 0.13 * k, 0) // skull centre
  const q0 = new THREE.Quaternion()
  const skin = []
  const skinEll = (c, rx, ry, rz, q = q0, o = {}) => { ell(mb, B.head, S.skin, c, rx, ry, rz, q, o); skin.push({ c: c.clone(), r: [rx, ry, rz], q: q.clone() }) }
  sweep(mb, [V(-0.012 * kN, -0.02 * kN, 0), V(0.025 * kN, 0.05 * kN, 0), V(0.055 * kN, 0.095 * kN, 0)], { bone: B.head, slot: S.skin, r: (t) => lerp(0.056, 0.046, t) * kN * b, sides: 12, samples: 6 })
  skinEll(K, 0.086 * k, 0.09 * k, 0.078 * k, q0, { w: 10, h: 7 })
  skinEll(K.clone().add(V(0.034 * k, -0.046 * k, 0)), 0.058 * k, 0.066 * k, 0.064 * k, qAxis(Z_, 0.22), { w: 10, h: 7 }) // jaw and cheeks
  skinEll(K.clone().add(V(0.064 * k, -0.097 * k, 0)), 0.019 * k, 0.015 * k, 0.025 * k, q0, { w: 8, h: 5 }) // chin
  skinEll(K.clone().add(V(0.093 * k, -0.014 * k, 0)), 0.016 * k, 0.022 * k, 0.012 * k, qAxis(Z_, -0.45), { w: 6, h: 5 }) // nose
  for (const s of [1, -1]) skinEll(K.clone().add(V(-0.008 * k, -0.014 * k, s * 0.078 * k)), 0.017 * k, 0.026 * k, 0.011 * k, q0, { w: 6, h: 5 })
  // --- hair (identity is free)
  const hair = lo.hair.style
  if (hair !== 'none') ell(mb, B.head, S.hair, K.clone().add(V(-0.03 * k, -0.018 * k, 0)), (hair === 'curls' ? 0.08 : 0.074) * k, 0.07 * k, (hair === 'curls' ? 0.087 : 0.082) * k, undefined, { w: 10, h: 6 })
  if (hair === 'ponytail') sweep(mb, [K.clone().add(V(-0.085 * k, -0.005 * k, 0)), K.clone().add(V(-0.13 * k, -0.045 * k, 0)), K.clone().add(V(-0.15 * k, -0.11 * k, 0)), K.clone().add(V(-0.14 * k, -0.16 * k, 0))], { bone: B.head, slot: S.hair, r: (t) => lerp(0.026, 0.008, t) * k, sides: 6, samples: 7 })
  if (hair === 'bun') ell(mb, B.head, S.hair, K.clone().add(V(-0.105 * k, -0.045 * k, 0)), 0.032 * k, 0.03 * k, 0.032 * k, undefined, { w: 7, h: 5 })
  if (hair === 'braid') sweep(mb, [K.clone().add(V(-0.085 * k, -0.01 * k, 0)), K.clone().add(V(-0.11 * k, -0.07 * k, 0)), K.clone().add(V(-0.115 * k, -0.14 * k, 0)), K.clone().add(V(-0.1 * k, -0.2 * k, 0))], { bone: B.head, slot: S.hair, r: (t) => (0.016 + 0.006 * Math.abs(Math.sin(t * Math.PI * 5))) * k * (1 - 0.35 * t), sides: 5, samples: 10 })
  // bare-headed (garage product shots only: every legal loadout wears a helmet) the hair covers the crown too
  if (hair !== 'none' && lo.helmet.style === 'none') ell(mb, B.head, S.hair, K.clone().add(V(-0.008 * k, 0.012 * k, 0)), (hair === 'curls' ? 0.095 : 0.088) * k, (hair === 'curls' ? 0.091 : 0.086) * k, (hair === 'curls' ? 0.089 : 0.083) * k, qAxis(Z_, 0.12), { w: 12, h: 8 })
  if (hair === 'curls' && !mb.lod) for (let i = 0; i < 4; i++) { const a = lerp(-1.0, 1.0, i / 3); ell(mb, B.head, S.hair, K.clone().add(V(-0.07 * k - Math.cos(a) * 0.02 * k, -0.06 * k, Math.sin(a) * 0.07 * k)), 0.024 * k, 0.021 * k, 0.024 * k, undefined, { w: 5, h: 3 }) }
  // --- cap under the helmet (a dome to the brow, a brim at the front)
  const cs = lo.cap.style
  if (cs !== 'none' && !mb.lod) mb.accessory('cap', () => {
    const CAP = [SP.cap, 0, 0]
    if (cs === 'cotton' || cs === 'winter') {
      const deep = cs === 'winter' ? 0.63 : 0.53
      const dome = new THREE.SphereGeometry(1, 9, 4, 0, TAU, 0, Math.PI * deep)
      const cs0 = MUT.has('capOut') ? 1.25 : 1
      mb.tag('capDome', () => mb.geo(dome, B.head, S.cap, place(K.clone().add(V(-0.004 * k, 0.004 * k, 0)), qAxis(Z_, 0.32), V(0.092 * k * cs0, 0.096 * k * cs0, 0.086 * k * cs0)), { aux: CAP }))
    }
    if (cs === 'winter') for (const s of [1, -1]) mb.tag('capFlap', () => ell(mb, B.head, S.cap, K.clone().add(V(-0.01 * k, -0.035 * k, s * 0.08 * k)), 0.034 * k, 0.04 * k, 0.012 * k, undefined, { w: 4, h: 3, aux: CAP }))
    if (cs === 'cotton') {
      const up = lo.p.brim === 'up', a = up ? 1.15 : -0.3, brimY = K.y + 0.03 * k, rr = 0.1 * k
      const pts = []
      for (let i = 0; i <= 5; i++) { const ang = lerp(-0.72, 0.72, i / 5); pts.push(V(K.x + Math.cos(ang) * rr, brimY, Math.sin(ang) * rr)) }
      const rad0 = pts[0].clone().sub(V(K.x, brimY, 0)).normalize()
      if (MUT.has('nanCap')) pts[2].x = NaN
      mb.tag('capBrim', () => sweep(mb, pts, { bone: B.head, slot: S.capAccent, r: [0.0022 * k, 0.022 * k], ref: V(0, Math.cos(a), 0).addScaledVector(rad0, Math.sin(a)), sides: 4, samples: 5 }))
    }
    if (cs === 'headband') {
      const ring = []
      for (let i = 0; i <= 14; i++) { const ang = (i / 14) * TAU; ring.push(K.clone().add(V(Math.cos(ang) * 0.089 * k, 0.012 * k - 0.012 * k * Math.cos(ang), Math.sin(ang) * 0.081 * k))) }
      sweep(mb, ring, { bone: B.head, slot: S.cap, r: [0.017 * k, 0.004 * k], ref: Y_, sides: 4, samples: 14, cap: false, aux: CAP })
    }
  })
  // --- helmet
  const hs = lo.helmet.style
  const HELM = [SP.helmet, 0, 0]
  const hsh = helmetShape(hs)
  mb.meta.head = { K, k, skin, helmet: hsh, style: hs }
  if (hsh) {
    const { X, w, top, rim } = hsh
    const xs = [], n = mb.lod ? 6 : hs === 'tt' ? 12 : 10
    for (let i = 0; i <= n; i++) xs.push(lerp(X[X.length - 1], X[0], i / n))
    axisLoft(mb, xs.map((x) => ({ t: x, slot: S.helmet, aux: HELM })), (x) => ({ c: V(K.x + x * k, K.y + ((top(x) + rim(x)) / 2) * k, 0), u: Y_, v: Z_, ruP: ((top(x) - rim(x)) / 2) * k, ruN: ((top(x) - rim(x)) / 2) * k, rv: w(x) * k, n: hs === 'hardshell' ? 2.1 : 2.3 }), B.head, { sides: 16, capStart: V(K.x + (X[X.length - 1] - 0.004) * k, K.y + rim(X[X.length - 1]) * k + 0.01 * k, 0), capEnd: V(K.x + (X[0] + 0.004) * k, K.y + ((top(X[0]) + rim(X[0])) / 2) * k, 0) })
    if (hs === 'road') for (const z of [-0.042, 0, 0.042]) sweep(mb, [0.075, 0.04, 0.0, -0.04, -0.075].map((x) => V(K.x + x * k, K.y + (top(x) * Math.sqrt(Math.max(1 - (z / w(x)) ** 2, 0.2)) + 0.001) * k, z * k * 1.02)), { bone: B.head, slot: S.hood, r: [0.004 * k, 0.009 * k], ref: Y_, sides: 4, samples: 5 })
    const ring = []
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * TAU; const x = X[X.length - 1] + (X[0] - X[X.length - 1]) * (0.5 + 0.5 * Math.cos(a)); const zz = w(x) * 1.004 * Math.sin(a); ring.push(V(K.x + x * k, K.y + (rim(x) + (top(x) - rim(x)) * 0.14) * k, zz * k)) }
    sweep(mb, ring, { bone: B.head, slot: S.helmetAccent, r: [0.007 * k, 0.004 * k], ref: Y_, sides: 4, samples: 18, cap: false })
    for (const s of [1, -1]) sweep(mb, [K.clone().add(V(0.0, -0.01 * k, s * 0.1 * k)), K.clone().add(V(0.02 * k, -0.06 * k, s * 0.07 * k)), K.clone().add(V(0.055 * k, -0.098 * k, s * 0.028 * k))], { bone: B.head, slot: S.hood, r: 0.003 * k, sides: 4, samples: 6 })
    if (hs === 'tt') {
      // the visor: one wide lens from temple to temple, tucked under the brow of the shell
      const pts = []
      for (let i = 0; i <= 12; i++) { const a = lerp(-1.25, 1.25, i / 12); pts.push(V(K.x + (Math.cos(a) * 0.1 + 0.008) * k, K.y + 0.014 * k, Math.sin(a) * 0.097 * k)) }
      mb.tag('visor', () => sweep(mb, pts, { bone: B.head, slot: S.lens, r: [0.034 * k, 0.0025 * k], ref: Y_, sides: 6, samples: 12 }))
    }
    if (lo.helmetDeco.style === 'flowers') mb.accessory('flowers', () => {
      for (let i = 0; i < 5; i++) {
        const a = lerp(0.7, TAU - 0.7, i / 4), x = X[X.length - 1] + (X[0] - X[X.length - 1]) * (0.5 + 0.5 * Math.cos(a)), zz = w(x) * 1.02 * Math.sin(a)
        const p = V(K.x + x * k, K.y + (rim(x) + (top(x) - rim(x)) * 0.2) * k, zz * k), nrm = V(p.x - K.x, 0, p.z).normalize()
        mb.geo(new THREE.CircleGeometry(0.013 * k, 5).rotateX(-Math.PI / 2), B.head, i % 2 ? S.flower : S.helmetAccent, place(p.clone().addScaledVector(nrm, 0.003 * k), qFromTo(Y_, nrm)))
        mb.geo(new THREE.OctahedronGeometry(0.0045 * k, 0), B.head, S.foliage, TR(p.x + nrm.x * 0.0068 * k, p.y, p.z + nrm.z * 0.0068 * k))
      }
    })
  } else if (hs === 'hairnet') {
    for (const z of [-0.052, -0.018, 0.018, 0.052]) sweep(mb, [V(0.082, 0.028, z * 1.05), V(0.05, 0.088, z), V(-0.02, 0.1, z), V(-0.078, 0.066, z), V(-0.098, 0.0, z * 1.05)].map((p) => p.multiplyScalar(k).add(K)), { bone: B.head, slot: S.helmet, r: 0.017 * k, sides: 6, samples: 8 })
    const ring = []
    for (let i = 0; i <= 20; i++) { const a = (i / 20) * TAU; ring.push(K.clone().add(V(Math.cos(a) * 0.093 * k, 0.018 * k - 0.024 * k * Math.cos(a), Math.sin(a) * 0.087 * k))) }
    sweep(mb, ring, { bone: B.head, slot: S.helmetAccent, r: [0.017 * k, 0.01 * k], ref: Y_, sides: 5, samples: 24, cap: false })
    if (lo.helmetDeco.style === 'flowers') mb.accessory('flowers', () => { for (let i = 0; i < 5; i++) { const a = lerp(0.7, TAU - 0.7, i / 4); mb.geo(new THREE.CircleGeometry(0.013 * k, 5).rotateX(-Math.PI / 2), B.head, i % 2 ? S.flower : S.helmetAccent, place(K.clone().add(V(Math.cos(a) * 0.1 * k, 0.018 * k - 0.024 * k * Math.cos(a), Math.sin(a) * 0.094 * k)), qFromTo(Y_, V(Math.cos(a), 0, Math.sin(a))))) } })
  }
  // --- glasses (a visor replaces them)
  const gs = lo.hidden.glasses ? 'none' : lo.glasses.style
  const eyeY = K.y - 0.004 * k
  const temples = []
  const temple = (s, from) => { const e = V(K.x - (MUT.has('templeShort') ? 0.0 : 0.03) * k, eyeY + 0.006 * k, s * (MUT.has('templeShort') ? 0.095 : 0.0765) * k); mb.tag('temple', () => tube(mb, from.clone(), e, 0.003 * k, { bone: B.head, slot: S.glasses, sides: 4 })); temples.push(e) }
  const lr = MUT.has('lensIn') ? 0.078 : 0.094
  if (gs === 'wrap' || gs === 'shield' || gs === 'halfrim') {
    const h = gs === 'shield' ? 0.021 : gs === 'halfrim' ? 0.016 : 0.014, pts = []
    for (let i = 0; i <= 12; i++) { const a = lerp(-1.2, 1.2, i / 12); pts.push(V(K.x + (Math.cos(a) * lr + 0.006) * k, eyeY + (gs === 'shield' ? 0.004 : 0) * k + (MUT.has('lensHigh') ? 0.022 : 0), Math.sin(a) * 0.088 * k)) }
    if (gs === 'halfrim') for (const [a0, a1] of [[-1.2, -0.09], [0.09, 1.2]]) {
      const half = []
      for (let i = 0; i <= 6; i++) { const a = lerp(a0, a1, i / 6); half.push(V(K.x + (Math.cos(a) * lr + 0.006) * k, eyeY - 0.002 * k, Math.sin(a) * 0.088 * k)) }
      mb.tag('lens', () => sweep(mb, half, { bone: B.head, slot: S.lens, r: [h * k, 0.0035 * k], ref: Y_, sides: 6, samples: 6 }))
    } else mb.tag('lens', () => sweep(mb, pts, { bone: B.head, slot: S.lens, r: [h * k, 0.0035 * k], ref: Y_, sides: 6, samples: 10 }))
    if (gs !== 'shield') mb.tag('glassesFrame', () => sweep(mb, pts.map((p) => p.clone().add(V(0.0015 * k, (gs === 'halfrim' ? h - 0.002 : h) * k, 0))), { bone: B.head, slot: S.glasses, r: [0.003 * k, 0.0045 * k], ref: Y_, sides: 4, samples: 10 }))
    for (const s of [1, -1]) temple(s, V(K.x + 0.036 * k, eyeY + 0.008 * k, s * 0.087 * k))
  } else if (gs === 'round' || gs === 'gletscher') {
    for (const s of [1, -1]) {
      const c = V(K.x + (MUT.has('lensIn') ? 0.075 : 0.09) * k, eyeY, s * 0.033 * k)
      mb.tag('lens', () => mb.geo(new THREE.CylinderGeometry(0.019 * k, 0.019 * k, 0.003 * k, mb.sg(12)).rotateZ(Math.PI / 2), B.head, S.lens, TR(c.x, c.y, c.z)))
      mb.geo(new THREE.TorusGeometry(0.019 * k, 0.0024 * k, 3, mb.sg(12)).rotateY(Math.PI / 2), B.head, S.glasses, TR(c.x + 0.001, c.y, c.z))
      temple(s, c.clone().add(V(-0.005 * k, 0.004 * k, s * 0.018 * k)))
      if (gs === 'gletscher') mb.geo(new THREE.SphereGeometry(1, mb.sg(6), mb.sg(4), 0, Math.PI, 0, Math.PI), B.head, S.leather, place(V(K.x + 0.066 * k, eyeY, s * 0.072 * k), qAxis(Y_, s > 0 ? Math.PI * 0.5 : -Math.PI * 0.5), V(0.02 * k, 0.019 * k, 0.012 * k)))
    }
  }
  mb.meta.head.temples = temples
}

// Hand-local: origin at the wrist, +X toward the knuckles, +Y the back of the hand. The fingers hook down round the grip.
function buildHands(mb, d, lo) {
  const { k, b } = d
  const fingers = lo.gloves.fingers
  const palmSlot = fingers === 'none' ? S.skin : S.glove, fingerSlot = fingers === 'full' || fingers === 'lobster' ? S.glove : S.skin
  const lob = fingers === 'lobster' ? 1.18 : 1
  for (const [side, bone] of [[1, B.handR], [-1, B.handL]]) {
    const inner = -side
    ell(mb, bone, palmSlot, V(0.004 * k, -0.002 * k, 0), 0.028 * k * lob, 0.024 * k * lob, 0.029 * k * lob, undefined, { w: 8, h: 6 })
    ell(mb, bone, palmSlot, V(0.045 * k, -0.006 * k, 0), 0.05 * k * b, 0.021 * k * b * lob, 0.041 * k * b * lob, undefined, { w: 10, h: 6 })
    sweep(mb, [V(0.072 * k, -0.001 * k, 0), V(0.094 * k, -0.015 * k, 0), V(0.096 * k, -0.044 * k, 0), V(0.079 * k, -0.058 * k, 0)], { bone, slot: fingerSlot, r: [0.034 * k * b * lob, 0.011 * k * b * lob], ref: Z_, sides: 8, samples: 6 })
    sweep(mb, [V(0.02 * k, -0.012 * k, inner * 0.03 * k), V(0.05 * k, -0.03 * k, inner * 0.038 * k), V(0.066 * k, -0.046 * k, inner * 0.03 * k)], { bone, slot: fingerSlot, r: 0.011 * k * b * lob, sides: 6, samples: 6 })
  }
}

// Foot-local: origin at the ankle joint, +X toward the toe. The pedal body rides on the foot, centred on the spindle.
function shoeShape(d, lo) {
  const k = d.k, kw = Math.sqrt(k)
  const x0 = -0.068 * k, x1 = 0.2 * k, yb = -0.078 * k
  const pad = lo.overshoe === 'winter' ? 0.004 : lo.overshoe === 'aero' ? 0.0015 : 0
  const slim = (x) => (lo.shoes.style === 'vintage' ? lerp(1, 0.93, sstep(0.03 * k, 0.1 * k, x)) : 1) // a slimmer toe box, the same heel cup
  const nw = MUT.has('shoeNarrow') ? 0.8 : 1
  const hw0 = curve([[x0, 0.028 * kw], [-0.04 * k, 0.037 * kw], [0.03 * k, 0.039 * kw], [0.11 * k, 0.047 * kw], [0.17 * k, 0.04 * kw], [x1, 0.02 * kw]])
  // the collar rises round the ankle bones so a flexing ankle stays inside the upper (qa G23a)
  const top = curve([[x0, -0.014 * k], [-0.05 * k, 0.02 * k], [0.0, 0.015 * k], [0.05 * k, -0.008 * k], [0.12 * k, -0.047 * k], [0.18 * k, -0.06 * k], [x1, -0.068 * k]])
  const toeUp = curve([[x0, 0], [0.13 * k, 0], [x1, 0.012 * k]])
  const hw = (x) => hw0(x) * nw
  // padding (overshoes) grows outward and upward only, never toward the crank arm: side +1 is the right foot, -1 the left, 0 both
  const section = (x, side = 0) => { const lo2 = yb + 0.007 + toeUp(x), hi = Math.max(top(x), lo2 + 0.01 * k) + pad, w = hw(x) * slim(x); return { c: V(x, (lo2 + hi) / 2, 0), u: Y_, v: Z_, ruP: (hi - lo2) / 2, ruN: (hi - lo2) / 2, rv: w + pad, rvP: w + (side >= 0 ? pad : 0), rvN: w + (side <= 0 ? pad : 0), n: 3.3 } }
  return { x0, x1, yb, hw, top, toeUp, section, pad }
}
const PEDAL_H = 0.017
const PEDAL_INNER = { road: 0.038, node: 0.035, twobolt: 0.031, flat: 0.036, clips: 0.045 } // spindle centre to the pedal body's inner face (the body sits 6 mm toward the bike)
function pedalGeometry(mb, bone, cIn, side, style, sh, off = null) {
  const c = MUT.has('pedalLow') ? cIn.clone().add(V(0, -0.005, 0)) : cIn
  // c: spindle centre in bone space; the pedal top sits flush with the sole (c.y + PEDAL_H/2)
  const z = c.z - side * 0.006
  if (style === 'node') mb.geo(new THREE.CylinderGeometry(0.029, 0.029, PEDAL_H, mb.sg(10)), bone, S.pedal, TR(c.x, c.y, z))
  else if (style === 'twobolt') {
    mb.geo(new THREE.BoxGeometry(0.058, PEDAL_H, 0.05), bone, S.pedal, TR(c.x, c.y, z))
    for (const s of [1, -1]) tube(mb, V(c.x - 0.04, c.y, z + s * 0.029), V(c.x + 0.04, c.y, z + s * 0.029), 0.0045, { bone, slot: S.metal, sides: 4 })
  } else if (style === 'flat') {
    const zf = c.z + side * 0.004 // a platform sits outboard of the spindle's centre, clear of the crank arm
    mb.geo(new THREE.BoxGeometry(0.1, 0.014, 0.08), bone, S.pedal, TR(c.x, c.y + PEDAL_H / 2 - 0.007, zf))
    if (!mb.lod) for (const [px, pz] of [[-0.042, -0.032], [0.042, -0.032], [-0.042, 0.032], [0.042, 0.032]]) mb.geo(new THREE.CylinderGeometry(0.0022, 0.0022, 0.004, 3, 1, true), bone, S.metal, TR(c.x + px, c.y + PEDAL_H / 2 + 0.0015, zf + pz))
  } else if (style === 'clips') {
    // rat-trap quill pedal: two cage plates round a body, then the toe clip round the shoe and the strap over it
    for (const s of [1, -1]) mb.geo(new THREE.BoxGeometry(0.006, PEDAL_H, 0.078), bone, S.pedal, TR(c.x + s * 0.042, c.y, z))
    tube(mb, V(c.x, c.y, z - 0.036), V(c.x, c.y, z + 0.036), 0.0085, { bone, slot: S.pedal, sides: 6, ref: Y_ })
    if (sh) {
      const { x1, yb, top, hw, toeUp } = sh
      const xa = c.x + 0.045, pd = sh.pad
      const o = off ?? V()
      const tp = (x) => sh.section(x).c.y + sh.section(x).ruP // the upper's real top line, padding included
      const clip = [V(xa, c.y + 0.004, z), V(x1 + 0.016 + pd + o.x, yb + toeUp(x1) + 0.006 + o.y, z), V(x1 + 0.013 + pd + o.x, (yb + tp(x1)) / 2 + 0.008 + o.y, z), V(x1 - 0.012 + o.x, tp(x1 - 0.012) + 0.012 + o.y, z), V(0.155 * (x1 / 0.2) + o.x, tp(0.155 * (x1 / 0.2)) + 0.009 + o.y, z)]
      if (MUT.has('clipIn')) for (const p of clip.slice(1, 4)) p.x -= 0.02
      mb.tag('toeClip', () => sweep(mb, clip, { bone, slot: S.chrome, r: [0.007, 0.0018], ref: Z_, sides: 4, samples: mb.lod ? 5 : 7 }))
      // the strap follows the shoe's own section, 3 mm proud of it, from one side over the instep to the other
      const xs = 0.135 * (x1 / 0.2), sec = sh.section(xs), e = 2 / (sec.n ?? 3), ring = []
      // on the crank side the strap stops half-way down (it would run through the pedal there), clear of the crank arm
      const [ph0, ph1] = side > 0 ? [-0.5 * Math.PI / 2, Math.PI / 2] : [-Math.PI / 2, 0.5 * Math.PI / 2]
      for (let i = 0; i <= 8; i++) { const ph = lerp(ph0, ph1, i / 8), cu = Math.sign(Math.cos(ph)) * Math.abs(Math.cos(ph)) ** e, sv = Math.sign(Math.sin(ph)) * Math.abs(Math.sin(ph)) ** e; ring.push(V(xs + o.x, sec.c.y + cu * (sec.ruP + 0.006) + o.y, sv * (sec.rv + 0.006) + (off ? c.z + side * 0.006 : 0))) }
      if (!mb.lod) mb.tag('strap', () => sweep(mb, ring, { bone, slot: S.leather, r: [0.009, 0.0022], ref: X_, sides: 3, samples: 8, cap: false }))
    }
  } else mb.geo(new THREE.BoxGeometry(0.084, PEDAL_H, 0.064, 1, 1, 1), bone, S.pedal, TR(c.x, c.y, z)) // 3-bolt road
}
function buildFeet(mb, d, lo) {
  const { k } = d
  const cl = d.cleat
  const sh = shoeShape(d, lo)
  const { x0, x1, yb, top, toeUp, section } = sh
  const style = lo.shoes.style, ov = lo.overshoe, covered = ov === 'aero' || ov === 'winter'
  const upper = style === 'vintage' ? S.leather : S.shoe
  for (const [side, bone] of [[1, B.footR], [-1, B.footL]]) {
    const st = []
    const N = mb.lod ? 6 : 10
    for (let i = 0; i <= N; i++) { const t = x0 + ((x1 - x0) * i) / N; st.push({ t, slot: covered ? S.overshoe : upper }) }
    if (ov === 'toe') { const xt = 0.09 * k; const cut = st.filter((s) => s.t < xt); st.length = 0; st.push(...cut, { t: xt, slot: upper }, { t: xt, slot: S.overshoe, seam: true }); for (let i = 1; i <= 4; i++) st.push({ t: lerp(xt, x1, i / 4), slot: S.overshoe }) }
    axisLoft(mb, st, (x) => section(x, side), bone, { sides: 12, capStart: V(x0 - 0.004, (yb + top(x0)) / 2, 0), capEnd: V(x1 + 0.006 * k, yb + 0.02 * k, 0) })
    // sole slab
    const st2 = []
    for (let i = 0; i <= 6; i++) st2.push({ t: x0 + 0.004 + ((x1 - x0 - 0.004) * i) / 6, slot: style === 'vintage' ? S.cork : S.sole })
    axisLoft(mb, st2, (x) => ({ c: V(x, yb + 0.0045 + toeUp(x), 0), u: Y_, v: Z_, ruP: 0.0045, ruN: 0.0045, rv: sh.hw(x) + 0.0025, n: 4 }), bone, { sides: 10, capStart: V(x0, yb + 0.0045, 0), capEnd: V(x1 + 0.003, yb + 0.006 + toeUp(x1), 0) })
    // closures (an overshoe covers them)
    if (!covered) {
      const T = (x, dy = 0.002) => top(x) + dy
      if (style === 'laced' || style === 'vintage') for (let i = 0; i < 4; i++) { const x = (0.035 + i * 0.03) * k; tube(mb, V(x, T(x, 0.001), -0.022 * k), V(x, T(x, 0.001), 0.022 * k), 0.0028 * k, { bone, slot: style === 'vintage' ? S.cork : S.sole, sides: 4 }) }
      else if (style === 'strap') for (const x of [0.04, 0.085, 0.13]) tube(mb, V(x * k, T(x * k), -0.038 * k), V(x * k, T(x * k), 0.038 * k), 0.0042 * k, { bone, slot: S.sole, sides: 4 })
      else if (style === 'buckle') {
        for (const x of [0.06, 0.11]) tube(mb, V(x * k, T(x * k), -0.036 * k), V(x * k, T(x * k), 0.036 * k), 0.0042 * k, { bone, slot: S.sole, sides: 4 })
        mb.geo(new THREE.BoxGeometry(0.03 * k, 0.008 * k, 0.014 * k), bone, S.metal, place(V(0.01 * k, top(0.01 * k) + 0.005, side * 0.03 * k), qAxis(Z_, -0.3)))
      } else {
        mb.geo(new THREE.CylinderGeometry(0.011 * k, 0.011 * k, 0.008 * k, mb.sg(10)), bone, S.metal, place(V(0.075 * k, top(0.075 * k) + 0.003, side * 0.02 * k), qAxis(X_, side * 0.5)))
        tube(mb, V(0.12 * k, top(0.12 * k) + 0.002, -0.036 * k), V(0.12 * k, top(0.12 * k) + 0.002, 0.036 * k), 0.004 * k, { bone, slot: S.sole, sides: 4 })
      }
    }
    if (!mb.bikeOnly) pedalGeometry(mb, bone, V(cl.x, cl.y, 0), side, lo.pedals.style, sh)
  }
  mb.meta.shoe = sh
}

// ---------------------------------------------------------------- bike
function frameTube(mb, a, b, r, t, o = {}) {
  const shape = t.shape === 'kamm' ? 'kamm' : 'ellipse'
  const aspect = t.shape === 'kamm' || t.shape === 'aero' ? t.aspect ?? 1.8 : 1
  const dir = b.clone().sub(a).normalize()
  const ref = Math.abs(dir.z) > 0.9 ? Y_ : V().crossVectors(Z_, dir).normalize() // major axis stays in the bike plane
  sweep(mb, [a, b], { bone: o.bone ?? B.bike, slot: o.slot ?? S.frame, r: o.round ? r : [r * aspect, r], shape: o.round ? 'ellipse' : shape, ref, sides: aspect > 1.2 ? 12 : 10 })
  if (t.lugs && o.lugs !== false) for (const [p, q] of [[a, dir], [b, dir.clone().negate()]]) {
    const c = p.clone().addScaledVector(q, 0.022)
    sweep(mb, [p.clone().addScaledVector(q, 0.004), c.clone().addScaledVector(q, 0.012)], { bone: o.bone ?? B.bike, slot: t.lugContrast ? S.frameAccent : S.frame, r: (u) => r * lerp(1.32, 1.08, u), ref, sides: 10 })
  }
  if (t.welds && o.lugs !== false) for (const p of [a, b]) sweep(mb, [p.clone().addScaledVector(dir, p === a ? 0.004 : -0.012), p.clone().addScaledVector(dir, p === a ? 0.012 : -0.004)], { bone: o.bone ?? B.bike, slot: S.frame, r: r * 1.12, ref, sides: 10, cap: false })
}
// A grid of vertices built from a (u, v) → [position, normal] function (bone-local), pc = (u, v): decals, plates.
function patch(mb, bone, slot, nu, nv, fn, aux, pcOf = (u, v) => V(u, v, 0)) {
  const R = mb.rest[bone], nm = new THREE.Matrix3().getNormalMatrix(R), base = mb.n
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const [p, n] = fn(i / nu, j / nv); mb.vert(p.clone().applyMatrix4(R), n.clone().applyMatrix3(nm).normalize(), [bone], [1], slot, pcOf(i / nu, j / nv), aux) }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1; mb.orient(a, b, c); mb.orient(a, c, d) }
}
// the maker's wordmark wrapped round both sides of a straight tube (shader samples the brand texture, pc = u along, v across)
function tubeDecal(mb, a, b, r, t, from, to, bone = B.bike) {
  const aspect = t.shape === 'kamm' || t.shape === 'aero' ? t.aspect ?? 1.8 : 1, kamm = t.shape === 'kamm'
  const dir = b.clone().sub(a).normalize(), n = V().crossVectors(Z_, dir).normalize()
  const ra = r * aspect + 0.0007, rb = r + 0.0007, half = 0.5
  for (const side of [1, -1]) patch(mb, bone, S.logo, 6, 2, (u, v) => {
    const s = side > 0 ? lerp(from, to, u) : lerp(to, from, u) // each side reads left to right, seen from that side
    const th = Math.PI / 2 + lerp(half, -half, v) // v = 0 is the letters' baseline, on the tube's lower side
    let cx = Math.cos(th), cy = Math.sin(th) * side
    if (kamm) { if (cx < 0) cx *= 0.72; cy = Math.sign(cy) * Math.abs(cy) ** 0.8 }
    const c = a.clone().lerp(b, s)
    const p = c.clone().addScaledVector(n, cx * ra).addScaledVector(Z_, cy * rb)
    return [p, V().addScaledVector(n, cx / ra).addScaledVector(Z_, cy / rb).normalize()]
  }, [SP.logo, 0, 0], (u, v) => V(u, v, side))
}

function buildBike(mb, rig, lo) {
  const { bk, fit } = rig
  const fr = lo.frame, t = fr.tubes, parts = fr.parts, style = lo.bars.style
  const lod = mb.lod
  // --- frame (bike bone)
  const ssTop = t.stays === 'dropped' ? bk.bb.clone().addScaledVector(bk.stDir, bk.clusterLen - (t.dropY ?? 0.08)) : bk.cluster.clone().addScaledVector(bk.stDir, -0.018)
  frameTube(mb, bk.dtFront, bk.bb, t.dt, t)
  frameTube(mb, bk.ttFront, bk.cluster, t.tt, t)
  frameTube(mb, bk.bb, bk.cluster.clone().addScaledVector(bk.stDir, 0.035), t.st, t)
  sweep(mb, [bk.htTop.clone().addScaledVector(bk.up, 0.012), bk.htBot.clone().addScaledVector(bk.down, 0.014)], { bone: B.bike, slot: S.frame, r: (u) => t.ht * lerp(0.92, t.shape === 'steel' ? 1.02 : 1.14, u), sides: 14 })
  if (t.lugs) for (const p of [bk.htTop, bk.htBot]) sweep(mb, [p.clone().addScaledVector(bk.up, 0.018), p.clone().addScaledVector(bk.down, 0.018)], { bone: B.bike, slot: t.lugContrast || lo.finish.finish === 'chrome' ? S.frameAccent : S.frame, r: t.ht * 1.22, sides: 14 })
  sweep(mb, [bk.htTop.clone().addScaledVector(bk.up, 0.013), bk.htTop.clone().addScaledVector(bk.down, 0.02)], { bone: B.bike, slot: S.frameAccent, r: t.ht * 1.03, sides: 14, cap: false })
  sweep(mb, [bk.cluster.clone().addScaledVector(bk.stDir, 0.02), bk.cluster.clone().addScaledVector(bk.stDir, 0.045)], { bone: B.bike, slot: S.frameAccent, r: t.st * 1.18, sides: 10 })
  sweep(mb, [bk.bb.clone().setZ(-0.036), bk.bb.clone().setZ(0.036)], { bone: B.bike, slot: S.frame, r: 0.021, sides: 12, ref: Y_ })
  for (const s of [1, -1]) {
    const drop = bk.rear.clone().setZ(0.066 * s)
    frameTube(mb, bk.bb.clone().add(V(-0.012, 0, 0.034 * s)), drop.clone().add(V(0.012, 0, 0)), t.cs, { ...t, shape: t.shape === 'kamm' ? 'aero' : t.shape }, { lugs: false })
    frameTube(mb, drop.clone().add(V(0.004, 0.012, 0)), ssTop.clone().setZ(0.021 * s), t.ss, { ...t, shape: t.shape === 'kamm' ? 'aero' : t.shape, aspect: 1.4 }, { lugs: false })
    mb.geo(new THREE.CylinderGeometry(0.019, 0.019, 0.006, 10, 1).rotateX(Math.PI / 2), B.bike, lo.finish.finish === 'chrome' ? S.frameAccent : S.frame, TR(drop.x + 0.006, drop.y + 0.002, drop.z)) // dropout plate
  }
  if (lo.p.logos !== false) mb.accessory('logo', () => tubeDecal(mb, bk.bb, bk.dtFront, t.dt, t, 0.24, 0.8))
  // --- fork (fork bone): crown + blades by style
  const nrm = V(Math.sin(bk.hta), Math.cos(bk.hta), 0)
  const fs = lo.fork.style, wide = fs === 'aero'
  mb.geo(sphere(1, 10, 6), B.fork, lo.finish.finish === 'chrome' && fs === 'curved' ? S.frameAccent : S.frame, place(bk.htBot.clone().addScaledVector(bk.down, 0.02), qAxis(Z_, -(Math.PI / 2 - bk.hta)), V(0.03, 0.02, wide ? 0.072 : 0.05)))
  for (const s of [1, -1]) {
    const top = bk.htBot.clone().addScaledVector(bk.down, 0.022).setZ((wide ? 0.058 : 0.042) * s)
    const axle = bk.front.clone().setZ(0.052 * s), end = axle.clone().addScaledVector(bk.up, 0.02)
    const r0 = t.fork
    if (fs === 'curved') {
      const onAxis = bk.htTop.clone().addScaledVector(bk.down, (bk.htTop.y - bk.front.y) / Math.sin(bk.hta)).setZ(0.05 * s)
      const p1 = top.clone().lerp(onAxis, 0.55).setZ(0.05 * s), p2 = top.clone().lerp(onAxis, 0.86).addScaledVector(nrm, 0.012).setZ(0.051 * s)
      sweep(mb, [top, p1, p2, end], { bone: B.fork, slot: S.frame, r: (u) => r0 * lerp(1.1, 0.72, u), samples: 10, ref: nrm, sides: 8 })
      if (lo.finish.finish === 'chrome') sweep(mb, [p2.clone().lerp(end, 0.2), end.clone().addScaledVector(bk.up, -0.004)], { bone: B.fork, slot: S.frameAccent, r: r0 * 0.78, sides: 8, ref: nrm })
    } else {
      const dir = end.clone().sub(top).normalize(), ref = V().crossVectors(Z_, dir).normalize()
      sweep(mb, [top, end], { bone: B.fork, slot: S.frame, r: (u) => { const r = r0 * lerp(wide ? 1.1 : 1.15, 0.7, u); return wide ? [r * 2.3, r * 0.9] : [r * 1.5, r] }, shape: wide ? 'kamm' : 'ellipse', ref, sides: 8 })
    }
  }
  // --- cockpit (fork bone)
  const up = bk.up, stemDir = fit.stemDir
  sweep(mb, [bk.htTop.clone().addScaledVector(up, 0.012), fit.steererTop.clone().addScaledVector(up, 0.012)], { bone: B.fork, slot: fr.cockpit.stemStyle === 'quill' ? S.metal : S.hood, r: fr.cockpit.stemStyle === 'quill' ? 0.012 : 0.0165, sides: 12 })
  if (fr.cockpit.stemStyle === 'quill') sweep(mb, [fit.steererTop, fit.clampPt.clone().addScaledVector(stemDir, 0.012)], { bone: B.fork, slot: S.metal, r: 0.011, sides: 10 })
  else sweep(mb, [fit.steererTop.clone().addScaledVector(stemDir, -0.012), fit.clampPt.clone().addScaledVector(stemDir, 0.018)], { bone: B.fork, slot: S.hood, r: [0.017, 0.02], ref: up, sides: 10 })
  buildBars(mb, rig, lo, style)
  // --- saddle + post (bike bone)
  const contact = fit.contact
  const postTop = contact.clone().addScaledVector(bk.stDir, -0.045)
  sweep(mb, [bk.cluster.clone().addScaledVector(bk.stDir, 0.02), postTop], { bone: B.bike, slot: t.shape === 'kamm' ? S.frame : S.metal, r: t.shape === 'kamm' ? [0.02, 0.011] : 0.0136, ref: V().crossVectors(Z_, bk.stDir), sides: 10 })
  buildSaddle(mb, rig, lo)
  buildDrivetrain(mb, rig, lo)
  const dtDir = bk.dtFront.clone().sub(bk.bb).normalize(), dtUp = V(-dtDir.y, dtDir.x, 0)
  // --- shifting: cable loops (mechanical), battery bumps (electric), down-tube levers
  const gs = lo.groupset.style, dropFamily = ['drop', 'aero', 'flare', 'clipon'].includes(style)
  if (dropFamily && gs !== 'elec') mb.accessory('cables', () => {
    const C = fit.clampPt
    for (const s of [1, -1]) sweep(mb, [V(C.x + 0.064, C.y - 0.006, 0.17 * s), V(C.x + 0.13, C.y - 0.06, 0.14 * s), bk.htTop.clone().addScaledVector(bk.down, 0.03).add(V(0.075, 0, 0.05 * s)), bk.htTop.clone().addScaledVector(bk.down, 0.09).add(V(0.018, 0, 0.022 * s))], { bone: B.fork, slot: S.hood, r: 0.0026, sides: 3, samples: 4 })
  })
  if (gs === 'downtube') {
    const p = bk.dtFront.clone().lerp(bk.bb, 0.22)
    for (const s of [1, -1]) {
      mb.geo(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 8).rotateX(Math.PI / 2), B.bike, S.groupset, TR(p.x, p.y, (t.dt + 0.004) * s))
      sweep(mb, [p.clone().setZ((t.dt + 0.006) * s), p.clone().addScaledVector(dtUp, 0.045).addScaledVector(dtDir, -0.012).setZ((t.dt + 0.008) * s)], { bone: B.bike, slot: S.groupset, r: [0.0035, 0.006], ref: Z_, sides: 4 })
    }
    if (!lod) tube(mb, p.clone().addScaledVector(dtUp, -t.dt - 0.002), bk.bb.clone().addScaledVector(dtUp, -t.dt - 0.002).addScaledVector(dtDir, 0.05), 0.0018, { bone: B.bike, slot: S.hood, sides: 3 })
  }
  // --- brakes
  const brakes = parts.brakes
  const fc = bk.htBot.clone().addScaledVector(bk.down, 0.035).addScaledVector(nrm, 0.03)
  const rc = ssTop.clone().addScaledVector(bk.rear.clone().sub(ssTop).normalize(), 0.05).add(V(-0.012, 0, 0))
  if (brakes === 'rim' && gs === 'delta') {
    const prism = () => new THREE.CylinderGeometry(0.03, 0.03, 0.026, 3).rotateX(Math.PI / 2)
    mb.geo(prism(), B.fork, S.groupset, place(fc.clone().addScaledVector(nrm, 0.008), qAxis(Z_, -(Math.PI / 2 - bk.hta) + Math.PI)))
    mb.geo(prism(), B.bike, S.groupset, place(rc.clone().add(V(-0.008, 0, 0)), qAxis(Z_, Math.PI * 0.5)))
  } else if (brakes === 'rim') {
    mb.geo(new THREE.BoxGeometry(0.02, 0.05, 0.07), B.fork, S.groupset, place(fc, qAxis(Z_, -(Math.PI / 2 - bk.hta))))
    mb.geo(new THREE.BoxGeometry(0.02, 0.045, 0.07), B.bike, S.groupset, TR(rc.x, rc.y, 0))
  } else if (brakes === 'canti') {
    // cantilever arms on the fork blades and seat stays at rim height, with a straddle cable between them
    const fy = bk.front.y + bk.Rb * 0.93, ry = bk.rear.y + bk.Rb * 0.93
    const fx = bk.front.x - (fy - bk.front.y) * Math.cos(bk.hta) / Math.sin(bk.hta) * 0.4
    for (const s of [1, -1]) {
      sweep(mb, [V(fx, fy, 0.05 * s), V(fx + 0.012, fy + 0.035, 0.075 * s)], { bone: B.fork, slot: S.groupset, r: [0.006, 0.004], ref: Z_, sides: 4 })
      sweep(mb, [V(bk.rear.x + 0.03, ry, 0.05 * s), V(bk.rear.x + 0.02, ry + 0.035, 0.075 * s)], { bone: B.bike, slot: S.groupset, r: [0.006, 0.004], ref: Z_, sides: 4 })
    }
    tube(mb, V(fx + 0.012, fy + 0.035, -0.075), V(fx + 0.012, fy + 0.035, 0.075), 0.0015, { bone: B.fork, slot: S.hood, sides: 3 })
    tube(mb, V(bk.rear.x + 0.02, ry + 0.035, -0.075), V(bk.rear.x + 0.02, ry + 0.035, 0.075), 0.0015, { bone: B.bike, slot: S.hood, sides: 3 })
  } else if (brakes === 'disc') {
    mb.geo(new THREE.BoxGeometry(0.05, 0.028, 0.02), B.fork, S.groupset, TR(bk.front.x - 0.035, bk.front.y + 0.055, -0.058))
    mb.geo(new THREE.BoxGeometry(0.05, 0.028, 0.02), B.bike, S.groupset, TR(bk.rear.x + 0.06, bk.rear.y + 0.03, -0.058))
  }
  // --- bottles and cages
  const bstyle = lo.bottles.style, nb = lo.p.bottles
  const bottleProfile = (st) => {
    const B0 = S.bottle, C0 = S.bottleCap
    if (st === 'alu') return [{ r: 0.001, z: 0, slot: S.chrome }, { r: 0.031, z: 0.002, slot: S.chrome }, { r: 0.033, z: 0.02, slot: S.chrome }, { r: 0.033, z: 0.17, slot: S.chrome }, { r: 0.026, z: 0.2, slot: S.chrome }, { r: 0.012, z: 0.212, slot: S.chrome }, { r: 0.012, z: 0.212, slot: S.cork }, { r: 0.011, z: 0.232, slot: S.cork }, { r: 0.001, z: 0.234, slot: S.cork }]
    if (st === 'insulated') return [{ r: 0.001, z: 0, slot: B0 }, { r: 0.037, z: 0.002, slot: B0 }, { r: 0.04, z: 0.02, slot: B0 }, { r: 0.04, z: 0.07, slot: B0 }, { r: 0.04, z: 0.07, slot: C0 }, { r: 0.0405, z: 0.1, slot: C0 }, { r: 0.0405, z: 0.1, slot: B0 }, { r: 0.04, z: 0.16, slot: B0 }, { r: 0.034, z: 0.18, slot: B0 }, { r: 0.034, z: 0.18, slot: C0 }, { r: 0.021, z: 0.196, slot: C0 }, { r: 0.008, z: 0.214, slot: C0 }, { r: 0.001, z: 0.217, slot: C0 }]
    const band = st === 'striped'
    const pr = [{ r: 0.001, z: 0, slot: B0 }, { r: 0.034, z: 0.002, slot: B0 }, { r: 0.037, z: 0.02, slot: B0 }]
    if (band) for (const [z0, z1] of [[0.06, 0.08], [0.12, 0.14]]) pr.push({ r: 0.036, z: z0, slot: B0 }, { r: 0.036, z: z0, slot: C0 }, { r: 0.0362, z: z1, slot: C0 }, { r: 0.0362, z: z1, slot: B0 })
    pr.push({ r: 0.035, z: 0.09, slot: B0 }, { r: 0.037, z: 0.15, slot: B0 }, { r: 0.032, z: 0.18, slot: B0 }, { r: 0.032, z: 0.18, slot: C0 }, { r: 0.02, z: 0.195, slot: C0 }, { r: 0.008, z: 0.215, slot: C0 }, { r: 0.001, z: 0.218, slot: C0 })
    return pr.sort((x, y) => x.z - y.z)
  }
  const cageOpt = lo.opt.cages ?? 'alloy'
  const cageSlot = cageOpt === 'chrome' ? S.chrome : S.hood, cageR = cageOpt === 'carbon' ? [0.0045, 0.0065] : 0.0025
  const bottle = (base, axis, side, bone = B.bike) => {
    const q = qFromTo(Z_, axis)
    const off = bstyle === 'insulated' ? 0.015 + 0.04 : 0.012 + 0.037
    mb.tag('bottle', () => mb.revolve(bottleProfile(bstyle), bone, { m: place(base.clone().addScaledVector(side, off), q), segments: lod ? 7 : 10, outward: (p) => [p.r, p.z > 0.1 ? 1 : -1] }))
    // the arms wrap the bottle at its widest (a real cage holds it there), just outside its radius: visible from the side
    const rails = cageOpt === 'side' ? [1] : [1, -1]
    for (const s of rails) sweep(mb, [base.clone().addScaledVector(axis, 0.01).setZ(base.z + 0.018 * s), base.clone().addScaledVector(axis, 0.07).addScaledVector(side, off).setZ(base.z + (off - 0.012 + 0.0045) * s), base.clone().addScaledVector(axis, 0.13).addScaledVector(side, 0.012).setZ(base.z + 0.022 * s)], { bone, slot: cageSlot, r: cageR, sides: cageOpt === 'carbon' ? 4 : 3, samples: 4 })
    if (cageOpt === 'chrome') sweep(mb, [base.clone().addScaledVector(axis, 0.13).addScaledVector(side, 0.012).setZ(base.z - 0.022), base.clone().addScaledVector(axis, 0.15).addScaledVector(side, 0.05), base.clone().addScaledVector(axis, 0.13).addScaledVector(side, 0.012).setZ(base.z + 0.022)], { bone, slot: S.chrome, r: 0.0022, sides: 4, samples: 6 })
  }
  if (bstyle === 'rear') {
    // twin cages on a rail mount behind the saddle, angled up
    const sb = mb.meta.saddle, mount = V(sb.tailX - 0.02, sb.railY - 0.02, 0)
    const axis = V(-Math.cos(1.1), Math.sin(1.1), 0), side = V(-Math.sin(1.1), -Math.cos(1.1), 0)
    tube(mb, V(sb.tailX + 0.05, sb.railY, 0), mount, 0.006, { bone: B.bike, slot: S.hood, sides: 6 })
    for (let i = 0; i < nb; i++) { const z = nb === 1 ? 0 : i ? 0.045 : -0.045; bottle(mount.clone().setZ(z).addScaledVector(side, -0.04), axis, side) }
  } else {
    if (nb >= 1) bottle(bk.bb.clone().addScaledVector(dtDir, 0.2).addScaledVector(dtUp, t.dt), dtDir, dtUp)
    if (nb >= 2) { const fwd = V(Math.sin(bk.sta), Math.cos(bk.sta), 0); bottle(bk.bb.clone().addScaledVector(bk.stDir, 0.13).addScaledVector(fwd, t.st), bk.stDir, fwd) }
  }
  // --- bags
  const bag = lo.bags.style
  const tri = (inset = 0.12) => { const pts = [bk.ttFront.clone().addScaledVector(bk.down, 0.03), bk.cluster.clone().addScaledVector(bk.stDir, -0.03), bk.bb.clone().addScaledVector(bk.stDir, 0.12), bk.dtFront.clone().addScaledVector(dtDir, 0.12)]; const cen = pts.reduce((a, p) => a.add(p), V()).multiplyScalar(0.25); return pts.map((p) => p.lerp(cen, inset)) }
  const frameBag = (pts, slot) => mb.tag('frameBag', () => {
    const shp = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.y)))
    mb.geo(new THREE.ExtrudeGeometry(shp, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 1 }), B.bike, slot, TR(0, 0, -0.025))
    const a = pts[0], b = pts[1]
    tube(mb, a.clone().lerp(b, 0.08).setZ(0.038), a.clone().lerp(b, 0.92).setZ(0.038), 0.0022, { bone: B.bike, slot: S.bagAccent, sides: 3 }) // zip
  })
  if (parts.frameBag) { frameBag(tri(), S.leather); mb.meta.frameBag = tri() }
  if (bag === 'full') { frameBag(tri(), S.bag); mb.meta.frameBag = tri() }
  if (bag === 'half') { const p = tri(); const h = [p[0], p[1], p[1].clone().lerp(p[2], 0.42), p[0].clone().lerp(p[3], 0.42)]; frameBag(h, S.bag); mb.meta.frameBag = h }
  if (bag === 'toptube') mb.tag('bag', () => {
    const a = bk.ttFront.clone().addScaledVector(bk.cluster.clone().sub(bk.ttFront).normalize(), 0.035), dir = bk.cluster.clone().sub(bk.ttFront).normalize(), upT = V(-dir.y, dir.x, 0)
    const st = [0, 0.03, 0.08, 0.13, 0.15].map((s, i) => ({ t: s, slot: S.bag }))
    const bw = MUT.has('bagFat') ? 0.1 : 0.026
    axisLoft(mb, st, (s) => ({ c: a.clone().addScaledVector(dir, s).addScaledVector(upT, t.tt + 0.024), u: upT, v: Z_, ruP: 0.024, ruN: 0.024, rv: bw - 0.004 * (s / 0.15), n: 3.2 }), B.bike, { sides: 10, capStart: a.clone().addScaledVector(dir, -0.006).addScaledVector(upT, t.tt + 0.024), capEnd: a.clone().addScaledVector(dir, 0.156).addScaledVector(upT, t.tt + 0.024) })
    mb.meta.topBag = { a: a.clone().addScaledVector(upT, t.tt + 0.024), b: a.clone().addScaledVector(dir, 0.15).addScaledVector(upT, t.tt + 0.024), rUp: 0.024, rZ: bw }
  })
  if (bag === 'wedge') mb.tag('bag', () => {
    const sb = mb.meta.saddle, top = V(sb.tailX + 0.03, sb.railY - 0.012, 0)
    const st = [0, 0.03, 0.07, 0.1, 0.12].map((s) => ({ t: s, slot: S.bag }))
    axisLoft(mb, st, (s) => ({ c: top.clone().add(V(-s * 0.9, -0.024 - s * 0.12, 0)), u: V(0.15, 1, 0).normalize(), v: Z_, ruP: 0.022 + s * 0.08, ruN: 0.022 + s * 0.08, rv: 0.032 + s * 0.05, n: 3 }), B.bike, { sides: 10, capStart: top.clone().add(V(0.006, -0.024, 0)), capEnd: top.clone().add(V(-0.116, -0.04, 0)) })
    tube(mb, top.clone().add(V(-0.04, -0.01, -0.045)), top.clone().add(V(-0.04, -0.01, 0.045)), 0.004, { bone: B.bike, slot: S.bagAccent, sides: 4 })
  })
  if (bag === 'barroll') mb.tag('bagFork', () => {
    const C = fit.clampPt, c = V(C.x + 0.07, C.y - 0.07, 0)
    mb.geo(new THREE.CylinderGeometry(0.045, 0.045, 0.27, mb.sg(10)).rotateX(Math.PI / 2), B.fork, S.bag, TR(c.x, c.y, 0))
    for (const s of [1, -1]) mb.geo(new THREE.TorusGeometry(0.047, 0.004, 3, mb.sg(10)), B.fork, S.bagAccent, TR(c.x, c.y, 0.09 * s))
  })
  if (bag === 'rando' || parts.frontRack) mb.tag('frontRack', () => {
    const platY = bk.front.y + bk.R + 0.07
    const htX = bk.htTop.x + (bk.htTop.y - platY) / Math.tan(bk.hta)
    const x0 = Math.max(htX + 0.035, bk.front.x - 0.12), x1 = x0 + 0.24
    for (const s of [1, -1]) tube(mb, V(x0 + 0.02, platY, 0.045 * s), bk.front.clone().add(V(0.01, 0.03, 0.055 * s)), 0.0045, { bone: B.fork, slot: S.metal, sides: 4 })
    for (let i = 0; i < 3; i++) tube(mb, V(x0 + i * 0.1, platY, -0.06), V(x0 + i * 0.1, platY, 0.06), 0.004, { bone: B.fork, slot: S.metal, sides: 3 })
    for (const s of [1, -1]) tube(mb, V(x0, platY, 0.06 * s), V(x1, platY, 0.06 * s), 0.004, { bone: B.fork, slot: S.metal, sides: 3 })
    if (bag === 'rando') {
      const c = V((x0 + x1) / 2, platY + 0.085, 0)
      mb.geo(new THREE.BoxGeometry(x1 - x0 - 0.02, 0.16, 0.2, 1, 1, 1), B.fork, S.bag, TR(c.x, c.y, 0))
      mb.geo(new THREE.BoxGeometry(x1 - x0 - 0.012, 0.012, 0.21), B.fork, S.bagAccent, TR(c.x, c.y + 0.086, 0)) // leather lid
      mb.geo(new THREE.BoxGeometry(0.02, 0.08, 0.13), B.fork, S.bagAccent, TR(x1 - 0.004, c.y - 0.01, 0)) // front pocket
      mb.meta.randoBag = { min: V(x0 + 0.01, platY + 0.005, -0.105), max: V(x1 - 0.01, platY + 0.17, 0.105) }
    }
  })
  // --- fenders and racks (integral on the army bike and the randonneur; the Pendler kit elsewhere)
  const fenders = parts.fenders || lo.utility.style === 'pendler', fSlot = parts.fenders ? S.frame : S.hood, fGap = MUT.has('fenderTight') ? 0.002 : 0.02
  if (fenders) {
    const arc = (c, from, to, bone) => { const pts = []; for (let i = 0; i <= 10; i++) { const a = lerp(from, to, i / 10); pts.push(c.clone().add(V(Math.cos(a) * (bk.R + fGap), Math.sin(a) * (bk.R + fGap), 0))) } sweep(mb, pts, { bone, slot: fSlot, r: [Math.max(0.028, bk.tw * 0.78), 0.004], ref: Z_, samples: mb.lod ? 7 : 11, sides: 4 }) }
    mb.tag('fenderRear', () => arc(bk.rear, -0.25, 2.2, B.bike))
    mb.tag('fenderFront', () => arc(bk.front, 0.35, 2.6, B.fork))
    mb.meta.fenderR = bk.R + 0.02
  }
  if (parts.rack || lo.utility.style === 'pendler') mb.tag('rack', () => {
    const rSlot = parts.rack ? S.frame : S.metal
    const top = bk.rear.clone().add(V(0.02, bk.R + 0.07, 0))
    for (const s of [1, -1]) {
      tube(mb, bk.rear.clone().add(V(0.0, 0.01, 0.07 * s)), top.clone().add(V(-0.12, 0, 0.07 * s)), 0.0055, { bone: B.bike, slot: rSlot, sides: 4 })
      tube(mb, top.clone().add(V(-0.2, 0, 0.07 * s)), top.clone().add(V(0.14, 0, 0.07 * s)), 0.006, { bone: B.bike, slot: rSlot, sides: 4 })
      tube(mb, top.clone().add(V(0.14, 0, 0.07 * s)), ssTop.clone().add(V(0.01, -0.01, 0.024 * s)), 0.005, { bone: B.bike, slot: rSlot, sides: 4 })
    }
    for (let i = 0; i < 4; i++) tube(mb, top.clone().add(V(-0.18 + i * 0.1, 0, -0.07)), top.clone().add(V(-0.18 + i * 0.1, 0, 0.07)), 0.004, { bone: B.bike, slot: rSlot, sides: 3 })
  })
  // --- lights (never lit), bell, computer, charm, frame plate: small accessories, dropped at LOD1
  const C = fit.clampPt
  const lamp = () => {
    const c = bk.htBot.clone().addScaledVector(bk.down, 0.05).add(V(0.07, 0, 0))
    mb.geo(new THREE.CylinderGeometry(0.032, 0.028, 0.06, mb.sg(12), 1, true).rotateZ(Math.PI / 2), B.fork, parts.lamp ? S.frame : S.chrome, TR(c.x, c.y, c.z))
    mb.geo(new THREE.CircleGeometry(0.03, mb.sg(12)).rotateY(Math.PI / 2), B.fork, S.lightF, TR(c.x + 0.03, c.y, c.z))
    tube(mb, bk.htBot.clone().addScaledVector(bk.down, 0.03), c.clone().add(V(-0.03, 0, 0)), 0.005, { bone: B.fork, slot: S.metal, sides: 5 })
  }
  if (parts.lamp) lamp()
  const ls = lo.lights.style
  if (ls !== 'none') mb.accessory('lights', () => {
    if (ls === 'dynamo') {
      if (!parts.lamp) lamp()
      const d0 = bk.front.clone().add(V(-0.03, bk.R * 0.72, -0.05 - bk.tw * 0.5))
      mb.geo(new THREE.CylinderGeometry(0.014, 0.017, 0.075, 6), B.fork, S.chrome, place(d0, qAxis(Z_, 0.35)))
    } else {
      const f = V(C.x + 0.03, C.y - 0.026, -0.13)
      mb.geo(new THREE.CylinderGeometry(0.013, 0.013, 0.05, 7, 1, true).rotateZ(Math.PI / 2), B.fork, S.hood, TR(f.x, f.y, f.z))
      mb.geo(new THREE.CircleGeometry(0.013, 7).rotateY(Math.PI / 2), B.fork, S.lightF, TR(f.x + 0.025, f.y, f.z))
      tube(mb, f.clone().add(V(0, 0.01, 0)), V(f.x, C.y + 0.004, f.z), 0.004, { bone: B.fork, slot: S.hood, sides: 3 })
      const r = postTop.clone().addScaledVector(bk.stDir, -0.07)
      mb.geo(new THREE.BoxGeometry(0.016, 0.05, 0.03), B.bike, S.hood, TR(r.x - 0.022, r.y, 0))
      mb.geo(new THREE.PlaneGeometry(0.024, 0.042).rotateY(-Math.PI / 2), B.bike, S.lightR, TR(r.x - 0.0305, r.y, 0))
    }
  })
  const bellOpt = lo.bell.style === 'none' ? (parts.bell ? 'dome' : null) : lo.opt.bell ?? 'dome'
  if (bellOpt) {
    const doBell = () => {
      const rr = bellOpt === 'brass' ? 0.026 : bellOpt === 'ping' ? 0.015 : 0.022
      mb.geo(new THREE.SphereGeometry(rr, MUT.has('bigBell') ? 40 : 9, MUT.has('bigBell') ? 20 : 3, 0, TAU, 0, Math.PI / 2), B.fork, bellOpt === 'brass' ? S.brass : S.chrome, TR(C.x - 0.004, C.y + 0.018, -0.075))
      mb.geo(new THREE.CircleGeometry(rr, 9).rotateX(Math.PI / 2), B.fork, S.metal, TR(C.x - 0.004, C.y + 0.018, -0.075))
    }
    if (parts.bell && lo.bell.style === 'none') doBell(); else mb.accessory('bell', doBell)
  }
  const cs = lo.computer.style
  if (cs !== 'none') mb.accessory('computer', () => {
    if (cs === 'tacho') {
      const sh = lo.opt.computer ?? 'square', q = qAxis(Z_, 0.2)
      tube(mb, V(C.x + 0.012, C.y, 0), V(C.x + 0.075, C.y + 0.002, 0), 0.0055, { bone: B.fork, slot: S.hood, sides: 4 })
      const c = V(C.x + 0.094, C.y + 0.012, 0)
      if (sh === 'round') { mb.geo(new THREE.CylinderGeometry(0.027, 0.027, 0.014, 10), B.fork, S.hood, place(c, q)); mb.geo(new THREE.CircleGeometry(0.022, 10).rotateX(-Math.PI / 2), B.fork, S.screen, place(c.clone().add(V(-0.0015, 0.0072, 0)), q)) }
      else { const w = sh === 'wide' ? 0.072 : 0.05; mb.geo(new THREE.BoxGeometry(0.052, 0.014, w), B.fork, S.hood, place(c, q)); mb.geo(new THREE.PlaneGeometry(0.044, w - 0.008).rotateX(-Math.PI / 2), B.fork, S.screen, place(c.clone().add(V(-0.0015, 0.0072, 0)), q)) }
    } else {
      const c = fit.steererTop.clone().addScaledVector(bk.up, 0.03)
      mb.geo(new THREE.BoxGeometry(0.036, 0.018, 0.03), B.fork, S.hood, place(c, qAxis(Z_, 0.35)))
      mb.geo(new THREE.PlaneGeometry(0.026, 0.022).rotateX(-Math.PI / 2), B.fork, S.screen, place(c.clone().add(V(-0.003, 0.0092, 0)), qAxis(Z_, 0.35)))
      sweep(mb, [c.clone().add(V(0, -0.01, 0.012)), bk.htBot.clone().add(V(0.01, 0, 0.03)), bk.front.clone().add(V(-0.02, bk.Rb * 0.5, 0.05))], { bone: B.fork, slot: S.hood, r: 0.0016, sides: 3, samples: 5 })
    }
  })
  const charm = lo.charm.style
  if (charm !== 'none') mb.accessory('charm', () => {
    const sb = mb.meta.saddle
    if (charm === 'cowbell' || charm === 'lantern') {
      const h = V(sb.tailX + 0.07, sb.railY - 0.014, 0)
      tube(mb, h, h.clone().add(V(0, -0.025, 0)), 0.002, { bone: B.bike, slot: S.leather, sides: 3 })
      if (charm === 'cowbell') mb.geo(new THREE.CylinderGeometry(0.011, 0.018, 0.028, 7), B.bike, S.brass, TR(h.x, h.y - 0.04, 0))
      else { mb.geo(new THREE.CylinderGeometry(0.014, 0.014, 0.034, 7), B.bike, S.charm, TR(h.x, h.y - 0.044, 0)); mb.geo(new THREE.ConeGeometry(0.016, 0.012, 7, 1, true), B.bike, S.metal, TR(h.x, h.y - 0.021, 0)) }
    } else if (charm === 'lampion') {
      const h = V(C.x + 0.01, C.y - 0.01, -0.16)
      tube(mb, h, h.clone().add(V(0, -0.03, 0)), 0.0015, { bone: B.fork, slot: S.hood, sides: 3 })
      mb.geo(new THREE.SphereGeometry(1, 6, 3), B.fork, S.charm, place(h.clone().add(V(0, -0.058, 0)), new THREE.Quaternion(), V(0.024, 0.03, 0.024)))
      for (const dy of [-0.03, -0.086]) mb.geo(new THREE.CylinderGeometry(0.01, 0.01, 0.006, 6), B.fork, S.hood, TR(h.x, h.y + dy, h.z))
    } else if (charm === 'hammer') {
      const dir = bk.cluster.clone().sub(bk.ttFront).normalize(), upT = V(-dir.y, dir.x, 0)
      for (const s of [1, -1]) {
        const c = bk.ttFront.clone().lerp(bk.cluster, 0.62).setZ((t.tt + 0.0012) * s)
        mb.geo(new THREE.BoxGeometry(0.07, 0.006, 0.0012), B.bike, S.metal, place(c, qFromTo(X_, dir)))
        mb.geo(new THREE.BoxGeometry(0.014, 0.022, 0.0016), B.bike, S.metal, place(c.clone().addScaledVector(dir, 0.035), qFromTo(X_, dir)))
      }
      void upT
    }
  })
  if (lo.plate.style === 'frame') mb.accessory('plate', () => {
    const sb = mb.meta.saddle, c = V(sb.tailX + 0.02, sb.railY - 0.06, 0)
    for (const side of [1, -1]) patch(mb, B.bike, S.plate, 1, 1, (u, v) => [V(c.x + (side > 0 ? u - 0.5 : 0.5 - u) * 0.12, c.y + (v - 0.5) * 0.08, 0.0012 * side), V(0, 0, side)], [SP.plate, 0, 0])
    tube(mb, c.clone().add(V(0.04, 0.035, 0)), V(sb.tailX + 0.07, sb.railY - 0.01, 0), 0.003, { bone: B.bike, slot: S.metal, sides: 4 })
  })
}

function buildBars(mb, rig, lo, styleIn) {
  const { fit, bk } = rig
  const style = barKey(styleIn)
  const C = fit.clampPt, P = (x, y, z) => V(C.x + x, C.y + y, z)
  const tape = S.barTape, bone = B.fork, TAPE = [SP.tape, 0, 0]
  sweep(mb, [P(0, 0, -0.024), P(0, 0, 0.024)], { bone, slot: S.hood, r: 0.02, sides: 10, ref: Y_ }) // stem clamp
  const bar = BARS[style] ?? BARS.drop
  if (style === 'drop' || style === 'aero' || style === 'flare' || style === 'track') {
    const flare = style === 'flare' ? 0.045 : 0
    const deep = style === 'track' ? 1.2 : 1
    const reachX = style === 'track' ? 0.07 : 0.082
    for (const s of [1, -1]) {
      const pts = [P(0, 0, 0.0), P(0.0, 0.002, 0.1 * s), P(0.03, 0.004, 0.16 * s), P(reachX - 0.004, 0.0, 0.195 * s), P(reachX + 0.012, -0.04 * deep, 0.2 * s), P(reachX - 0.01, -0.095 * deep, (0.2 + flare * 0.6) * s), P(-0.005, -0.118 * deep, (0.2 + flare) * s), P(-0.075, -0.112 * deep, (0.2 + flare * 1.1) * s)]
      if (style === 'aero') {
        sweep(mb, pts.slice(0, 4), { bone, slot: S.hood, r: (u) => [0.0075, lerp(0.022, 0.016, u)], ref: Y_, samples: 10, sides: 8, cap: false })
        sweep(mb, pts.slice(3), { bone, slot: tape, r: 0.0125, samples: 12, sides: 7, uv: true, aux: TAPE })
      } else {
        sweep(mb, pts.slice(0, 3), { bone, slot: S.hood, r: 0.0122, samples: 5, sides: 7, cap: false })
        sweep(mb, pts.slice(2), { bone, slot: tape, r: 0.0122, samples: 16, sides: 7, uv: true, aux: TAPE })
      }
      if (style !== 'track') {
        // hood body (lever) and the lever blade
        const hb = P(reachX + 0.004, 0.004, 0.198 * s), ht = P(bar.hoods[0] + 0.028, bar.hoods[1] + 0.012, 0.198 * s)
        sweep(mb, [hb, P((reachX + bar.hoods[0]) / 2 + 0.01, bar.hoods[1] + 0.006, 0.199 * s), ht], { bone, slot: S.hood, r: (u) => [lerp(0.017, 0.013, u) + 0.01 * Math.sin(u * Math.PI), 0.0135], ref: Y_, samples: 6, sides: 8 })
        sweep(mb, [P(bar.hoods[0] + 0.02, bar.hoods[1] - 0.004, 0.2 * s), P(bar.hoods[0] + 0.024, -0.05, 0.203 * s), P(bar.hoods[0] - 0.006, -0.1, 0.205 * s)], { bone, slot: S.groupset, r: [0.0045, 0.0075], ref: Z_, samples: 5, sides: 5 })
      }
    }
    if (styleIn === 'clipon') for (const s of [1, -1]) {
      // clip-on extensions: two bars forward from the tops, arm pads on short risers (the hands stay on the hoods)
      tube(mb, P(0.012, 0.008, 0.07 * s), P(0.012, 0.046, 0.07 * s), 0.008, { bone, slot: S.hood, sides: 4 })
      mb.geo(new THREE.BoxGeometry(0.1, 0.014, 0.05), bone, S.hood, TR(C.x + 0.005, C.y + 0.052, 0.07 * s))
      sweep(mb, [P(-0.01, 0.036, 0.055 * s), P(0.1, 0.034, 0.05 * s), P(0.2, 0.05, 0.045 * s), P(0.235, 0.075, 0.042 * s)], { bone, slot: tape, r: 0.0105, samples: 6, sides: 5, uv: true, aux: TAPE })
    }
  } else if (style === 'bullhorn') {
    for (const s of [1, -1]) {
      sweep(mb, [P(0, 0, 0), P(0.004, 0.002, 0.1 * s), P(0.03, 0.006, 0.17 * s), P(0.07, 0.014, 0.19 * s)], { bone, slot: S.hood, r: 0.0122, samples: 8, sides: 7, cap: false })
      sweep(mb, [P(0.07, 0.014, 0.19 * s), P(0.12, 0.024, 0.19 * s), P(0.175, 0.038, 0.188 * s)], { bone, slot: tape, r: 0.0125, samples: 8, sides: 7, uv: true, aux: TAPE })
      sweep(mb, [P(0.11, 0.018, 0.19 * s), P(0.12, -0.03, 0.194 * s), P(0.1, -0.07, 0.196 * s)], { bone, slot: S.groupset, r: [0.0045, 0.0075], ref: Z_, samples: 5, sides: 5 })
    }
  } else if (style === 'tt') {
    for (const s of [1, -1]) {
      sweep(mb, [P(0, 0, 0), P(0.02, -0.004, 0.1 * s), P(0.09, -0.016, 0.18 * s), P(0.16, -0.026, 0.2 * s), P(0.2, -0.03, 0.2 * s)], { bone, slot: (u) => (u > 0.6 ? tape : S.frame), r: (u) => (u > 0.6 ? 0.013 : [0.02, 0.007]), ref: Y_, samples: 18, sides: 8 })
      const padL = fit.pad.clone().setZ(0.085 * s), padC = V(padL.x, padL.y, padL.z)
      tube(mb, P(0.02, 0, 0.075 * s), padC.clone().add(V(0.0, -0.012, 0)), 0.009, { bone, slot: S.frame, sides: 8 })
      mb.geo(new THREE.CapsuleGeometry(0.03, 0.07, 3, 10).rotateZ(Math.PI / 2).scale(1, 0.35, 1), bone, S.hood, TR(padC.x, padC.y - 0.006, padC.z))
      const tip = rig.fit.grips.aero[s > 0 ? 'R' : 'L'].p
      sweep(mb, [padC.clone().add(V(-0.02, -0.03, -0.022 * s)), padC.clone().add(V(0.08, -0.026, -0.022 * s)), tip.clone().add(V(-0.03, -0.022, 0)), tip.clone().add(V(0.02, 0.005, 0))], { bone, slot: (u) => (u > 0.72 ? tape : S.frame), r: 0.0105, samples: 16, sides: 8 })
    }
  } else if (style === 'upright') {
    for (const s of [1, -1]) {
      const g = bar.hoods
      sweep(mb, [P(0, 0, 0), P(0.01, 0.012, 0.1 * s), P(-0.05, 0.05, 0.2 * s), P(g[0] + 0.02, g[1], (g[2] - 0.005) * s), P(g[0] - 0.07, g[1] + 0.004, (g[2] + 0.006) * s)], { bone, slot: S.metal, r: 0.011, samples: 20, sides: 8 })
      const gc = P(g[0], g[1], g[2] * s), ax = V(-0.95, 0.02, 0.3 * s).normalize()
      sweep(mb, [gc.clone().addScaledVector(ax, -0.05), gc.clone().addScaledVector(ax, 0.07)], { bone, slot: S.leather, r: 0.017, sides: 10 })
    }
  }
}

function buildSaddle(mb, rig, lo) {
  const { fit } = rig
  const style = lo.saddle.style
  const c = fit.contact // top-centre contact point
  const len = style === 'short' ? 0.24 : 0.27
  const hwTail = style === 'leather' ? 0.085 : style === 'short' ? 0.074 : style === 'lattice' ? 0.072 : 0.068
  const noseX = style === 'short' ? 0.1 : 0.15, tailX = noseX - len
  const hw = curve([[tailX, hwTail * 0.8], [tailX + 0.04, hwTail], [tailX + 0.1, hwTail * 0.92], [noseX - 0.1, style === 'short' ? 0.05 : 0.03], [noseX - 0.03, 0.022], [noseX, 0.012]])
  const topY = curve([[tailX, 0.006], [tailX + 0.05, 0.002], [noseX - 0.1, -0.001], [noseX - 0.04, 0.0], [noseX, -0.004]])
  const th = style === 'leather' ? 0.028 : 0.018
  const base = V(c.x + 0.035, c.y, 0) // the sit bones land just behind the saddle's middle
  const pat = { cutout: 1, lattice: 2, suede: 3 }[style] ?? 0
  const st = []
  const N = mb.lod ? 6 : 9
  for (let i = 0; i <= N; i++) st.push({ t: tailX + (len * i) / N, slot: style === 'leather' ? S.leather : S.saddle, aux: pat ? [SP.saddle, pat, 0] : A0 })
  axisLoft(mb, st, (x) => ({ c: V(base.x + x, base.y + topY(x) - th / 2, 0), u: Y_, v: Z_, ruP: th / 2, ruN: th / 2, rv: hw(x), n: 3 }), B.bike, { sides: 12, capStart: V(base.x + tailX - 0.004, base.y - th / 2, 0), capEnd: V(base.x + noseX + 0.004, base.y - th / 2 - 0.003, 0), pcOf: (p) => p.clone().sub(base) })
  for (const s of [1, -1]) sweep(mb, [V(base.x + tailX + 0.03, base.y - th + 0.002, 0.03 * s), V(base.x - 0.04, base.y - th - 0.018, 0.022 * s), V(base.x + noseX - 0.05, base.y - th - 0.012, 0.012 * s), V(base.x + noseX - 0.02, base.y - th + 0.003, 0.006 * s)], { bone: B.bike, slot: S.metal, r: 0.0035, sides: 4, samples: 6 })
  if (style === 'leather') for (const s of [1, -1]) {
    const coil = []
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * TAU * 2.5; coil.push(V(base.x + tailX + 0.035 + Math.cos(a) * 0.011, base.y - th - 0.006 - (i / 12) * 0.03, 0.045 * s + Math.sin(a) * 0.011)) }
    sweep(mb, coil, { bone: B.bike, slot: S.metal, r: 0.0028, sides: 3, samples: mb.lod ? 8 : 12 })
    if (!mb.lod) for (let i = 0; i < 3; i++) mb.geo(new THREE.OctahedronGeometry(0.0038, 0), B.bike, S.brass, TR(base.x + tailX + 0.02 + i * 0.03, base.y - 0.003, (hwTail - 0.006 - i * 0.008) * s))
  }
  mb.geo(new THREE.BoxGeometry(0.03, 0.02, 0.05), B.bike, S.metal, TR(base.x - 0.03, base.y - th - 0.018, 0))
  mb.meta.saddle = { tailX: base.x + tailX, noseX: base.x + noseX, railY: base.y - th - 0.012, base }
}

function buildDrivetrain(mb, rig, lo) {
  const { bk, fit } = rig
  const fr = lo.frame, parts = fr.parts, lod = mb.lod
  const c = fit.crank, pz = fit.pedalZ, grp = S.groupset, acc = lo.gsFinish.finish === 'anodised' ? S.anodised : grp // anodised accents: rings and jockey wheels in colour
  const seg = lod ? 14 : 22
  const cs = lo.crank.style, rs = lo.ring.style
  const armSlot = cs === 'five' ? S.chrome : grp
  // oval rings: a non-uniform scale about the BB, aligned with the crank (1980s) or across it (modern)
  const ovalM = rs === 'oval83' ? M4().makeScale(1.075, 0.935, 1) : rs === 'oval' ? M4().makeScale(0.935, 1.075, 1) : null
  const ringProf = [{ r: 0.086, z: 0.0538, slot: acc }, { r: 0.1015, z: 0.0538, slot: acc }, { r: 0.1015, z: 0.0525, slot: S.chain }, { r: 0.107, z: 0.0525, slot: S.chain }, { r: 0.107, z: 0.0595, slot: S.chain }, { r: 0.1015, z: 0.0595, slot: S.chain }, { r: 0.1015, z: 0.0582, slot: acc }, { r: 0.086, z: 0.0582, slot: acc }]
  mb.revolve(ringProf, B.crank, { closed: true, segments: seg, m: ovalM })
  if ((parts.rings ?? 2) > 1) mb.revolve([{ r: 0.07, z: 0.047, slot: grp }, { r: 0.083, z: 0.047, slot: grp }, { r: 0.083, z: 0.051, slot: grp }, { r: 0.07, z: 0.051, slot: grp }], B.crank, { closed: true, segments: seg, m: ovalM })
  if (rs === 'cover') mb.revolve([{ r: 0.02, z: 0.0632, slot: grp }, { r: 0.1, z: 0.0632, slot: grp }, { r: 0.1, z: 0.0605, slot: grp }], B.crank, { segments: seg, outward: () => [0.3, 1] })
  if (rs === 'army') mb.revolve([{ r: 0.022, z: 0.0545, slot: grp, aux: [SP.ringcut, 5, 0] }, { r: 0.087, z: 0.0545, slot: grp, aux: [SP.ringcut, 5, 0] }, { r: 0.087, z: 0.0575, slot: grp, aux: [SP.ringcut, 5, 0] }, { r: 0.022, z: 0.0575, slot: grp, aux: [SP.ringcut, 5, 0] }], B.crank, { closed: true, segments: seg })
  else if (cs === 'hollow') mb.revolve([{ r: 0.02, z: 0.0615, slot: grp }, { r: 0.07, z: 0.0615, slot: grp }, { r: 0.07, z: 0.059, slot: grp }], B.crank, { segments: seg, outward: () => [0.3, 1] })
  else {
    const arms = cs === 'five' ? 5 : 4
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU + (arms === 4 ? Math.PI / 4 : 0)
      mb.geo(new THREE.BoxGeometry(0.075, cs === 'five' ? 0.012 : 0.016, 0.006), B.crank, armSlot, place(V(Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0.06), qAxis(Z_, a)))
    }
  }
  const armR = cs === 'hollow' ? (u) => [lerp(0.022, 0.016, u), 0.0065] : cs === 'five' ? (u) => [lerp(0.014, 0.0095, u), 0.0068] : (u) => [lerp(0.017, 0.011, u), 0.0062]
  for (const s of [1, -1]) {
    const zA = 0.069 * s
    sweep(mb, [V(0, 0, zA), V(s * c, 0, zA)], { bone: B.crank, slot: armSlot, r: armR, ref: Y_, sides: 10 })
    const inner = pz - (PEDAL_INNER[lo.pedals.style] ?? PEDAL_INNER.road) + 0.004 - (MUT.has('shortSpindle') ? 0.012 : 0) // the spindle ends 4 mm inside the pedal body
    mb.tag('spindle', () => sweep(mb, [V(s * c, 0, 0.074 * s), V(s * c, 0, inner * s)], { bone: B.crank, slot: S.metal, r: 0.0055, sides: 6, ref: Y_ }))
    if (mb.bikeOnly) { const d = riderDims(lo.body); pedalGeometry(mb, B.crank, V(s * c, 0, s * pz), s, lo.pedals.style, shoeShape(d, lo), V(s * c - d.cleat.x, -d.cleat.y, 0)) }
  }
  sweep(mb, [V(0, 0, -0.07), V(0, 0, 0.07)], { bone: B.crank, slot: S.metal, r: 0.012, sides: 8, ref: Y_ })
  // chain runs (bike bone; static by design — the ring's spider shows the rotation)
  const cogR = parts.derailleur ? 0.045 : 0.04
  const ringTop = bk.bb.clone().add(V(0, 0.105, 0.056)), cogTop = bk.rear.clone().add(V(0, cogR, 0.04))
  const links = (a, b) => sweep(mb, [a, b], { bone: B.bike, slot: S.chain, r: [0.0045, 0.0035], ref: Y_, sides: 6 })
  links(ringTop, cogTop)
  if (parts.derailleur) {
    const jockey = bk.rear.clone().add(V(0.012, -0.078, 0.052))
    links(bk.bb.clone().add(V(0, -0.105, 0.056)), jockey)
    sweep(mb, [bk.rear.clone().add(V(0.004, -0.012, 0.07)), bk.rear.clone().add(V(0.01, -0.045, 0.072)), jockey.clone().setZ(0.066)], { bone: B.bike, slot: grp, r: [0.012, 0.007], ref: Z_, samples: 6, sides: 8 })
    const jSlot = acc === grp ? S.hood : acc
    mb.geo(new THREE.CylinderGeometry(0.011, 0.011, 0.008, mb.sg(8)).rotateX(Math.PI / 2), B.bike, jSlot, TR(jockey.x, jockey.y, 0.056))
    mb.geo(new THREE.CylinderGeometry(0.011, 0.011, 0.008, mb.sg(8)).rotateX(Math.PI / 2), B.bike, jSlot, TR(jockey.x + 0.006, jockey.y + 0.05, 0.056))
    if (lo.groupset.style === 'elec') mb.geo(new THREE.BoxGeometry(0.03, 0.02, 0.014), B.bike, S.hood, TR(bk.rear.x + 0.008, bk.rear.y - 0.03, 0.084)) // battery bump
    if ((parts.rings ?? 2) > 1) {
      const fd = bk.bb.clone().addScaledVector(bk.stDir, 0.16)
      mb.geo(new THREE.BoxGeometry(0.05, 0.014, 0.02), B.bike, grp, TR(fd.x + 0.018, fd.y - 0.012, 0.05))
      if (lo.groupset.style === 'elec') mb.geo(new THREE.BoxGeometry(0.022, 0.02, 0.014), B.bike, S.hood, TR(fd.x + 0.02, fd.y + 0.004, 0.064))
    }
  } else links(bk.bb.clone().add(V(0, -0.105, 0.056)), bk.rear.clone().add(V(0, -cogR, 0.04)))
  if (parts.brakes === 'coaster') tube(mb, bk.rear.clone().setZ(-0.06), bk.rear.clone().add(V(0.16, -0.02, -0.058)), 0.006, { bone: B.bike, slot: S.metal, sides: 6 })
}

// Wheel: tyre (tread/wall), rim (sidewalls carry the decal rule), hub, spokes as a blur-safe shader disc, disc/blades variants.
function buildWheel(mb, rig, lo, which) {
  const bone = which === 'front' ? B.frontWheel : B.rearWheel
  const { bk } = rig
  const w = lo.wheelSpec[which], dec = lo.wheels.decal ?? { count: 0, arcDeg: 0 }
  const lod = mb.lod, seg = (lod ? 18 : 32) * (MUT.has('hiPoly') ? 3 : 1)
  const Rb = bk.Rb, R = bk.R, rt = bk.rt
  const tread = lo.tyres.tread, wall = lo.tyres.wall, tub = lo.tyres.casing === 'tubular'
  // tyre: circle cross-section, tread band on top, walls may be coloured
  const Rc = R - rt, prof = []
  const nT = lod ? 5 : 7, span = tub ? 0.72 : 0.62
  const TR_AUX = tread === 'file' ? [SP.tread, rt, 0] : A0
  for (let i = 0; i <= nT; i++) {
    const beta = -Math.PI * span + (i / nT) * Math.PI * 2 * span // skip the part hidden inside the rim
    const onTread = Math.abs(beta) < 0.62
    prof.push({ r: Rc + rt * Math.cos(beta), z: rt * Math.sin(beta), slot: onTread || wall === 'black' ? S.tyre : S.tyreWall, aux: TR_AUX })
  }
  const prof2 = []
  for (let i = 0; i < prof.length; i++) { if (i > 0 && prof[i].slot !== prof[i - 1].slot) prof2.push({ ...prof[i - 1], slot: prof[i].slot, n: undefined }); prof2.push(prof[i]) }
  mb.revolve(prof2, bone, { segments: seg, outward: (p) => [p.r - Rc, p.z] })
  if (tread === 'knob') for (let i = 0; i < (lod ? 12 : 22); i++) {
    const a = (i / (lod ? 12 : 22)) * TAU, beta = (i % 2 ? 1 : -1) * 0.42
    const rr = Rc + (rt - 0.0011) * Math.cos(beta), zz = (rt - 0.0011) * Math.sin(beta)
    mb.geo(new THREE.CylinderGeometry(0.0038, 0.0058, 0.0038, 4, 1, true).rotateY(Math.PI / 4).rotateZ(-Math.PI / 2), bone, S.tyre, place(V(Math.cos(a) * rr, Math.sin(a) * rr, zz), new THREE.Quaternion().setFromEuler(new THREE.Euler(-beta, 0, a, 'ZYX'))))
  }
  const rimW = 0.013 + rt * 0.25
  const finishSlot = S.rim
  if (w.type === 'disc') {
    const hz = 0.03
    const D = [SP.decal, dec.count, dec.arcDeg * DEG]
    const dprof = [{ r: 0.03, z: hz, slot: finishSlot, aux: D }, { r: Rb - 0.02, z: rimW * 0.95, slot: finishSlot, aux: D }, { r: Rb - 0.02, z: rimW * 0.95, slot: finishSlot }, { r: Rb, z: rimW * 0.8, slot: finishSlot }, { r: Rb, z: -rimW * 0.8, slot: finishSlot }, { r: Rb - 0.02, z: -rimW * 0.95, slot: finishSlot }, { r: Rb - 0.02, z: -rimW * 0.95, slot: finishSlot, aux: D }, { r: 0.03, z: -hz, slot: finishSlot, aux: D }]
    mb.revolve(dprof, bone, { segments: seg, closed: true, outward: (p) => [p.r > Rb - 0.001 ? 1 : 0, p.z] })
  } else {
    const depth = w.depth ?? 0.03, ri = Rb - depth
    const decal = [SP.decal, dec.count, dec.arcDeg * DEG]
    const rprof = [
      { r: ri, z: 0.0, slot: finishSlot }, { r: ri + depth * 0.18, z: rimW * 0.8, slot: finishSlot },
      { r: ri + depth * 0.18, z: rimW * 0.8, slot: finishSlot, aux: decal }, { r: Rb, z: rimW, slot: finishSlot, aux: decal },
      { r: Rb, z: rimW, slot: finishSlot }, { r: Rb, z: -rimW, slot: finishSlot },
      { r: Rb, z: -rimW, slot: finishSlot, aux: decal }, { r: ri + depth * 0.18, z: -rimW * 0.8, slot: finishSlot, aux: decal },
      { r: ri + depth * 0.18, z: -rimW * 0.8, slot: finishSlot }
    ]
    mb.revolve(rprof, bone, { segments: seg, closed: true, outward: (p) => [p.r - (ri + depth * 0.5), p.z] })
    const blades = w.type === 'blades'
    const aux = blades ? [SP.blades, w.blades ?? 3, w.bladeMm ?? 34] : [SP.spokes, w.spokes ?? 24, 2.2]
    for (const s of [1, -1]) {
      const z = s * (blades ? 0.012 : 0.017)
      mb.revolve([{ r: 0.024, z, slot: S.spokes, aux, n: [0, s] }, { r: ri + 0.002, z: z * 0.35, slot: S.spokes, aux, n: [0, s] }], bone, { segments: seg })
    }
  }
  // hub shell by style (+ cassette on the rear right, disc rotor on the left)
  const hs = lo.hub.style
  const hubSeg = lod ? 8 : 10
  const shell = hs === 'straight' ? [[0.001, -0.052], [0.012, -0.052], [0.02, -0.04], [0.022, 0], [0.02, 0.04], [0.012, 0.052], [0.001, 0.052]]
    : hs === 'high' ? [[0.001, -0.055], [0.014, -0.055], [0.034, -0.03], [0.034, -0.024], [0.016, -0.018], [0.016, 0.018], [0.034, 0.024], [0.034, 0.03], [0.014, 0.055], [0.001, 0.055]]
      : hs === 'large' ? [[0.001, -0.055], [0.014, -0.055], [0.044, -0.032], [0.044, -0.027], [0.017, -0.02], [0.017, 0.02], [0.044, 0.027], [0.044, 0.032], [0.014, 0.055], [0.001, 0.055]]
        : [[0.001, -0.055], [0.014, -0.055], [0.028, -0.028], [0.016, -0.02], [0.016, 0.02], [0.028, 0.028], [0.014, 0.055], [0.001, 0.055]]
  const hubSlot = hs === 'large' ? S.chrome : S.metal
  mb.revolve(shell.map(([r, z]) => ({ r, z, slot: hs === 'high' && r > 0.03 ? S.anodised : hubSlot })), bone, { segments: hubSeg, outward: (p) => [p.r, p.z] })
  if (which === 'rear') {
    const fr = lo.frame.parts
    if (fr.brakes === 'coaster') mb.revolve([{ r: 0.001, z: -0.05, slot: S.metal }, { r: 0.034, z: -0.05, slot: S.metal }, { r: 0.036, z: 0, slot: S.metal }, { r: 0.034, z: 0.05, slot: S.metal }, { r: 0.001, z: 0.05, slot: S.metal }], bone, { segments: 16, outward: (p) => [p.r, p.z] })
    const cp = fr.derailleur ? [[0.05, 0.024], [0.05, 0.03], [0.038, 0.036], [0.026, 0.05], [0.012, 0.05]] : [[0.04, 0.037], [0.04, 0.043], [0.012, 0.043]]
    mb.revolve(cp.map(([r, z]) => ({ r, z, slot: S.groupset })), bone, { segments: lod ? 12 : 18, outward: (p) => [p.r, 1] })
  }
  if (lo.frame.parts.brakes === 'disc') mb.revolve([{ r: 0.056, z: -0.0495, slot: S.metal }, { r: 0.08, z: -0.0495, slot: S.metal }, { r: 0.08, z: -0.0465, slot: S.metal }], bone, { segments: lod ? 10 : 16, outward: () => [0.2, -1] })
}

// ---------------------------------------------------------------- material
let ramp
export function toonRamp() {
  if (ramp) return ramp
  // Three bands, TF2-style: the shadow band is lifted (never black); nearest filter = hard terminator.
  ramp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1)
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter
  ramp.needsUpdate = true
  return ramp
}
// Scene-wide light terms shared by every rider material (update uSunV each frame: sun direction in VIEW space).
export const lightRig = { uSunV: { value: V(0.3, 0.5, -0.8).normalize() }, uRimSun: { value: new THREE.Color('#ffcfa3').multiplyScalar(0.35) }, uRimSky: { value: new THREE.Color('#8fa0d6').multiplyScalar(0.12) } }

const SLOT_DEFINES = SLOTS.map((n, i) => `#define SL_${n} ${i}`).join('\n')
const FRAG_PARS = /* glsl */ `
${SLOT_DEFINES}
flat varying float vSlot;
varying vec3 vPc;
flat varying vec3 vAux;
uniform int uPattern;
uniform vec3 uKitB;
uniform vec3 uKitC;
uniform vec3 uDecal;
uniform float uTorsoT;
uniform float uTorsoW;
uniform float uWheelDelta;
uniform float uDecalStyle;
uniform vec3 uSunV;
uniform vec3 uRimSun;
uniform vec3 uRimSky;
uniform int uSock; uniform float uSockH; uniform float uLegL; uniform vec3 uSockB;
uniform int uShorts; uniform vec3 uShortsB;
uniform int uLayer; uniform vec3 uLayerB;
uniform float uPlate; uniform float uPlateF;
uniform int uTape; uniform vec3 uTapeB;
uniform int uFinish; uniform int uFinishOpt; uniform vec3 uFrameB;
uniform vec3 uLens;
uniform int uCap; uniform vec3 uCapB;
uniform int uDeco; uniform vec3 uHelmetB; uniform vec4 uHeadK;
uniform int uCut; uniform float uMusette; uniform vec3 uBagC;
uniform sampler2D uLogo; uniform float uLogoOn;
float gSheen = 0.0;
float gMirror = 0.0;
float aa(float edge, float x) { float w = max(fwidth(x), 1e-4) * 0.75; return smoothstep(edge - w, edge + w, x); }
float fillSd(float d) { return 1.0 - aa(0.0, d); }
float triw(float x) { return abs(fract(x) - 0.5) * 2.0; }
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdTri(vec2 p, float w, float h) { p.x = abs(p.x); return max(p.y - h, max(-p.y, (p.x * h + p.y * w - w * h) / length(vec2(h, w)))); } // base on y=0, apex at (0,h)
float covF(float x, float P, float w) { return floor(x / P) * w + min(mod(x, P), w); }
// fraction of the angular window [phi - win - h, phi + h] covered by features of width w every P radians
float sweepCover(float phi, float win, float h, float P, float w) {
  float b = phi + h; float a = b - win; // win: the whole window, motion + pixel footprint
  return clamp((covF(b, P, w) - covF(a, P, w)) / max(win, 1e-5), 0.0, 1.0);
}
float angFoot(float phi) { return min(fwidth(phi), fwidth(fract(phi / 6.2831853 + 0.5) * 6.2831853)); }
// Motion-blur window for a k-fold pattern: the true per-frame sweep while slow (< 0.2 P), a whole period once the
// sweep reaches 0.35 P, so the pattern goes to its uniform average instead of strobing (mirrored by blurWindow in JS).
float blurWin(float d, float P) {
  if (d >= 0.35 * P) return P * max(1.0, ceil(d / P - 1e-4));
  return mix(d, P, smoothstep(0.2 * P, 0.35 * P, d));
}
// seven-segment digits for race numbers (never chosen: they come from the start list)
float digit7(vec2 p, int d) {
  int m = d == 0 ? 63 : d == 1 ? 6 : d == 2 ? 91 : d == 3 ? 79 : d == 4 ? 102 : d == 5 ? 109 : d == 6 ? 125 : d == 7 ? 7 : d == 8 ? 127 : 111;
  float r = 1e3;
  if ((m & 1) != 0) r = min(r, sdSeg(p, vec2(0.2, 1.4), vec2(0.8, 1.4)));
  if ((m & 2) != 0) r = min(r, sdSeg(p, vec2(0.8, 1.4), vec2(0.8, 0.78)));
  if ((m & 4) != 0) r = min(r, sdSeg(p, vec2(0.8, 0.72), vec2(0.8, 0.1)));
  if ((m & 8) != 0) r = min(r, sdSeg(p, vec2(0.2, 0.1), vec2(0.8, 0.1)));
  if ((m & 16) != 0) r = min(r, sdSeg(p, vec2(0.2, 0.72), vec2(0.2, 0.1)));
  if ((m & 32) != 0) r = min(r, sdSeg(p, vec2(0.2, 1.4), vec2(0.2, 0.78)));
  if ((m & 64) != 0) r = min(r, sdSeg(p, vec2(0.2, 0.75), vec2(0.8, 0.75)));
  return r - 0.1;
}
// white plate with a three-digit number; q in [0,1]^2
vec3 plateKit(vec3 c, vec2 q, float n) {
  vec3 ink = vec3(0.07, 0.07, 0.09);
  float inside = fillSd(sdBox(q - 0.5, vec2(0.5)));
  vec3 o = mix(c, vec3(0.94, 0.93, 0.9), inside);
  float nn = floor(n + 0.5); int d0 = int(mod(floor(nn / 100.0), 10.0)), d1 = int(mod(floor(nn / 10.0), 10.0)), d2 = int(mod(nn, 10.0));
  vec2 p = (q - vec2(0.14, 0.18)) * vec2(3.8, 2.1);
  float s = min(digit7(p, d0), min(digit7(p - vec2(1.05, 0.0), d1), digit7(p - vec2(2.1, 0.0), d2)));
  o = mix(o, ink, fillSd(s) * inside);
  for (int i = 0; i < 4; i++) { vec2 pin = vec2(i == 0 || i == 3 ? 0.06 : 0.94, i < 2 ? 0.1 : 0.9); o = mix(o, vec3(0.75, 0.76, 0.8), fillSd(length((q - pin) * vec2(1.0, 0.6)) - 0.02)); }
  return o;
}
vec2 cellOf(vec2 g, out vec2 id) { g.x += 0.5 * mod(floor(g.y), 2.0); id = floor(g); return fract(g) - 0.5; }
float edelweissSd(vec2 f, float r0) { float a = atan(f.y, f.x); return length(f) - r0 * (0.4 + 0.6 * pow(abs(cos(2.5 * a)), 0.7)); }
vec3 jassMotif(vec3 c, vec2 f, vec2 id, vec3 ink, vec3 acc) {
  float k = mod(id.x + id.y * 2.0, 3.0);
  if (k < 0.5) { c = mix(c, ink, fillSd(abs(length(f) - 0.22) - 0.05)); c = mix(c, acc, fillSd(length(f) - 0.08)); }
  else if (k < 1.5) { float d = min(length(f - vec2(0.0, 0.03)) - 0.2, sdBox(f - vec2(0.0, -0.17), vec2(0.07, 0.05))); c = mix(c, ink, fillSd(d)); c = mix(c, acc, fillSd(length(f - vec2(0.0, 0.03)) - 0.07)); }
  else { c = mix(c, ink, fillSd(length((f - vec2(0.0, -0.05)) * vec2(1.25, 0.9)) - 0.2)); c = mix(c, acc, fillSd(sdBox(f - vec2(0.0, 0.14), vec2(0.18, 0.06)))); }
  return c;
}
vec3 torsoKit(vec3 A, vec3 p) {
  float u = p.y / uTorsoT; float v = p.z / uTorsoW; float ang = atan(p.z, p.x);
  if (uPattern == 1) { return mix(A, uKitB, aa(0.62, triw(u * 2.6 + 0.12))); }
  if (uPattern == 2) { float d = u - 0.52 - 0.5 * v; vec3 c = mix(A, uKitC, 1.0 - aa(0.13, abs(d))); return mix(c, uKitB, 1.0 - aa(0.1, abs(d))); }
  if (uPattern == 3) { vec3 c = mix(A, uKitC, 1.0 - aa(0.05, abs(abs(v) - 0.2))); return mix(c, uKitB, 1.0 - aa(0.1, abs(v))); }
  if (uPattern == 4) { vec3 c = mix(A, uKitB, smoothstep(0.05, 0.95, u)); return mix(c, uKitC, 1.0 - aa(0.025, abs(u + 0.1))); }
  if (uPattern == 5) { float y = 0.74 + 0.1 * v * v; vec3 c = mix(A, uKitB, aa(y, u)); return mix(c, uKitC, 1.0 - aa(0.018, abs(u - y))); }
  if (uPattern == 6) { vec3 c = mix(A, uKitB, aa(0.7, abs(v))); return mix(c, uKitC, 1.0 - aa(0.035, abs(abs(v) - 0.7))); }
  if (uPattern == 7) { float y = 0.66 - 0.4 * abs(v); vec3 c = mix(A, uKitB, aa(y + 0.05, u)); return mix(c, uKitC, 1.0 - aa(0.05, abs(u - y))); }
  if (uPattern == 8) { vec2 g = vec2(ang / 3.14159265 * 3.2, u * 5.4); g.x += 0.5 * mod(floor(g.y), 2.0); vec2 f = fract(g) - 0.5; float dd = length(f * vec2(1.0, 1.1)); return mix(A, uKitB, 1.0 - aa(0.26, dd)); }
  if (uPattern == 9) { return mix(A, uKitB, aa(0.82, triw((u + v * 0.9) * 7.0))); }
  if (uPattern == 10) { float y = 0.56 - 0.34 * abs(v); vec3 c = mix(A, uKitB, aa(0.78, u)); c = mix(c, uKitC, 1.0 - aa(0.055, abs(u - y))); return mix(c, uKitB, aa(0.86, abs(v))); }
  if (uPattern == 11) { vec3 c = mix(A, uKitC, aa(0.22, v + 0.25 * (u - 0.4)) * (1.0 - aa(0.6, u))); c = mix(c, uKitB, aa(0.6, u)); return mix(c, uKitC, 1.0 - aa(0.03, abs(u - 0.6))); }
  if (uPattern == 12) { vec2 g = vec2(ang * 2.4, u * 7.5); vec3 c = mix(A, mix(A, uKitB, 0.22), step(0.5, mod(floor(g.x) + floor(g.y), 2.0))); vec2 f = abs(fract(g) - 0.5); c = mix(c, uKitB, 1.0 - aa(0.07, 0.5 - f.x)); return mix(c, uKitC, 1.0 - aa(0.05, 0.5 - f.y)); }
  if (uPattern == 13) { float f = u * 8.0 + 0.9 * sin(ang * 2.0 + u * 3.0) + 0.6 * sin(v * 5.0 - u * 4.0); float d = abs(fract(f) - 0.5) * 2.0; float major = step(mod(floor(f + 0.5), 5.0), 0.5); return mix(A, major > 0.5 ? uKitC : uKitB, aa(major > 0.5 ? 0.8 : 0.88, d)); }
  if (uPattern == 14) {
    vec3 c = A; float band = aa(0.28, u) * (1.0 - aa(0.86, u));
    vec2 id; vec2 f = cellOf(vec2(ang * 2.6, u * 6.2), id); float a = atan(f.y, f.x); float r = length(f);
    float lace = fillSd(abs(r - (0.34 + 0.025 * cos(12.0 * a))) - 0.025);
    float pet = fillSd(length(f - 0.19 * vec2(cos(floor(a / 1.0472 + 0.5) * 1.0472), sin(floor(a / 1.0472 + 0.5) * 1.0472))) - 0.075);
    lace = max(lace, max(pet, fillSd(r - 0.06)));
    float scal = fillSd(abs(u - 0.28 - 0.025 * abs(sin(ang * 8.0))) - 0.008) + fillSd(abs(u - 0.86 + 0.025 * abs(sin(ang * 8.0))) - 0.008);
    c = mix(c, uKitC, clamp(lace * band + scal, 0.0, 1.0));
    return mix(c, uKitB, fillSd(length(fract(vec2(ang * 7.0, u * 16.0)) - 0.5) - 0.12) * (1.0 - band) * 0.7);
  }
  if (uPattern == 15) { vec2 id; vec2 f = cellOf(vec2(ang * 2.3, u * 5.2), id); vec3 c = mix(A, uKitC, fillSd(edelweissSd(f, 0.26))); return mix(c, uKitB, fillSd(length(f) - 0.055)); }
  if (uPattern == 16) { vec2 id; vec2 f = cellOf(vec2(ang * 2.2, u * 5.0), id); return jassMotif(A, f * 1.1, id, uKitB, uKitC); }
  if (uPattern == 17) {
    float y = (u - 0.42) / 0.26; vec3 c = A;
    c = mix(c, uKitB, fillSd(abs(y + 0.06) - 0.012) + fillSd(abs(y - 1.06) - 0.012));
    if (y > 0.0 && y < 1.0) {
      float px = ang * 1.6; float cell = floor(px); vec2 q = vec2(fract(px) - 0.5, y); float k = mod(cell, 4.0); float d = 1e3;
      if (k < 0.5 || k > 2.5) d = min(sdTri(q - vec2(0.0, 0.08), 0.22, 0.5), min(sdTri(q - vec2(0.0, 0.34), 0.17, 0.46), sdBox(q - vec2(0.0, 0.04), vec2(0.03, 0.05))));
      else if (k < 1.5) { d = sdBox(q - vec2(0.0, 0.42), vec2(0.26, 0.13)); for (int i = 0; i < 4; i++) d = min(d, sdBox(q - vec2(-0.2 + float(i) * 0.13, 0.17), vec2(0.03, 0.13))); d = min(d, sdBox(q - vec2(0.3, 0.55), vec2(0.07, 0.07))); d = min(d, sdSeg(q, vec2(0.3, 0.62), vec2(0.36, 0.72)) - 0.02); }
      else { d = min(sdBox(q - vec2(0.0, 0.3), vec2(0.24, 0.22)), sdTri(q - vec2(0.0, 0.5), 0.34, 0.36)); d = max(d, -sdBox(q - vec2(0.0, 0.22), vec2(0.05, 0.1))); }
      c = mix(c, uKitB, fillSd(d));
    }
    return c;
  }
  if (uPattern == 18) { vec3 c = mix(A, uKitB, aa(0.8, u) + 1.0 - aa(0.16, u)); c = mix(c, uKitC, 1.0 - aa(0.03, abs(abs(v) - 0.74))); return mix(c, uKitC, 1.0 - aa(0.02, abs(u - 0.5))); }
  if (uPattern == 19) { vec3 c = mix(A, uKitC, smoothstep(0.2, 0.85, u)); for (int i = 0; i < 3; i++) { float y = 0.28 + float(i) * 0.14 + 0.025 * sin(ang * 4.0 + float(i)); c = mix(c, mix(c, uKitB, 0.45), 1.0 - aa(0.018, abs(u - y))); } return c; }
  if (uPattern == 20) { vec2 g = vec2(ang * 6.0, u * 14.0); vec2 id = floor(g); vec2 f = fract(g) - 0.5 + (vec2(hash21(id), hash21(id + 7.1)) - 0.5) * 0.4; float h = hash21(id + 3.3); vec3 col = h < 0.33 ? uKitB : h < 0.66 ? uKitC : mix(uKitB, uKitC, 0.5); return mix(A, col, fillSd(length(f) - 0.17) * step(0.35, hash21(id + 1.7))); }
  return A;
}
vec3 sleeveKit(vec3 A, vec3 p) {
  float t = p.x * 4.0;
  if (uPattern == 1) return mix(A, uKitB, aa(0.62, triw(t * 2.2 + 0.2)));
  if (uPattern == 2 || uPattern == 3 || uPattern == 7 || uPattern == 17) return mix(A, uKitC, 1.0 - aa(0.05, abs(t - 0.62)));
  if (uPattern == 4 || uPattern == 5 || uPattern == 6 || uPattern == 10 || uPattern == 11 || uPattern == 18) return uKitB;
  if (uPattern == 8) { vec2 g = vec2(p.y * 7.0, t * 4.0); g.x += 0.5 * mod(floor(g.y), 2.0); float dd = length(fract(g) - 0.5); return mix(A, uKitB, 1.0 - aa(0.26, dd)); }
  if (uPattern == 9) return mix(A, uKitB, aa(0.82, triw((t + p.y) * 4.0)));
  if (uPattern == 12) { vec2 f = abs(fract(vec2(p.y * 8.0, t * 5.0)) - 0.5); return mix(mix(A, uKitB, 1.0 - aa(0.07, 0.5 - f.x)), uKitC, 1.0 - aa(0.05, 0.5 - f.y)); }
  if (uPattern == 13) { float f = t * 6.0 + 0.8 * sin(p.y * 12.566); return mix(A, uKitB, aa(0.88, abs(fract(f) - 0.5) * 2.0)); }
  if (uPattern == 14) return mix(A, uKitC, fillSd(abs(t - 0.62 - 0.02 * sin(p.y * 50.0)) - 0.02));
  if (uPattern == 15) { vec2 id; vec2 f = cellOf(vec2(p.y * 6.0, t * 3.0), id); return mix(A, uKitC, fillSd(edelweissSd(f, 0.28))); }
  if (uPattern == 16) { vec2 id; vec2 f = cellOf(vec2(p.y * 5.0, t * 2.6), id); return jassMotif(A, f * 1.1, id, uKitB, uKitC); }
  if (uPattern == 19) return mix(A, uKitC, 0.6);
  if (uPattern == 20) { vec2 g = vec2(p.y * 12.0, t * 8.0); vec2 id = floor(g); vec2 f = fract(g) - 0.5; return mix(A, hash21(id) < 0.5 ? uKitB : uKitC, fillSd(length(f) - 0.18) * step(0.4, hash21(id + 1.7))); }
  return A;
}
// gilets and jackets: a front zip, a mesh back, side panels, a star field
vec3 layerKit(vec3 A, vec3 p) {
  float u = p.y / uTorsoT; float v = p.z / uTorsoW; vec3 c = A;
  float front = step(0.0, p.x);
  if (uLayer == 4) { vec2 g = vec2(atan(p.z, p.x) * 5.0, u * 12.0); vec2 id = floor(g); vec2 f = fract(g) - 0.5 + (vec2(hash21(id), hash21(id + 4.2)) - 0.5) * 0.5; c = mix(c, uLayerB, fillSd(length(f) - 0.07 - 0.05 * hash21(id + 2.0)) * step(0.45, hash21(id + 9.0))); }
  if (uLayer == 1 || uLayer == 4) { float mesh = (1.0 - front) * (1.0 - aa(0.55, abs(v))) * aa(0.12, u) * (1.0 - aa(0.86, u)); c = mix(c, mix(c, vec3(1.0), 0.12) * (0.92 + 0.08 * step(0.5, fract(p.y * 180.0) + fract(p.z * 180.0) - 0.5)), mesh); }
  if (uLayer == 3) c = mix(c, uLayerB, aa(0.72, abs(v)));
  if (uLayer == 2) c = mix(c, c * 0.8, 1.0 - aa(0.006, abs(abs(v) - 0.92)));
  c = mix(c, vec3(0.1, 0.1, 0.12), front * (1.0 - aa(0.0035, abs(p.z))) * aa(0.02, u)); // zip
  return c;
}
// leg space: pc.x = along the limb (0 hip, 1 ankle), pc.y = around, pc.z = side
vec3 sockKit(vec3 A, float y, float a) {
  if (uSock == 1) return mix(A, uSockB, fillSd(abs(y - 0.8) - 0.045) + fillSd(abs(y - 0.92) - 0.03));
  if (uSock == 2) { float z = abs(fract(a * 14.0) - 0.5) * 2.0; float l = fillSd(abs(y - 0.5 - 0.11 * z) - 0.022) + fillSd(abs(y - 0.66 - 0.11 * z) - 0.022); vec2 f = fract(vec2(a * 28.0, y * 16.0)) - 0.5; float dots = fillSd(length(f) - 0.16) * (1.0 - aa(0.4, y)) * aa(0.15, y); return mix(A, uSockB, clamp(l + dots, 0.0, 1.0)); }
  if (uSock == 3) { vec2 id; vec2 f = cellOf(vec2(a * 9.0, y * 3.4), id); return jassMotif(A, f * 1.15, id, uSockB, mix(uSockB, A, 0.5)) ; }
  if (uSock == 4) { vec2 id; vec2 f = cellOf(vec2(a * 7.0, y * 2.8), id); return mix(A, uSockB, fillSd(edelweissSd(f, 0.28))); }
  if (uSock == 5) { vec2 g = vec2(a * 10.0, y * 5.0); return mix(A, uSockB, 0.85 * step(0.5, mod(floor(g.x) + floor(g.y), 2.0))); }
  if (uSock == 6) return mix(A, uSockB, fillSd(abs(y - 0.74) - 0.12));
  if (uSock == 7) return mix(A, uSockB, 1.0 - aa(0.018, abs(fract(y * 7.0) - 0.5) * 0.143));
  if (uSock == 8) { vec2 g = vec2(a * 16.0, y * 7.0); vec2 id = floor(g); vec2 f = fract(g) - 0.5 + (vec2(hash21(id), hash21(id + 3.0)) - 0.5) * 0.5; return mix(A, uSockB, fillSd(length(f) - 0.14) * step(0.4, hash21(id + 5.0))); }
  if (uSock == 9) { float prof = 0.52 + 0.1 * sin(a * 6.2832 * 3.0) + 0.14 * max(0.0, sin(a * 6.2832 * 2.0 + 1.0)) + 0.05 * sin(a * 6.2832 * 7.0); return mix(A, uSockB, aa(0.3, y) * (1.0 - aa(prof, y))); }
  return A;
}
vec3 frameKit(vec3 A, vec3 p, int slot) {
  vec3 c = A;
  if (uFinish == 1) gSheen = 1.0;
  else if (uFinish == 2) gSheen = 0.45;
  else if (uFinish == 3) { gSheen = 0.8; c *= 0.9 + 0.2 * hash21(floor(p.xy * 1400.0) + floor(p.z * 1400.0)); }
  else if (uFinish == 4 && slot == SL_frame) { float tw = mod(floor((p.x + p.y) * 260.0) + floor((p.x - p.y + p.z) * 260.0), 2.0); c = mix(vec3(0.045, 0.045, 0.055), vec3(0.12, 0.12, 0.14), tw) + A * 0.08; gSheen = 1.0; }
  else if (uFinish == 5 && slot == SL_frame) { c = mix(A, uFrameB, smoothstep(-0.2, 0.55, p.x + 0.35 * p.y)); gSheen = 0.6; }
  else if (uFinish == 6) { gSheen = 0.9; if (slot == SL_frameAccent) { c = vec3(0.8, 0.82, 0.86); gMirror = 0.7; gSheen = 1.3; } }
  else if (uFinish == 7 && slot == SL_frame) {
    float m = 0.0;
    if (uFinishOpt == 0) m = aa(0.0, p.y - 0.64 - 0.55 * (p.x - 0.1));
    else if (uFinishOpt == 1) m = fillSd(abs(fract(p.x * 3.2 + 0.1) - 0.5) - 0.13);
    else m = aa(0.72, p.y);
    c = mix(A, uFrameB, m); gSheen = 0.8;
  }
  else if (uFinish == 8 && slot == SL_frame) { c = mix(A, uFrameB, 1.0 - aa(0.0025, abs(fract(p.x * 18.0) - 0.5) / 18.0)); gSheen = 0.5; }
  return c;
}
vec3 tapeKit(vec3 A, vec2 p) {
  float w = p.x / 0.024 + p.y; float lap = 1.0 - aa(0.08, fract(w));
  if (uTape == 1) return A * (0.82 + 0.34 * hash21(floor(vec2(p.x * 1200.0, p.y * 40.0)))) * (1.0 - 0.2 * lap);
  if (uTape == 2) { float st = (1.0 - aa(0.03, abs(p.y - 0.5))) * step(0.5, fract(p.x * 140.0)); return mix(A * (1.0 - 0.12 * lap), uTapeB, st); }
  if (uTape == 3) { vec2 f = fract(vec2(p.x * 110.0, p.y * 14.0)) - 0.5; return mix(A, A * 0.45, fillSd(length(f) - 0.18)); }
  if (uTape == 4) { vec3 c = mix(A, vec3(0.5, 0.33, 0.14), 0.45); gSheen = 0.6; return c * (1.0 - 0.35 * lap) * (0.94 + 0.06 * step(0.5, fract(p.x * 400.0))); }
  if (uTape == 5) return mix(A, uTapeB, step(0.5, fract(w * 0.5))) * (1.0 - 0.15 * lap);
  return A * (1.0 - 0.22 * lap);
}
vec3 capKit(vec3 A, vec3 p) {
  vec3 r = (p - vec3(uHeadK.xy, 0.0)) / uHeadK.z; float a = atan(r.z, r.x); float y = r.y;
  if (uCap == 1) return A * (0.85 + 0.15 * step(0.5, fract(a * 14.0)));
  if (uCap == 2) return mix(A, uCapB, 0.8 * step(0.5, mod(floor(a * 3.0) + floor(y * 30.0), 2.0)));
  if (uCap == 3) return mix(A, uCapB, step(0.5, fract(y * 22.0)));
  if (uCap == 4 || uCap == 5) return mix(A, uCapB, 1.0 - aa(uCap == 5 ? 0.02 : 0.03, y + 0.0));
  if (uCap == 6) return mix(A, vec3(0.95, 0.92, 0.86), smoothstep(0.0, 0.1, y) * 0.55);
  if (uCap == 7) { float prof = 0.035 + 0.02 * sin(a * 3.0) + 0.02 * max(0.0, sin(a * 2.0 + 1.0)); return mix(A, uCapB, aa(0.0, y) * (1.0 - aa(prof, y))); }
  return A;
}
`
export function riderMaterial(rimColor, rimStrength) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() })
  m.alphaToCoverage = true // spokes, lenses, cut-outs: coverage, not blending — no sorting, one draw
  const C = (x) => ({ value: new THREE.Color(x) })
  const u = {
    uPattern: { value: 0 }, uKitB: C('#24222c'), uKitC: C('#f2eff6'), uDecal: C('#f2eff6'), uTorsoT: { value: 0.5 }, uTorsoW: { value: 0.17 }, uWheelDelta: { value: 0 }, uDecalStyle: { value: 1 },
    uSock: { value: 0 }, uSockH: { value: 0.11 }, uLegL: { value: 0.885 }, uSockB: C('#3f78d9'), uShorts: { value: 0 }, uShortsB: C('#3f78d9'), uLayer: { value: 0 }, uLayerB: C('#f2c230'),
    uPlate: { value: 0 }, uPlateF: { value: 0 }, uTape: { value: 0 }, uTapeB: C('#f2eff6'), uFinish: { value: 0 }, uFinishOpt: { value: 0 }, uFrameB: C('#f2eff6'), uLens: { value: V(1, 0, 0) },
    uCap: { value: 0 }, uCapB: C('#2b44b8'), uDeco: { value: 0 }, uHelmetB: C('#24222c'), uHeadK: { value: new THREE.Vector4(0.0756, 0.1404, 1.08, 0) }, uCut: { value: 0 }, uMusette: { value: 0 }, uBagC: C('#33313c'),
    uLogo: { value: null }, uLogoOn: { value: 0 }
  }
  m.userData.u = u
  m.userData.rim = rimColor === undefined ? null : { color: new THREE.Color(rimColor), strength: rimStrength ?? 0.35 }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, lightRig)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute float slot;\nattribute vec3 pc;\nattribute vec3 aux;\nflat varying float vSlot;\nvarying vec3 vPc;\nflat varying vec3 vAux;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlot = slot; vPc = pc; vAux = aux;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', FRAG_PARS + '\n#include <common>')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        int sp = int(vAux.x + 0.5);
        int sl = int(vSlot + 0.5);
        if (sp == 1) {
          if (sl == SL_layer) diffuseColor.rgb = layerKit(diffuseColor.rgb, vPc);
          else if (sl == SL_jersey) { diffuseColor.rgb = torsoKit(diffuseColor.rgb, vPc); if (uCut == 2) diffuseColor.rgb *= 0.9 + 0.1 * step(0.5, fract(atan(vPc.z, vPc.x) * 22.0)); }
          if (uMusette > 0.5 && (sl == SL_layer || sl == SL_jersey)) { float d = vPc.y / uTorsoT - 0.5 - 0.48 * vPc.z / uTorsoW; diffuseColor.rgb = mix(diffuseColor.rgb, uBagC, 1.0 - aa(0.045, abs(d))); }
          if (uPlate > 0.5 && vPc.x < 0.0 && (sl == SL_layer || sl == SL_jersey)) { vec2 q = vec2(0.5 + vPc.z / uTorsoW / 0.9, (vPc.y / uTorsoT - 0.3) / 0.28); if (q.x > -0.05 && q.x < 1.05 && q.y > -0.05 && q.y < 1.05) diffuseColor.rgb = plateKit(diffuseColor.rgb, q, uPlate); }
        }
        else if (sp == 2) diffuseColor.rgb = sleeveKit(diffuseColor.rgb, vPc);
        else if (sp == 6) {
          float hA = (1.0 - vPc.x) * uLegL;
          if (sl == SL_sock) diffuseColor.rgb = sockKit(diffuseColor.rgb, hA / uSockH, vPc.y);
          else if (sl == SL_shorts || sl == SL_shortsAccent) {
            float outer = vPc.z * sin(6.2831853 * vPc.y);
            if (uShorts == 1 && sl == SL_shorts) diffuseColor.rgb = mix(diffuseColor.rgb, uShortsB, aa(0.72, outer));
            if (uShorts == 3 && sl == SL_shorts) diffuseColor.rgb = mix(diffuseColor.rgb, uShortsB, aa(0.965, outer));
            if (uShorts == 4) diffuseColor.rgb *= 0.86 + 0.14 * step(0.5, fract(vPc.y * 44.0));
          }
          else if (sl == SL_warmer) diffuseColor.rgb *= 0.9 + 0.1 * step(0.5, fract(vPc.y * 30.0));
        }
        else if (sp == 7 && sl == SL_barTape) diffuseColor.rgb = tapeKit(diffuseColor.rgb, vPc.xy);
        else if (sp == 8) { float a = texture(uLogo, vPc.xy).a * uLogoOn; diffuseColor.rgb = uDecal; diffuseColor.a = a; if (a < 0.02) discard; }
        else if (sp == 9 && sl == SL_tyre) { float phi = atan(vPc.y, vPc.x); float k = 1.0 - smoothstep(0.004, 0.02, uWheelDelta); float line = 1.0 - aa(0.18, triw(phi * 110.0 + abs(vPc.z) * 260.0)); diffuseColor.rgb *= 1.0 - 0.45 * line * k * step(abs(vPc.z), vAux.y * 0.62); }
        else if (sp == 10) diffuseColor.rgb = plateKit(diffuseColor.rgb, vPc.xy, uPlateF);
        else if (sp == 11) { float phi = atan(vPc.y, vPc.x); float r = length(vPc.xy); float P = 6.2831853 / vAux.y; float ph = mod(phi, P) - 0.5 * P; float d = length(vec2(ph * r, r - 0.058)) - 0.014; float hole = fillSd(d) + fillSd(r - 0.03); diffuseColor.a = 1.0 - clamp(hole, 0.0, 1.0); if (diffuseColor.a < 0.02) discard; }
        else if (sp == 12 && sl == SL_helmet) {
          vec3 r = (vPc - vec3(uHeadK.xy, 0.0)) / uHeadK.z;
          if (uDeco == 1 && abs(r.z) > 0.055) { vec2 q = vec2((r.z > 0.0 ? 1.0 : -1.0) * (r.x + 0.01), r.y - 0.045) * 38.0; float d = min(min(sdBox(q - vec2(-1.4, 0.0), vec2(0.22, 0.9)), sdBox(q - vec2(-0.4, 0.0), vec2(0.22, 0.9))), sdBox(q - vec2(-0.9, 0.0), vec2(0.5, 0.18))); d = min(d, abs(length(q - vec2(1.0, 0.0)) - 0.72) - 0.2); d = max(d, -sdBox(q - vec2(1.75, 0.0), vec2(0.45, 0.4))); diffuseColor.rgb = mix(diffuseColor.rgb, uHelmetB, fillSd(d)); }
          gSheen = 0.5;
        }
        else if (sp == 13) diffuseColor.rgb = capKit(diffuseColor.rgb, vPc);
        else if (sp == 14) {
          int st = int(vAux.y + 0.5);
          if (st == 1) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.05, 0.06), (1.0 - aa(0.008, abs(vPc.z))) * aa(-0.075, vPc.x) * (1.0 - aa(0.07, vPc.x)) * aa(-0.012, vPc.y));
          if (st == 2) { vec2 g = vec2(vPc.x * 60.0, vPc.z * 70.0); vec2 f = abs(fract(g + vec2(0.5 * mod(floor(g.y), 2.0), 0.0)) - 0.5); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35, (1.0 - aa(0.34, max(f.x, f.y))) * aa(-0.012, vPc.y) * (1.0 - aa(0.03, vPc.x))); }
          if (st == 3) diffuseColor.rgb *= 0.88 + 0.24 * hash21(floor(vPc.xz * 900.0));
        }
        else if (sp >= 3 && sp <= 5) {
          float phi = atan(vPc.y, vPc.x); if (phi < 0.0) phi += 6.2831853;
          float r = length(vPc.xy); float h = 0.5 * angFoot(phi);
          if (sp == 3) {
            if (vAux.y > 0.5 && uDecalStyle > 0.5 && r > 0.19 && r < 0.309) {
              float P = 6.2831853 / vAux.y; float arc = vAux.z;
              float cov = sweepCover(phi, blurWin(uWheelDelta + 2.0 * h, P), h, P, arc);
              if (uDecalStyle < 1.5) { float lp = arc / 6.0; cov *= sweepCover(phi, blurWin(uWheelDelta + 2.0 * h, lp), h, lp, lp * 0.6); }
              if (uDecalStyle > 2.5) { cov = max(cov * 0.25, 0.4 * aa(0.6, triw(r * 700.0))); }
              diffuseColor.rgb = mix(diffuseColor.rgb, uDecal, cov);
            }
          } else {
            float k = vAux.y; float wm = vAux.z / 1000.0;
            if (sp == 5) wm *= 1.0 - 0.45 * clamp((r - 0.03) / 0.26, 0.0, 1.0);
            float P = 6.2831853 / k; float w = min(wm / max(r, 0.01), P);
            float cov = sweepCover(phi, blurWin(uWheelDelta + 2.0 * h, P), h, P, w);
            diffuseColor.a = cov;
            if (cov < 0.004) discard;
          }
        }
        if (sl == SL_frame || sl == SL_frameAccent) diffuseColor.rgb = frameKit(diffuseColor.rgb, vPc, sl);
        else if (sl == SL_lens) { diffuseColor.a = uLens.x; gMirror = uLens.y; gSheen = 0.6; if (uLens.x < 0.02) discard; }
        else if (sl == SL_screen) gSheen = 0.9;
        else if (sl == SL_chrome || sl == SL_brass) { gSheen = 1.1; gMirror = 0.45; }
        else if (sl == SL_metal || sl == SL_rim) gSheen = 0.3;
        else if (sl == SL_bottle || sl == SL_helmetAccent || sl == SL_layer) gSheen = max(gSheen, 0.25);
      }`)
      .replace('#include <opaque_fragment>', `{
        vec3 vd = normalize(vViewPosition);
        float fr = pow(1.0 - clamp(dot(vd, normal), 0.0, 1.0), 3.0);
        outgoingLight += fr * (uRimSun * clamp(dot(normal, uSunV) * 0.8 + 0.25, 0.0, 1.0) + uRimSky);
        if (gSheen > 0.0) { vec3 rf = reflect(-vd, normal); float s = max(dot(rf, uSunV), 0.0); outgoingLight += gSheen * (smoothstep(0.9, 0.95, s) * (uRimSun * 1.6 + vec3(0.18)) + fr * uRimSky * 1.5); }
        if (gMirror > 0.0) { vec3 rf = reflect(-vd, normal); float sky = clamp(rf.y * 0.5 + 0.5, 0.0, 1.0); vec3 env = mix(uRimSun * 1.2 + vec3(0.06), uRimSky * 6.0 + vec3(0.1), sky); outgoingLight = mix(outgoingLight, outgoingLight * 0.35 + env, gMirror * 0.75); }
      }
      #include <opaque_fragment>`)
  }
  m.customProgramCacheKey = () => 'wattroom-rider3'
  return m
}
// generated from catalogue.json (the starter loadout's items): makeRider(hue) works without the JSON; qa G18d keeps them equal
export const WARDROBE_SLOTS = ["frame","finish","fork","wheels","hub","tyres","groupset","gsFinish","crank","ring","pedals","saddle","bars","tape","bottles","cages","computer","lights","bell","bags","utility","charm","jersey","cut","layer","shorts","warmers","socks","shoes","overshoes","gloves","helmet","helmetDeco","glasses","lens","cap","plate","armband","hair"]
export const EMBEDDED = {
  frame: {"slot":"frame","kind":"shape","id":"frame.race","name":"Allrounder","brand":"gaemsli","starter":true,"era":"2020s","material":"carbon","spec":"Round tubes, sloping top tube, disc brakes, 2×","blurb":"The road bike everyone starts on.","geometry":{"stack":565,"reach":395,"hta":73.5,"sta":73.5,"headTube":146,"chainstay":410,"bbDrop":72,"forkOffset":44.4,"seatTube":480,"topTube":"sloping"},"tubes":{"shape":"round","dt":0.0205,"tt":0.0165,"st":0.0165,"ht":0.024,"cs":0.0115,"ss":0.0095,"fork":0.0135,"stays":"dropped","dropY":0.055},"cockpit":{"bar":"drop","torsoDeg":38,"shoulderDeg":86,"stemDeg":-6,"spacer":[0.005,0.035],"stem":[0.08,0.13]},"parts":{"brakes":"disc","rings":2,"derailleur":true,"bottleCages":2},"defaults":{"wheels":"wheels.alloy","tyres":"tyre.black","tyreMm":28,"bars":"bars.drop","saddle":"saddle.race","fork":"fork.straight"},"allowed":{"tyreMin":25,"tyreMax":32,"bars":["bars.drop","bars.aero","bars.flare","bars.clipon"],"forks":["fork.straight","fork.aero"],"bags":true,"utility":false}},
  finish: {"slot":"finish","kind":"finish","id":"finish.matte","name":"Matt","starter":true,"spec":"Flat paint, no reflections","finish":"matte"},
  fork: {"slot":"fork","kind":"shape","id":"fork.straight","name":"Straight tapered","brand":"gaemsli","free":true,"spec":"Straight carbon blades, tapered steerer","style":"straight"},
  wheels: {"slot":"wheels","kind":"shape","id":"wheels.alloy","name":"Alloy 24","brand":"rundlauf","starter":true,"spec":"Alloy rims, 24 spokes, 2-cross","finish":"alloy","front":{"type":"spoked","depth":0.03,"spokes":24},"rear":{"type":"spoked","depth":0.03,"spokes":24},"decal":{"style":"logo","count":2,"arcDeg":38}},
  hub: {"slot":"hub","kind":"sound","id":"hub.quiet","name":"Stille","brand":"hemmung","starter":true,"spec":"Low-flange hub, a soft pawl whisper while you coast","style":"low","voice":"whisper"},
  tyres: {"slot":"tyres","kind":"shape","id":"tyre.black","name":"Black slick","brand":"rundlauf","starter":true,"spec":"Width 23–50 mm is yours to pick, within the frame","wall":"black","tread":"slick","casing":"clincher"},
  groupset: {"slot":"groupset","kind":"shape","id":"gs.mech","name":"Mechanical","brand":"hemmung","starter":true,"spec":"Cable loops at the bar, 2×12","style":"mech"},
  gsFinish: {"slot":"gsFinish","kind":"finish","id":"gsf.black","name":"Black","brand":"hemmung","starter":true,"finish":"#2a2932"},
  crank: {"slot":"crank","kind":"shape","id":"crank.four","name":"Four-arm","brand":"hemmung","starter":true,"spec":"Forged four-arm spider; length 165–175 mm is yours to pick","style":"four"},
  ring: {"slot":"ring","kind":"shape","id":"ring.round","name":"Round","brand":"hemmung","starter":true,"style":"round"},
  pedals: {"slot":"pedals","kind":"shape","id":"pedal.road","name":"3-bolt road","brand":"hemmung","starter":true,"spec":"Wide platform, 3-bolt cleat","style":"road"},
  saddle: {"slot":"saddle","kind":"shape","id":"saddle.race","name":"Race","brand":"gaemsli","starter":true,"style":"race"},
  bars: {"slot":"bars","kind":"shape","id":"bars.drop","name":"Round drop","brand":"gaemsli","starter":true,"spec":"Width 360–460 mm is yours to pick; under 400 is not race-legal in mass starts","style":"drop"},
  tape: {"slot":"tape","kind":"pattern","id":"tape.plain","name":"Plain wrap","brand":"korkleder","starter":true,"style":"plain"},
  bottles: {"slot":"bottles","kind":"shape","id":"bottle.plastic","name":"Squeeze bottle","brand":"tueftelwerk","starter":true,"spec":"0–2 bottles and their size are yours to pick","style":"plastic"},
  cages: {"slot":"cages","kind":"shape","id":"cage.alloy","name":"Alloy wire","brand":"tueftelwerk","starter":true,"style":"alloy"},
  computer: {"slot":"computer","kind":"shape","id":"comp.none","name":"No computer","starter":true,"style":"none"},
  lights: {"slot":"lights","kind":"shape","id":"light.none","name":"No lights","starter":true,"style":"none"},
  bell: {"slot":"bell","kind":"shape","id":"bell.none","name":"No bell","starter":true,"style":"none"},
  bags: {"slot":"bags","kind":"shape","id":"bag.none","name":"No bag","starter":true,"style":"none"},
  utility: {"slot":"utility","kind":"shape","id":"util.none","name":"Nothing fitted","starter":true,"style":"none"},
  charm: {"slot":"charm","kind":"charm","id":"charm.none","name":"No charm","starter":true,"style":"none"},
  jersey: {"slot":"jersey","kind":"pattern","id":"jp.plain","name":"Plain","brand":"zwirn","starter":true,"pattern":"plain"},
  cut: {"slot":"cut","kind":"shape","id":"cut.race","name":"Race cut","brand":"zwirn","starter":true,"spec":"Sleeves and collar are yours to pick","style":"race"},
  layer: {"slot":"layer","kind":"shape","id":"layer.none","name":"No layer","starter":true,"style":"none"},
  shorts: {"slot":"shorts","kind":"shape","id":"bib.plain","name":"Bib shorts","brand":"zwirn","starter":true,"spec":"Shorts, 3/4 knickers or tights: length is yours to pick","style":"plain"},
  warmers: {"slot":"warmers","kind":"shape","id":"warm.none","name":"No warmers","starter":true,"style":"none"},
  socks: {"slot":"socks","kind":"pattern","id":"sock.plain","name":"Plain","brand":"lismer","starter":true,"spec":"Low, mid or tall is yours to pick; tall stops at the race-legal line","pattern":"plain"},
  shoes: {"slot":"shoes","kind":"shape","id":"shoe.dial","name":"Dial closure","brand":"zwirn","starter":true,"style":"dial"},
  overshoes: {"slot":"overshoes","kind":"shape","id":"over.none","name":"No overshoes","starter":true,"style":"none"},
  gloves: {"slot":"gloves","kind":"shape","id":"glove.mitt","name":"Mitts","brand":"zwirn","starter":true,"fingers":"short"},
  helmet: {"slot":"helmet","kind":"shape","id":"helmet.road","name":"Vented road","brand":"chopf","starter":true,"style":"road"},
  helmetDeco: {"slot":"helmetDeco","kind":"decal","id":"deco.none","name":"No decoration","starter":true,"style":"none"},
  glasses: {"slot":"glasses","kind":"shape","id":"glasses.wrap","name":"Wrap","brand":"nebelmeer","starter":true,"style":"wrap"},
  lens: {"slot":"lens","kind":"finish","id":"lens.cat","name":"Lens categories 0–3","brand":"nebelmeer","starter":true,"spec":"Clear, rose, smoke or dark","style":"tint","options":[{"id":"clear","name":"Cat 0 clear","hex":"#dfe6ee","alpha":0.3},{"id":"rose","name":"Cat 1 rose","hex":"#c9937a","alpha":0.6},{"id":"smoke","name":"Cat 2 smoke","hex":"#5a5e66","alpha":0.85},{"id":"dark","name":"Cat 3 dark","hex":"#2a2f45","alpha":1}]},
  cap: {"slot":"cap","kind":"shape","id":"cap.none","name":"No cap","starter":true,"style":"none"},
  plate: {"slot":"plate","kind":"decal","id":"plate.none","name":"No number","starter":true,"style":"none"},
  armband: {"slot":"armband","kind":"charm","id":"armband.none","name":"No armband","starter":true,"style":"none"},
  hair: {"slot":"hair","kind":"shape","id":"hair.short","name":"Short","starter":true,"style":"short"}
}
export const EMBEDDED_EXTRA = [
  {"slot":"jersey","kind":"pattern","id":"jp.hoops","name":"Hoops","brand":"zwirn","tier":"M","pattern":"hoops"},
  {"slot":"jersey","kind":"pattern","id":"jp.sash","name":"Sash","brand":"zwirn","tier":"M","pattern":"sash"},
  {"slot":"jersey","kind":"pattern","id":"jp.stripes","name":"Stripes","brand":"zwirn","tier":"M","pattern":"stripes"},
  {"slot":"jersey","kind":"pattern","id":"jp.yoke","name":"Shoulder yoke","brand":"zwirn","tier":"S","pattern":"yoke"},
  {"slot":"jersey","kind":"pattern","id":"jp.sidepanel","name":"Side panels","brand":"zwirn","tier":"S","pattern":"sidepanel"}
]
export const EMBEDDED_STARTER = {"frame":"frame.race","finish":"finish.matte","fork":"fork.straight","wheels":"wheels.alloy","hub":"hub.quiet","tyres":"tyre.black","groupset":"gs.mech","gsFinish":"gsf.black","crank":"crank.four","ring":"ring.round","pedals":"pedal.road","saddle":"saddle.race","bars":"bars.drop","tape":"tape.plain","bottles":"bottle.plastic","cages":"cage.alloy","computer":"comp.none","lights":"light.none","bell":"bell.none","bags":"bag.none","utility":"util.none","charm":"charm.none","jersey":"jp.plain","cut":"cut.race","layer":"layer.none","shorts":"bib.plain","warmers":"warm.none","socks":"sock.plain","shoes":"shoe.dial","overshoes":"over.none","gloves":"glove.mitt","helmet":"helmet.road","helmetDeco":"deco.none","glasses":"glasses.wrap","lens":"lens.cat","cap":"cap.none","plate":"plate.none","armband":"armband.none","hair":"hair.short","opts":{"lens":"dark"},"params":{"bottles":1,"sockH":"mid","shortsLen":"short","sleeves":"short","collar":"std","brim":"down"},"colours":{"frame":"slate","frameAccent":"snow","jerseyA":"alpine","jerseyB":"ink","jerseyC":"snow","shorts":"ink","shortsAccent":"alpine","helmet":"snow","helmetAccent":"ink","socks":"snow","sockAccent":"alpine","shoes":"snow","gloves":"ink","barTape":"ink","bottle":"snow","saddle":"ink","hair":"leather","decal":"snow","layer":"graphite","layerAccent":"sun","warmer":"ink","cap":"snow","capAccent":"enzian","bag":"graphite","overshoe":"ink","tyreWall":"sun","anodised":"alpine","armband":"sun"},"skin":"skin.3","body":{"height":1.8,"build":"athletic"}}
const FIXED = { tyre: '#1b1a20', rubber: '#22212a', chain: '#4a4852', carbon: '#2a2932', alloy: '#8d8e98', steel: '#1e1d24', silver: '#c9cad2', lens: '#2a2f45' }
const WALLS = { tan: '#b58756', cream: '#efe3c6', honey: '#c8955a' }
export const SOCK_HEIGHTS = { low: 0.05, mid: 0.11, tall: 0.17 } // m above the ankle; tall stops under the race-legal line (half-way to the knee)

// Resolve a loadout against a catalogue: every slot gets an item, incompatible picks fall back (with a note saying why),
// options and free parameters are clamped, and the conflict rules are applied. The result is what the builder draws.
export function resolveLoadout(lo = {}, cat = null) {
  const items = cat?.items ?? [...Object.values(EMBEDDED), ...EMBEDDED_EXTRA]
  const byId = new Map(items.map((i) => [i.id, i]))
  const starter = cat?.starterLoadout ?? EMBEDDED_STARTER
  const notes = []
  const pick = (slot, ...ids) => { for (const id of ids) { const it = byId.get(id); if (it && it.slot === slot) return it } return EMBEDDED[slot] }
  const frame = pick('frame', lo.frame, starter.frame, 'frame.race')
  const def = frame.defaults ?? {}, al = frame.allowed ?? {}, parts = frame.parts ?? {}
  const out = { frame }
  for (const slot of WARDROBE_SLOTS) if (slot !== 'frame') out[slot] = pick(slot, lo[slot], def[slot], starter[slot])
  const fall = (slot, why) => { notes.push({ slot, item: out[slot].id, why }); out[slot] = pick(slot, def[slot], starter[slot]) }
  // items that come with a frame stay on it
  for (const slot of WARDROBE_SLOTS) { const u = out[slot].unlock; if (u?.startsWith('with:') && !u.slice(5).split('|').includes(frame.id)) fall(slot, `comes with the ${u.slice(5).split('|').map((f) => byId.get(f)?.name ?? f).join(' / ')}`) }
  if (frame.cockpit.bar === 'tt' || frame.cockpit.bar === 'upright') out.bars = pick('bars', def.bars)
  else if (al.bars && !al.bars.includes(out.bars.id)) fall('bars', `the ${frame.name} takes ${al.bars.map((b) => byId.get(b)?.name ?? b).join(', ')}`)
  if (al.forks && !al.forks.includes(out.fork.id)) fall('fork', `the ${frame.name} takes ${al.forks.map((b) => byId.get(b)?.name ?? b).join(', ')}`)
  const fits = (it) => { const r = it.requires; if (!r) return true; if (r.material && !r.material.includes(frame.material)) return false; if (r.brakes && !r.brakes.includes(parts.brakes)) return false; if (r.derailleur && !parts.derailleur) return false; if (r.bags && !al.bags) return false; if (r.utility && !al.utility) return false; return true }
  for (const slot of WARDROBE_SLOTS) if (!fits(out[slot])) { const was = out[slot]; fall(slot, `does not fit the ${frame.name}`); if (!fits(out[slot])) out[slot] = EMBEDDED[slot] ?? was }
  // collections: the chosen option, or the first
  out.opt = {}
  for (const slot of WARDROBE_SLOTS) { const it = out[slot]; if (it.options?.length) out.opt[slot] = (it.options.find((o) => o.id === lo.opts?.[slot]) ?? it.options[0]).id }
  // free parameters (never priced), clamped to the frame and the item
  const P = { ...(starter.params ?? {}), ...(lo.params ?? {}) }
  const num = (x, d) => (Number.isFinite(+x) && x !== null && x !== '' ? +x : d)
  const tyreMm = clamp(num(P.tyreMm, def.tyreMm ?? 28), al.tyreMin ?? 23, al.tyreMax ?? 50)
  const w = out.wheels, range = w.depthRange
  const rimMm = range ? clamp(num(P.rimMm, (w.front.type === 'spoked' ? w.front.depth : w.rear.depth) * 1000), range[0] * 1000, range[1] * 1000) : null
  const spec = (s) => (range && s.type === 'spoked' ? { ...s, depth: rimMm / 1000 } : s)
  out.wheelSpec = { front: spec(w.front), rear: spec(w.rear) }
  let bottles = clamp(Math.round(num(P.bottles, 1)), 0, 2)
  const bag = out.bags.style
  const cages = out.bottles.style === 'rear' ? 2 : Math.min(parts.bottleCages ?? 0, bag === 'full' ? 0 : bag === 'half' ? 1 : 2)
  if (bottles > cages && !MUT.has('bagBottle')) { notes.push({ slot: 'bottles', item: out.bottles.id, why: bag === 'full' ? 'a full frame bag leaves no room for bottles' : bag === 'half' ? 'a half frame bag leaves room for one bottle' : `the ${frame.name} has ${cages} cage mount${cages === 1 ? '' : 's'}` }); bottles = cages }
  const shortsLen = ['short', 'knicker', 'tights'].includes(P.shortsLen) ? P.shortsLen : 'short'
  const layer = out.layer.style
  const sleeves = layer === 'rain' || layer === 'winter' ? 'long' : ['none', 'short', 'long'].includes(P.sleeves) ? P.sleeves : 'short'
  out.p = {
    tyreMm, rimMm, crankMm: P.crankMm ? clamp(num(P.crankMm, 172.5), 165, 175) : null, bottles,
    sockH: SOCK_HEIGHTS[P.sockH] ?? SOCK_HEIGHTS.mid, sockName: SOCK_HEIGHTS[P.sockH] ? P.sockH : 'mid', shortsLen, sleeves, collar: ['low', 'std', 'high'].includes(P.collar) ? P.collar : 'std',
    brim: P.brim === 'up' ? 'up' : 'down', logos: P.logos !== false, number: clamp(Math.round(num(P.number, 0)), 0, 999)
  }
  // derived looks and the conflict rules
  out.layerStyle = layer
  out.sleeveLen = sleeves
  const wo = out.warmers.style === 'collection' ? out.opt.warmers : null
  out.armWarm = (wo === 'arm' || wo === 'armleg') && sleeves !== 'long'
  out.legWarm = wo === 'leg' || wo === 'armleg' ? (shortsLen === 'tights' ? null : 'leg') : wo === 'knee' ? (shortsLen === 'short' ? 'knee' : null) : null
  if (wo && ((wo === 'arm' && !out.armWarm) || (wo === 'knee' && !out.legWarm) || (wo === 'leg' && !out.legWarm))) notes.push({ slot: 'warmers', item: out.warmers.id, why: wo === 'arm' ? 'long sleeves already cover the arm' : 'knickers and tights already cover the knee' })
  out.nightBands = out.warmers.style === 'bands'
  out.overshoe = out.overshoes.style === 'collection' ? out.opt.overshoes : null
  out.hidden = { glasses: out.helmet.style === 'tt' && out.glasses.style !== 'none' }
  if (out.hidden.glasses) notes.push({ slot: 'glasses', item: out.glasses.id, why: 'the visor replaces your glasses while you wear the teardrop helmet' })
  // colours: free on anything owned; the guard keeps them out of the watt band (qa G18b)
  const pal = new Map((cat?.palette ?? []).map((p) => [p.id, p.hex]))
  const col = (c, d) => (typeof c === 'string' && c.startsWith('#') ? c : pal.get(c) ?? d)
  const sc = { ...(starter.colours ?? {}), ...(lo.colours ?? {}) }
  const skins = new Map((cat?.skinTones ?? []).map((s) => [s.id, s.hex]))
  const C = {
    frame: col(sc.frame, '#5b6072'), frameAccent: col(sc.frameAccent, '#f2eff6'), jerseyA: col(sc.jerseyA, '#3f78d9'), jerseyB: col(sc.jerseyB, '#24222c'), jerseyC: col(sc.jerseyC, '#f2eff6'),
    shorts: col(sc.shorts, '#24222c'), shortsAccent: col(sc.shortsAccent, '#3f78d9'), helmet: col(sc.helmet, '#f2eff6'), helmetAccent: col(sc.helmetAccent, '#24222c'), socks: col(sc.socks, '#f2eff6'), sockAccent: col(sc.sockAccent, '#3f78d9'),
    shoes: col(sc.shoes, '#f2eff6'), gloves: col(sc.gloves, '#24222c'), barTape: col(sc.barTape, '#24222c'), bottle: col(sc.bottle, '#f2eff6'), saddle: col(sc.saddle, '#24222c'), hair: col(sc.hair, '#7a4a2c'), decal: col(sc.decal, '#f2eff6'),
    layer: col(sc.layer, '#33313c'), layerAccent: col(sc.layerAccent, '#f2c230'), warmer: col(sc.warmer, '#24222c'), cap: col(sc.cap, '#f2eff6'), capAccent: col(sc.capAccent, '#2b44b8'), bag: col(sc.bag, '#33313c'), bagAccent: col(sc.bagAccent, '#24222c'),
    overshoe: col(sc.overshoe, '#24222c'), tyreWall: col(sc.tyreWall, '#f2c230'), anodised: col(sc.anodised, '#3f78d9'), armband: col(sc.armband, '#f2c230'),
    skin: col(lo.skin, skins.get(lo.skin) ?? '#cf9d77'), lens: FIXED.lens, lensAlpha: 1, lensMirror: 0
  }
  if (out.cap.colour) C.cap = out.cap.colour
  if (out.bags.style === 'rando') C.bagAccent = col(sc.bagAccent, '#7a4a2c')
  // Gipfelpunkte never puts dots on a white ground: a light main colour swaps with the dots
  if (out.jersey.pattern === 'gipfelpunkte' && hexToOklch(C.jerseyA).L > 0.85) { notes.push({ slot: 'jersey', item: out.jersey.id, why: 'dots never sit on a white ground; the colours swap' }); [C.jerseyA, C.jerseyB] = [C.jerseyB, C.jerseyA] }
  const lensOpt = out.lens.options?.find((o) => o.id === out.opt.lens)
  if (lensOpt) { C.lens = lensOpt.hex; C.lensAlpha = lensOpt.alpha ?? 1; C.lensMirror = out.lens.style === 'mirror' ? 1 : 0 }
  if (out.bottles.tint) { C.bottle = out.bottles.tint.bottle; C.bottleCap = out.bottles.tint.cap }
  if (out.bottles.style === 'striped') C.bottleCap = C.jerseyB
  out.colours = C
  out.body = { height: fin(lo.body?.height, starter.body?.height ?? 1.8), build: lo.body?.build ?? starter.body?.build ?? 'athletic' }
  out.name = lo.name
  out.notes = MUT.has('silentSwap') ? [] : notes
  return out
}

// A whole identity from one hue (the prototype's hueOf(id)): kit, helmet, frame, pattern — never the watt hue.
export function loadoutFromHue(hue) {
  const h = safeHue(hue)
  const pats = ['jp.plain', 'jp.hoops', 'jp.sash', 'jp.yoke', 'jp.sidepanel', 'jp.stripes']
  const pat = pats[Math.abs(Math.round(hue * 7.31)) % pats.length]
  const c = (L, C, dh = 0) => oklchToHex(L, C, safeHue(h + dh))
  return {
    jersey: pat,
    colours: { jerseyA: c(0.66, 0.13), jerseyB: c(0.3, 0.06), jerseyC: '#f2eff6', shorts: c(0.25, 0.035), shortsAccent: c(0.66, 0.13), helmet: c(0.72, 0.12, 150), helmetAccent: c(0.3, 0.04, 150), frame: c(0.38, 0.06, 40), frameAccent: c(0.8, 0.05, 40), socks: '#f2eff6', sockAccent: c(0.66, 0.13), shoes: '#ece9f2', gloves: c(0.25, 0.03), barTape: '#24222c', bottle: c(0.72, 0.1, 150), saddle: '#24222c', decal: '#f2eff6', hair: '#5f3e2b' },
    skin: '#cf9d77'
  }
}

// Slot colours for a resolved loadout (THREE.Color, linear).
export function paletteOf(lo) {
  const c = lo.colours, Cc = (x) => new THREE.Color(x)
  const finish = lo.wheels.finish === 'carbon' ? FIXED.carbon : lo.wheels.finish === 'silver' ? FIXED.silver : lo.wheels.finish === 'steel' ? FIXED.steel : FIXED.alloy
  const gsf = lo.gsFinish.finish === 'anodised' ? '#2a2932' : lo.gsFinish.finish
  const skinsuit = lo.cut.style === 'skinsuit'
  const shortsAccent = skinsuit ? c.jerseyB : lo.shorts.style === 'plain' ? c.shorts : c.shortsAccent
  const wall = lo.tyres.wall === 'colour' ? c.tyreWall : WALLS[lo.tyres.wall] ?? FIXED.tyre
  return {
    jersey: Cc(c.jerseyA), jerseyAccent: Cc(c.jerseyB), helmet: Cc(c.helmet), skin: Cc(c.skin), shorts: Cc(skinsuit ? c.jerseyA : c.shorts), shoe: Cc(c.shoes), frame: Cc(c.frame), tyre: Cc(FIXED.tyre), rim: Cc(finish), metal: Cc(gsf === '#2a2932' ? '#5a5864' : '#b4b5be'), glasses: Cc('#1d1c24'),
    frameAccent: Cc(c.frameAccent), sock: Cc(c.socks), glove: Cc(c.gloves), helmetAccent: Cc(c.helmetAccent), lens: Cc(c.lens), saddle: Cc(c.saddle), barTape: Cc(c.barTape), groupset: Cc(gsf), bottle: Cc(c.bottle), sole: Cc('#1f1e26'),
    spokes: Cc(lo.wheels.finish === 'silver' ? '#c9cad2' : lo.wheels.finish === 'carbon' && lo.wheels.front.type === 'blades' ? FIXED.carbon : '#2e2d36'), hair: Cc(c.hair), shortsAccent: Cc(shortsAccent), tyreWall: Cc(wall), bottleCap: Cc(c.bottleCap ?? '#24222c'), hood: Cc(FIXED.rubber), chain: Cc(FIXED.chain), sockAccent: Cc(c.sockAccent), leather: Cc('#7a4a2c'),
    pedal: Cc(lo.pedals.style === 'clips' ? '#b9bac3' : lo.pedals.style === 'flat' ? gsf : '#26252d'), warmer: Cc(c.warmer), layer: Cc(c.layer), layerAccent: Cc(c.layerAccent), cap: Cc(c.cap), capAccent: Cc(c.capAccent), screen: Cc('#1b1d24'), bag: Cc(c.bag), bagAccent: Cc(c.bagAccent),
    logo: Cc(c.decal), overshoe: Cc(c.overshoe), plate: Cc('#efece6'), armband: Cc(c.armband), charm: Cc(lo.charm.style === 'lampion' ? '#e0935c' : '#9e3b2f'), lightF: Cc('#e9e6dc'), lightR: Cc('#9e3530'), brass: Cc('#b8913e'), flower: Cc('#f2c230'), foliage: Cc('#2d6a4f'), cork: Cc('#c9a87a'), chrome: Cc('#c8cad2'), anodised: Cc(c.anodised)
  }
}

// compat: model.js's paletteFor(hue) — the old slot names, now from the hue loadout
export function paletteFor(hue) { return paletteOf(resolveLoadout(loadoutFromHue(hue))) }

export function paint(geo, pal) {
  const cur = Object.assign(geo.userData.palette ?? {}, pal)
  geo.userData.palette = cur
  const slot = geo.attributes.slot.array
  const col = new Float32Array(slot.length * 3)
  const list = SLOTS.map((s) => cur[s] ?? new THREE.Color('#ff00ff'))
  for (let i = 0; i < slot.length; i++) { const c = list[slot[i]]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return geo
}

// ---------------------------------------------------------------- build
function restMatrices(d) {
  const rest = BONES.map(() => new THREE.Matrix4())
  for (const n of ['shinL', 'shinR']) rest[B[n]] = TR(0, -d.thigh, 0).multiply(M4().makeRotationZ(-REST_FLEX.knee))
  for (const n of ['foreL', 'foreR']) rest[B[n]] = TR(0, -d.upperArm, 0).multiply(M4().makeRotationZ(-REST_FLEX.elbow))
  return rest
}

export function rigFor(lo) {
  const d = riderDims(lo.body)
  const bk = bikeGeometry(lo.frame, { widthMm: lo.p?.tyreMm ?? lo.tyres.widthMm ?? 28, casing: lo.tyres.casing }, d.k)
  const style = lo.frame.cockpit.bar === 'tt' || lo.frame.cockpit.bar === 'upright' ? lo.frame.cockpit.bar : lo.bars.style
  const fit = fitRider(d, bk, lo.frame, style, lo.p?.crankMm)
  const rig = { dims: d, bk, fit, style, isTT: style === 'tt', isUpright: style === 'upright', wheelR: bk.R }
  rig.grips = fit.grips
  rig.leanMax = leanLimits(rig, lo.pedals?.style)
  if (MUT.has('leanWide')) rig.leanMax.pedal = 40 * DEG
  return rig
}

// How far the bike can lean before a pedal or shoe touches the road (pedalling: inside crank at BDC; coasting: level cranks).
const PEDAL_HALF = { road: [0.042, 0.026], node: [0.029, 0.023], twobolt: [0.04, 0.03], flat: [0.05, 0.044], clips: [0.045, 0.036] } // outer half-extents (x, z) about the spindle
function leanLimits(rig, pedal = 'road') {
  const { dims: d, bk, fit } = rig
  const [hx, hz] = PEDAL_HALF[pedal] ?? PEDAL_HALF.road
  const pts = [V(0.2 * d.k, -0.07 * d.k, 0.03), V(0.2 * d.k, -0.07 * d.k, -0.03), V(0.15 * d.k, -0.078 * d.k, 0.046), V(-0.06 * d.k, -0.078 * d.k, 0.04), V(d.cleat.x + hx + 0.004, d.cleat.y - 0.01, hz + 0.008), V(d.cleat.x - hx - 0.004, d.cleat.y - 0.01, hz + 0.008)]
  const lowest = (a, lean) => {
    let lo = Infinity
    const th = a + Math.PI / 2, q = qAxis(Z_, -toeDown(th)), sp = V(bk.bb.x + fit.crank * Math.cos(a), bk.bb.y - fit.crank * Math.sin(a), fit.pedalZ)
    const ankle = sp.clone().sub(d.cleat.clone().applyQuaternion(q))
    for (const p of pts) {
      const w = p.clone().applyQuaternion(q).add(ankle)
      w.z = Math.abs(w.z) + 0.01
      lo = Math.min(lo, (w.y - bk.rt) * Math.cos(lean) - w.z * Math.sin(lean) + bk.rt)
    }
    return lo
  }
  const maxLean = (a) => { let lo = 0, hi = 45 * DEG; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (lowest(a, m) > 0.02) lo = m; else hi = m } return lo }
  return { pedal: Math.min(maxLean(Math.PI / 2), 28 * DEG), coast: Math.min(maxLean(0), maxLean(Math.PI), 32 * DEG) }
}

export const TRI_BUDGET = [14000, 7500] // per rider + bike, LOD0 / LOD1 (qa G19a/b)
const DETAIL_STEPS = [1, 0.9, 0.8, 0.72, 0.64]
// the race number: from the start list in the product; here a stable number from the rider's name
const numberOf = (lo) => lo.p.number || 1 + ([...String(lo.name ?? 'rider')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 198)

export function buildRider(loadout, catalogue = null, opts = {}) {
  const lo = loadout.frame?.geometry && loadout.p ? loadout : resolveLoadout(loadout, catalogue)
  const rig = rigFor(lo)
  const lod = opts.lod ?? 0
  // detail governor: a loadout over the per-rider triangle budget (ADR-0066) is re-tessellated coarser, never
  // stripped — every item the rider owns still renders. Typical loadouts build once at detail 1.
  const budget = opts.budget ?? TRI_BUDGET[lod ? 1 : 0]
  let mb
  for (const detail of MUT.has('noGovernor') ? [1] : DETAIL_STEPS) {
    mb = new MB(restMatrices(rig.dims), lod)
    mb.detail = detail
    mb.bikeOnly = !!opts.bikeOnly
    if (!mb.bikeOnly) {
      buildLegs(mb, rig.dims, lo)
      buildArms(mb, rig.dims, lo)
      buildTorso(mb, rig.dims, lo)
      buildPelvis(mb, rig.dims)
      buildHead(mb, rig.dims, lo)
      buildHands(mb, rig.dims, lo)
      buildFeet(mb, rig.dims, lo)
    }
    buildBike(mb, rig, lo)
    buildWheel(mb, rig, lo, 'front')
    buildWheel(mb, rig, lo, 'rear')
    if (mb.I.length / 3 <= budget) break
  }
  const geo = mb.build()
  paint(geo, paletteOf(lo))
  const mat = riderMaterial() // one per rider (its kit uniforms); every rider shares the compiled program
  const u = mat.userData.u, c = lo.colours
  u.uPattern.value = Math.max(0, PATTERNS.indexOf(lo.jersey.pattern))
  u.uKitB.value.set(c.jerseyB); u.uKitC.value.set(c.jerseyC); u.uDecal.value.set(c.decal)
  u.uTorsoT.value = rig.dims.torso; u.uTorsoW.value = 0.17 * rig.dims.k * (mb.meta.torso?.loose ?? 1)
  u.uDecalStyle.value = DECALS[lo.wheels.decal?.style ?? 'none'] ?? 0
  u.uSock.value = MUT.has('invisible') && lo.socks.pattern === 'karo' ? 0 : Math.max(0, SOCK_PATTERNS.indexOf(lo.socks.pattern)); u.uSockH.value = lo.p.sockH * rig.dims.k; u.uLegL.value = rig.dims.thigh + rig.dims.shin; u.uSockB.value.set(c.sockAccent)
  u.uShorts.value = lo.shorts.style === 'wool' ? 4 : lo.shorts.style === 'panels' ? Math.max(1, SHORTS_PATTERNS.indexOf(lo.opt.shorts)) : 0; u.uShortsB.value.set(c.shortsAccent)
  u.uLayer.value = Math.max(0, LAYERS.indexOf(lo.layerStyle)); u.uLayerB.value.set(c.layerAccent)
  const no = numberOf(lo)
  u.uPlate.value = lo.plate.style === 'back' ? no : 0; u.uPlateF.value = lo.plate.style === 'frame' ? no : 0
  u.uTape.value = lo.tape.style === 'collection' ? Math.max(1, TAPES.indexOf(lo.opt.tape)) : 0; u.uTapeB.value.set(c.frameAccent)
  u.uFinish.value = Math.max(0, FINISHES.indexOf(lo.finish.finish)); u.uFinishOpt.value = Math.max(0, (lo.finish.options ?? []).findIndex((o) => o.id === lo.opt.finish)); u.uFrameB.value.set(c.frameAccent)
  u.uLens.value.set(c.lensAlpha, c.lensMirror, 0)
  u.uCap.value = Math.max(0, CAP_PATTERNS.indexOf(lo.cap.pattern ?? 'plain')); u.uCapB.value.set(c.capAccent)
  u.uDeco.value = lo.helmetDeco.style === 'hc' ? 1 : 0; u.uHelmetB.value.set(c.helmetAccent)
  if (mb.meta.head) u.uHeadK.value.set(mb.meta.head.K.x, mb.meta.head.K.y, mb.meta.head.k, 0)
  u.uCut.value = Math.max(0, CUTS.indexOf(lo.cut.style)); u.uMusette.value = lo.bags.style === 'musette' ? 1 : 0; u.uBagC.value.set(c.bag)
  if (opts.logo) { u.uLogo.value = opts.logo; u.uLogoOn.value = 1 }
  const mesh = new THREE.SkinnedMesh(geo, mat)
  const bones = BONES.map((n) => Object.assign(new THREE.Bone(), { name: n, matrixAutoUpdate: false }))
  bones.forEach((b) => mesh.add(b)) // flat rig: every bone's matrix is written by pose()
  const rest = mb.rest
  mesh.bind(new THREE.Skeleton(bones, rest.map((m) => m.clone().invert())), new THREE.Matrix4())
  mesh.frustumCulled = false
  mesh.userData.bones = Object.fromEntries(BONES.map((n, i) => [n, bones[i]]))
  mesh.userData.boneList = bones
  mesh.userData.rig = rig
  mesh.userData.loadout = lo
  mesh.userData.rest = rest
  mesh.userData.meta = mb.meta
  mesh.userData.accessories = mb.acc
  mesh.userData.detail = mb.detail
  pose(mesh, {})
  return mesh
}
// compat entry points (model.js)
export function makeRider(arg = 200, lod = 0, material, catalogue = null) {
  const lo = typeof arg === 'number' ? loadoutFromHue(arg) : arg
  const mesh = buildRider(resolveLoadout(lo, catalogue), catalogue, { lod })
  if (material?.userData?.rim) { lightRig.uRimSky.value.copy(material.userData.rim.color).multiplyScalar(material.userData.rim.strength * 0.4) }
  return mesh
}
export function buildGeometry(lod = 0) { return makeRider(200, lod).geometry }
const _defRig = rigFor(resolveLoadout({}))
// compat: the old GEO block, now read from the default fit
export const GEO = { bb: [0, _defRig.bk.bb.y], crank: _defRig.fit.crank, thigh: _defRig.dims.thigh, shin: _defRig.dims.shin, hip: [_defRig.fit.hipSeat.x, _defRig.fit.hipSeat.y], wheelR: _defRig.bk.R, rear: [_defRig.bk.rear.x, _defRig.bk.rear.y], front: [_defRig.bk.front.x, _defRig.bk.front.y], hoods: [_defRig.grips.hoods.R.p.x, _defRig.grips.hoods.R.p.y, _defRig.grips.hoods.R.p.z], upperArm: _defRig.dims.upperArm, foreArm: _defRig.dims.foreArm }

// ---------------------------------------------------------------- pose (pure: same state in, same matrices out)
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), ONE = V(1, 1, 1)
const _tmp = { a: V(), b: V(), c: V(), d: V(), e: V() }
function twoBone(root, target, l1, l2, pole, outKnee, outBend) {
  const d = Math.min(root.distanceTo(target), l1 + l2 - 1e-4)
  const dir = _tmp.a.subVectors(target, root)
  if (dir.lengthSq() < 1e-12) dir.set(0, -1, 0)
  dir.normalize()
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), a = Math.acos(cosA)
  const bend = outBend.copy(pole).addScaledVector(dir, -pole.dot(dir))
  if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0).addScaledVector(dir, -dir.x)
  bend.normalize()
  return outKnee.copy(root).addScaledVector(dir, cosA * l1).addScaledVector(bend, Math.sin(a) * l1)
}
// Bone frames for a two-bone chain: both share the hinge axis (local Z), -Y runs down the bone, +X is the convex side.
function chainQuats(root, mid, end, bend, q1, q2) {
  const dir = _tmp.b.subVectors(end, root).normalize()
  const h = _tmp.c.crossVectors(dir, bend).normalize()
  const y = _tmp.d.subVectors(root, mid).normalize(), x = _tmp.e.crossVectors(y, h)
  q1.setFromRotationMatrix(_m.makeBasis(x, y, h))
  y.subVectors(mid, end).normalize(); x.crossVectors(y, h)
  q2.setFromRotationMatrix(_m.makeBasis(x, y, h))
}
const S_ = {
  root: new THREE.Matrix4(), bikeM: new THREE.Matrix4(), forkM: new THREE.Matrix4(), crankM: new THREE.Matrix4(), bikeQ: new THREE.Quaternion(), forkQ: new THREE.Quaternion(),
  hip: V(), sh: V(), wR: V(), wL: V(), gR: V(), gL: V(), qR: new THREE.Quaternion(), qL: new THREE.Quaternion(), knee: V(), bend: V(), ankle: V(), sp: V(), hj: V(), pole: V(), elbow: V(),
  qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), qf: new THREE.Quaternion(), tx: V(), ty: V(), tz: V(), tq: new THREE.Quaternion(), pq: new THREE.Quaternion(), s1: V(), s2: V()
}
function setBone(bones, i, pos, q) { const b = bones[i]; b.matrix.multiplyMatrices(S_.root, _m2.compose(pos, q, ONE)); b.matrixWorldNeedsUpdate = true }
function setBoneM(bones, i, M) { const b = bones[i]; b.matrix.multiplyMatrices(S_.root, M); b.matrixWorldNeedsUpdate = true }

export function pose(mesh, st = {}) {
  if (MUT.has('slowPose')) { const t0 = performance.now(); while (performance.now() - t0 < 0.1); }
  const rig = mesh.userData.rig, bones = mesh.userData.boneList
  const d = rig.dims, bk = rig.bk, fit = rig.fit, k = d.k
  const crank = fin(st.crank, 0), wheel = fin(st.wheel, 0)
  const s = clamp(fin(st.stand, 0), 0, 1)
  const compat = st.swayAmp === undefined && st.rock !== undefined
  const swayAmp = clamp(compat ? s * 0.12 : fin(st.swayAmp, 0), 0, 0.2)
  const rockAmp = clamp(fin(st.rockAmp, compat ? fin(st.rockBody, 0.02) : 0.02), 0, 0.1)
  const thR = crank + Math.PI / 2
  const sway = -swayAmp * Math.sin(thR - 50 * DEG)
  const lean = clamp(fin(st.lean, 0), -0.7, 0.7), pitch = clamp(fin(st.pitch, 0), -0.4, 0.4), steer = clamp(fin(st.steer, 0), -0.7, 0.7)
  const tuck = clamp(fin(st.tuck, 0), 0, 1)
  const rt = bk.rt
  // root: pitch about the road line, lean about the tyre-tube centre line (contact stays on the road)
  S_.root.makeRotationZ(MUT.has('grade06') ? pitch * 0.6 : pitch).multiply(_m.makeTranslation(0, rt, 0)).multiply(_m2.makeRotationX(lean)).multiply(_m.makeTranslation(0, -rt, 0))
  S_.bikeM.makeTranslation(0, rt, 0).multiply(_m.makeRotationX(sway)).multiply(_m2.makeTranslation(0, -rt, 0))
  S_.bikeQ.setFromAxisAngle(X_, sway)
  // fork: steer about the steering axis through the head-tube top
  S_.forkM.copy(S_.bikeM).multiply(_m.makeTranslation(bk.htTop.x, bk.htTop.y, 0)).multiply(_m2.makeRotationAxis(bk.up, -steer)).multiply(_m.makeTranslation(-bk.htTop.x, -bk.htTop.y, 0))
  S_.forkQ.copy(S_.bikeQ).multiply(_q.setFromAxisAngle(bk.up, -steer))
  setBoneM(bones, B.root, _m.identity())
  setBoneM(bones, B.bike, S_.bikeM)
  setBoneM(bones, B.fork, S_.forkM)
  const partsM = MUT.has('rollBikeOnly') ? new THREE.Matrix4() : S_.bikeM
  setBoneM(bones, B.frontWheel, _m2.copy(MUT.has('rollBikeOnly') ? partsM : S_.forkM).multiply(_m.makeTranslation(bk.front.x, bk.front.y, 0)).multiply(_m.makeRotationZ(-wheel)))
  setBoneM(bones, B.rearWheel, _m2.copy(partsM).multiply(_m.makeTranslation(bk.rear.x + (MUT.has('axleOff') ? 0.003 : 0), bk.rear.y, 0)).multiply(_m.makeRotationZ(-wheel)))
  S_.crankM.copy(S_.bikeM).multiply(_m.makeTranslation(bk.bb.x, bk.bb.y, 0)).multiply(_m2.makeRotationZ(-crank))
  setBoneM(bones, B.crank, MUT.has('crank90') ? _m2.copy(S_.crankM).multiply(_m.makeRotationZ(Math.PI / 2)) : S_.crankM)
  // hips
  const hip = S_.hip.copy(fit.hipSeat).lerp(fit.hipStand, s)
  if (MUT.has('standTall')) hip.y += s * 0.13
  hip.y += s * -0.012 * k * Math.cos(2 * (thR - 140 * DEG))
  hip.x += tuck * 0.012 * k
  hip.z = lerp(1, 0.5, s) * (hip.y - rt) * Math.sin(sway)
  // grips -> wrists (hands ride on the fork: steering carries them)
  let wA = 0
  const gripOf = (side) => {
    const gs = st.grip?.[side] ?? { a: 'hoods', b: 'hoods', p: 1 }
    const ga = rig.grips[gs.a] ? gs.a : 'hoods', gb = rig.grips[gs.b] ? gs.b : 'hoods'
    const p = clamp(fin(gs.p, 1), 0, 1), e = sstep(0, 1, p)
    const A = rig.grips[ga][side], Bg = rig.grips[gb][side]
    const pos = (side === 'R' ? S_.gR : S_.gL).copy(A.p).lerp(Bg.p, e)
    const arc = Math.sin(Math.PI * p) ** 2 // lift off and set down with zero speed: no pop when a grip change starts
    pos.y += arc * 0.045 * k; pos.x -= arc * 0.012 * k
    const q = (side === 'R' ? S_.qR : S_.qL).copy(A.q).slerp(Bg.q, e)
    wA += (ga === 'aero' ? 1 - e : 0) + (gb === 'aero' ? e : 0)
    pos.applyMatrix4(S_.forkM); q.premultiply(S_.forkQ)
    const w = side === 'R' ? S_.wR : S_.wL
    if (MUT.has('handsOff')) pos.y += 0.01
    return w.copy(d.grip).applyQuaternion(q).negate().add(pos)
  }
  const wR = gripOf('R'), wL = gripOf('L')
  wA *= 0.5
  // shoulders: the torso swings about the hip until the arms reach the wrists at the target elbow bend
  const T = d.torso, u = d.upperArm, f = d.foreArm
  const e = clamp(fin(st.elbow, 20), 0, 110) * DEG
  const Dw = Math.sqrt(u * u + f * f + 2 * u * f * Math.cos(e))
  const dz = (Math.abs(wR.z - hip.z) + Math.abs(wL.z - hip.z)) / 2 - d.shoulderHalf
  const Wm = S_.s1.addVectors(wR, wL).multiplyScalar(0.5)
  const sh = circles(hip, T, Wm, Math.sqrt(Math.max(Dw * Dw - dz * dz, 0.0025)), S_.sh)
  if (wA > 0 && fit.pad) {
    const el = S_.s2.copy(fit.ext.elbow).applyMatrix4(S_.forkM)
    const dzE = 0.1 * k - d.shoulderHalf
    const sa = circles(hip, T, el, Math.sqrt(Math.max(u * u - dzE * dzE, 0.0025)), V())
    sh.lerp(sa, wA)
  }
  // both hands must stay reachable (asymmetric grips mid-change, steering, low drops): the torso angle on the
  // hip circle may not exceed the highest angle from which each wrist is still in reach — a smooth min, so the
  // torso eases into the constraint instead of hitting it
  let ang = Math.atan2(sh.y - hip.y, sh.x - hip.x)
  for (const w of [wR, wL]) {
    const reach = u + f - 0.012, dzs = Math.max(Math.abs(w.z - hip.z) - d.shoulderHalf, 0)
    const d2 = Math.sqrt(Math.max(reach * reach - dzs * dzs, 0.0025))
    const lim = circles(hip, T, w, d2, S_.s2)
    if (!MUT.has('noReachFix')) ang = smin(ang, Math.atan2(lim.y - hip.y, lim.x - hip.x), 0.03)
  }
  sh.set(hip.x + Math.cos(ang) * T, hip.y + Math.sin(ang) * T, hip.z * 0.6)
  const Yt = S_.ty.subVectors(sh, hip).normalize()
  const torsoRoll = fin(st.torsoRoll, 0) + sway * 0.4 * s
  const Z0 = S_.tz.set(0, -Math.sin(torsoRoll), Math.cos(torsoRoll))
  const Xt = S_.tx.crossVectors(Yt, Z0).normalize()
  Z0.crossVectors(Xt, Yt)
  const yaw = clamp(fin(st.yawAmp, 0), 0, 0.15) * Math.sin(thR - 90 * DEG) - steer * 0.6
  S_.tq.setFromRotationMatrix(_m.makeBasis(Xt, Yt, Z0)).premultiply(_q.setFromAxisAngle(Yt, yaw))
  setBone(bones, B.torso, hip, S_.tq)
  const Xw = V(1, 0, 0).applyQuaternion(S_.tq), Zw = V(0, 0, 1).applyQuaternion(S_.tq)
  // pelvis: takes part of the torso's forward lean, rocks ~2° toward the downstroke
  const alpha = Math.atan2(Yt.y, Yt.x)
  const tilt = PELVIS_TILT * (Math.PI / 2 - alpha)
  const roll = rockAmp * Math.sin(thR - 100 * DEG), pyaw = rockAmp * 0.6 * Math.sin(thR - 90 * DEG)
  S_.pq.setFromAxisAngle(Y_, pyaw - steer * 0.25).multiply(_q.setFromAxisAngle(X_, roll + sway * (1 - 0.5 * s))).multiply(_q2.setFromAxisAngle(Z_, -tilt))
  setBone(bones, B.pelvis, hip, S_.pq)
  // legs
  const out = mesh.userData.metrics ?? (mesh.userData.metrics = {})
  out.reachClamp = 0
  for (const [side, th, shn, ft, phase] of [[1, B.thighR, B.shinR, B.footR, 0], [-1, B.thighL, B.shinL, B.footL, Math.PI]]) {
    const a = crank + phase, theta = a + Math.PI / 2
    const sp = S_.sp.set(side * fit.crank, 0, side * fit.pedalZ).applyMatrix4(S_.crankM)
    if (MUT.has('phaseL') && side < 0) { const c0 = V(bk.bb.x, bk.bb.y, sp.z); sp.sub(c0).applyAxisAngle(Z_, 0.17).add(c0) }
    const td = toeDown(theta) + s * 8 * DEG - tuck * 4 * DEG
    const fq = S_.qf.copy(S_.bikeQ).multiply(_q.setFromAxisAngle(Z_, -td))
    if (MUT.has('heelIn')) fq.multiply(_q.setFromAxisAngle(Y_, side * 0.5))
    const ankle = S_.ankle.copy(d.cleat).applyQuaternion(fq).negate().add(sp)
    const hj = S_.hj.set(0, 0, side * d.hipHalf).applyQuaternion(S_.pq).add(hip)
    const splay = 0.08 + 1.0 * Math.max(0, sway * side) - 0.09 * tuck + 0.03 * Math.sin(2 * theta - Math.PI / 2)
    const pole = S_.pole.set(MUT.has('kneeFlip') ? -1 : 1, 0, side * splay).normalize()
    if (hj.distanceTo(ankle) > d.thigh + d.shin - 0.001) out.reachClamp++
    const knee = twoBone(hj, ankle, d.thigh, d.shin, pole, S_.knee, S_.bend)
    chainQuats(hj, knee, ankle, S_.bend, S_.qa, S_.qb)
    setBone(bones, th, hj, S_.qa); setBone(bones, shn, knee, S_.qb); setBone(bones, ft, ankle, fq)
  }
  // arms (+ hands on their grips)
  const sprint = clamp(fin(st.elbowOut, 0), 0, 1)
  for (const [side, up, fo, hb, w, q] of [[1, B.armR, B.foreR, B.handR, wR, S_.qR], [-1, B.armL, B.foreL, B.handL, wL, S_.qL]]) {
    const shJ = S_.s2.copy(sh).addScaledVector(Zw, side * d.shoulderHalf).addScaledVector(Yt, -0.012 * k)
    // shoulder protraction (up to 6 cm): the shoulder blade slides toward a far hand before the elbow would lock
    const keep = Math.sqrt(u * u + f * f + 2 * u * f * Math.cos(10 * DEG)), far = shJ.distanceTo(w) - keep
    if (far > 0 && !MUT.has('noReachFix')) shJ.addScaledVector(V().subVectors(w, shJ).normalize(), Math.min(far, 0.06 * k))
    const pole = S_.pole.copy(Xw).multiplyScalar(-0.2).add(V(-0.3, -0.75 - 0.25 * tuck, 0)).addScaledVector(Zw, (MUT.has('elbowsIn') ? -1.2 : 1) * side * lerp(0.5, 0.85, sprint) * (1 - 0.55 * tuck))
    if (wA > 0 && fit.pad) { const el = V().copy(fit.ext.elbow).setZ(side * 0.1 * k).applyMatrix4(S_.forkM); const mid = V().addVectors(shJ, w).multiplyScalar(0.5); pole.lerp(el.sub(mid).normalize(), wA) }
    if (shJ.distanceTo(w) > u + f - 0.001) out.reachClamp++
    const el = twoBone(shJ, w, u, f, pole, S_.elbow, S_.bend)
    chainQuats(shJ, el, w, S_.bend, S_.qa, S_.qb)
    setBone(bones, up, shJ, S_.qa); setBone(bones, fo, el, S_.qb); setBone(bones, hb, w, q)
  }
  // head: level-seeking gaze (world pitch), counter-rolls the shoulders
  const neck = V().copy(sh).addScaledVector(Yt, 0.035 * k).addScaledVector(Xw, -0.012 * k)
  const gaze = clamp(fin(st.gaze, -8), -40, 20) * DEG - pitch
  const nod = fin(st.nodAmp, 0) * Math.sin(2 * crank) + fin(st.nod, 0) // st.nod: model.js callers pass the nod itself
  _q.setFromAxisAngle(Y_, clamp(fin(st.headYaw, 0), -0.8, 0.8)).multiply(_q2.setFromAxisAngle(Z_, gaze + nod)).multiply(S_.qa.setFromAxisAngle(X_, -torsoRoll * 0.8))
  setBone(bones, B.head, neck, _q)
  // shader: how far the wheels turned this frame (motion-blurred spokes and decals)
  const u2 = mesh.material?.userData?.u
  // callers without an animator (model.js-style) get the per-call wheel sweep, so spokes still never strobe
  const wd = typeof st.wheelDelta === 'number' ? st.wheelDelta : MUT.has('noCompatBlur') ? 0 : Math.abs(wheel - fin(mesh.userData.lastWheel, wheel))
  mesh.userData.lastWheel = wheel
  if (u2) u2.uWheelDelta.value = clamp(Math.abs(fin(wd, 0)), 0, 20)
  out.sway = sway; out.wA = wA
  return mesh
}

// ---------------------------------------------------------------- animation controller (data in, pose state out)
// Every threshold here is a proposal for docs/SPEC.md "Rider animation (defaults — tune in alpha)".
export const ANIM = {
  cadenceTiers: [[0.55, 80], [0.75, 85], [0.9, 90], [Infinity, 95]], // SPEC.md:569 nominal cadence when a trainer reports none
  stoppedCadence: 5, stoppedPower: 20, // SPEC.md:468-469
  maxRpm: 130,
  sprint: { enterR: 1.6, enterArmedR: 1.2, exitR: 1.2, exitArmedR: 1.0, minCad: 50, dwell: 2 },
  climb: { grade: 5, cadBelow: 72, r: 0.8, hold: 2, exitCad: 78, exitGrade: 3, exitR: 0.65, dwell: 3 },
  tuck: { kmh: 50, grade: -4, exitKmh: 42, exitGrade: -2, after: 0.4, dwell: 1.5 },
  drops: { kmh: 45, r: 1.2, exitKmh: 40, exitR: 1.05 }, tops: { grade: 4, r: 0.55, exitGrade: 3, exitR: 0.65 }, gripDwell: 3,
  halfLife: { cadence: 0.3, cadenceRemote: 0.5, stand: 0.25, elbow: 0.25, gaze: 0.3, sway: 0.3, rock: 0.4, tuck: 0.3, lean: 0.3, steer: 0.15, pitch: 0.25, look: 0.25 },
  standWindow: [20, 60], sitWindow: [160, 200], gripMove: 0.3, gripStagger: 0.12,
  swayDeg: { seated: 0.6, climb: 4, sprint: 9 }, rockDeg: { seated: 1.8, stand: 1.0 },
  elbow: { hoods: 20, drops: 28, tops: 16, aero: 20, sprint: 55, climb: 36, coast: 18, tuck: 80, stopped: 16 },
  gaze: { seated: -8, sprint: -15, climb: -10, coast: -5, tuck: -18, stopped: -3 },
  settleMin: 0.2 // s: shortest coast-to-level move
}
function spring(sp, goal, hl, dt) {
  const y = (2 * Math.LN2) / Math.max(hl, 1e-3), j0 = sp.x - goal, j1 = sp.v + j0 * y, e = Math.exp(-y * dt)
  sp.x = e * (j0 + j1 * dt) + goal; sp.v = e * (sp.v - j1 * y * dt)
}
const SP0 = (x = 0) => ({ x, v: 0 })
export function nominalCadence(power, ftp) {
  if (MUT.has('noTier')) return 70
  const r = power / Math.max(ftp, 1)
  for (const [lim, rpm] of ANIM.cadenceTiers) if (r <= lim) return rpm
  return 95
}

export class RiderAnimator {
  constructor(mesh, opts = {}) {
    const rig = mesh?.userData?.rig
    this.rig = rig
    this.remote = !!opts.remote
    this.reduced = !!opts.reducedMotion
    this.rand = mulberry((opts.seed ?? 1) >>> 0)
    this.crank = fin(opts.crank, 0); this.wheel = 0; this.wheelDelta = 0
    this.cad = SP0(); this.mode = 'hold'; this.settle = null
    this.rFast = 0; this.rSlow = 0; this.t = 0; this.vS = 0; this.gS = 0
    this.posture = 'stopped'; this.postureT = 99; this.climbT = 0; this.coastT = 0
    this.standGoal = 0
    this.sp = { stand: SP0(), elbow: SP0(ANIM.elbow.stopped), gaze: SP0(ANIM.gaze.stopped), sway: SP0(), rock: SP0(), tuck: SP0(), lean: SP0(), steer: SP0(), pitch: SP0(), yaw: SP0(), look: SP0(), out: SP0() }
    this.gripGoal = 'hoods'; this.gripT = 99
    this.hands = { R: { a: 'hoods', b: 'hoods', p: 1, delay: 0 }, L: { a: 'hoods', b: 'hoods', p: 1, delay: 0 } }
    this.lookNext = 8 + this.rand() * 12; this.lookUntil = -1; this.lookDir = 0
    this.stretchNext = 180 + this.rand() * 180; this.stretchUntil = -1
    this.state = {}
    this.update(0, {})
  }
  get omega() { return this.mode === 'pedal' ? (this.cad.x * TAU) / 60 : this.mode === 'settle' ? this.settle.v0 * (1 - Math.min(this.settle.t / this.settle.T, 1)) : 0 }
  update(dtIn, inp = {}) {
    const dt = clamp(fin(dtIn, 0), 0, 1)
    this.t += dt
    const ftp = fin(inp.ftp, 0) > 30 ? inp.ftp : 250
    const power = clamp(fin(inp.power, 0), 0, 3000)
    const cadIn = fin(inp.cadence, NaN)
    const speed = MUT.has('nanLeak') ? inp.speed : clamp(fin(inp.speed, 0), 0, 40)
    const grade = clamp(fin(inp.grade, 0), -30, 30)
    const kappa = clamp(fin(inp.curvature, 0), -0.25, 0.25)
    const sprintArmed = !!inp.sprint
    const reduced = this.reduced || !!inp.reducedMotion
    const hl = ANIM.halfLife
    // --- cadence and crank (legs move only when the data says so)
    const reported = Number.isFinite(cadIn) && cadIn >= ANIM.stoppedCadence ? Math.min(cadIn, 150) : null
    const target = reported != null ? Math.min(reported, ANIM.maxRpm) : power >= ANIM.stoppedPower ? nominalCadence(power, ftp) : 0
    const lean = this.sp.lean.x
    if (target > 0) {
      if (this.mode !== 'pedal') { this.cad.x = (this.omega * 60) / TAU; this.cad.v = 0; this.mode = 'pedal'; this.settle = null }
      spring(this.cad, MUT.has('cadenceLag') ? target * 0.97 : target, this.remote ? hl.cadenceRemote : hl.cadence, dt)
      this.cad.x = clamp(this.cad.x, 0, ANIM.maxRpm)
      this.crank += (MUT.has('reverse') ? -1 : 1) * (this.cad.x / 60) * TAU * dt
    } else {
      if (this.mode === 'pedal') {
        const v0 = (this.cad.x * TAU) / 60
        if (v0 < 0.05) this.mode = 'hold'
        else {
          const dmin = v0 * ANIM.settleMin * 0.5
          const lvl = MUT.has('backpedal') ? Math.round(this.crank / Math.PI) * Math.PI : Math.ceil((this.crank + dmin) / Math.PI - 1e-9) * Math.PI
          let goal = lvl
          if (Math.abs(lean) > 12 * DEG) { // inside pedal up if it is no further than the next level position allows
            const want = lean > 0 ? -Math.PI / 2 : Math.PI / 2
            const up = want + Math.ceil((this.crank + dmin - want) / TAU - 1e-9) * TAU
            if (up - this.crank <= Math.PI + dmin) goal = up
          }
          let dd = goal - this.crank
          if (dd > v0 * 0.6) dd = v0 * 0.175 // a level crank is too far to reach in 1.2 s without pedalling: stop softly where we are
          this.settle = { a0: this.crank, d: dd, v0, T: (2 * dd) / v0, t: 0 }
          this.mode = 'settle'
        }
        this.cad.x = 0; this.cad.v = 0
      }
      if (this.mode === 'settle') {
        const S = this.settle
        S.t += dt
        const x = Math.min(S.t / S.T, 1)
        this.crank = S.a0 + S.d * (2 * x - x * x) // constant deceleration to rest, forward only
        if (x >= 1) { this.crank = S.a0 + S.d; this.mode = 'hold'; this.settle = null }
      }
    }
    if (this.crank > 1e4) { const w = Math.floor(this.crank / TAU) * TAU; this.crank -= w; if (this.settle) this.settle.a0 -= w }
    const wheelR = this.rig?.wheelR ?? 0.34
    this.wheelDelta = (speed / (MUT.has('wheelR034') ? 0.34 : wheelR)) * dt
    this.wheel = (this.wheel + this.wheelDelta) % (TAU * 1000)
    const cadNow = this.mode === 'pedal' ? this.cad.x : 0
    const pedalling = target > 0
    // --- effort signals
    const r = power / ftp
    this.rFast += (r - this.rFast) * (1 - Math.exp(-dt / 0.8))
    this.rSlow += (r - this.rSlow) * (1 - Math.exp(-dt / 3))
    this.vS += (speed - this.vS) * (1 - Math.exp(-dt / 1)) // decisions read smoothed speed and grade, never a single noisy sample
    this.gS += (grade - this.gS) * (1 - Math.exp(-dt / 1.5))
    // --- posture state machine (hysteresis + dwell)
    const kmh = speed * 3.6
    const A = ANIM
    this.postureT += dt
    if (pedalling) this.coastT = 0; else this.coastT += dt
    const gS = this.gS, kmhS = this.vS * 3.6
    const inClimb = gS >= A.climb.grade && cadNow < A.climb.cadBelow && this.rSlow >= A.climb.r
    this.climbT = pedalling && inClimb ? this.climbT + dt : 0
    let next = this.posture
    if (!pedalling) {
      if (speed < 0.4) next = 'stopped'
      else if (this.posture === 'tuck') next = (kmhS >= A.tuck.exitKmh && gS <= A.tuck.exitGrade) || this.postureT < A.tuck.dwell ? 'tuck' : 'coast'
      else next = kmhS >= A.tuck.kmh && gS <= A.tuck.grade && this.coastT >= A.tuck.after && (this.posture !== 'coast' || this.postureT >= 0.5) ? 'tuck' : 'coast'
    } else {
      const sprintEnter = cadNow >= A.sprint.minCad && (this.rFast >= A.sprint.enterR || (sprintArmed && this.rFast >= A.sprint.enterArmedR))
      const sprintStay = cadNow >= A.sprint.minCad - 10 && (this.rFast >= A.sprint.exitR || (sprintArmed && this.rFast >= A.sprint.exitArmedR))
      const climbStay = !(cadNow > A.climb.exitCad || gS < A.climb.exitGrade || this.rSlow < A.climb.exitR)
      const stretchOn = this.t < this.stretchUntil && gS >= A.climb.grade
      if (this.posture === 'sprint') next = (MUT.has('noHysteresis') ? sprintEnter : sprintStay || this.postureT < A.sprint.dwell) ? 'sprint' : climbStay && gS >= A.climb.grade ? 'climb' : 'seated'
      else if (this.posture === 'climb') next = sprintEnter ? 'sprint' : climbStay || this.postureT < A.climb.dwell ? 'climb' : 'seated'
      else if (this.posture === 'stretch') next = sprintEnter ? 'sprint' : stretchOn || this.postureT < 3 ? 'stretch' : 'seated'
      else if (this.posture === 'seated' && this.postureT < 1.0 && !sprintEnter) next = 'seated' // a short settle after sitting down
      else next = sprintEnter ? 'sprint' : this.climbT >= A.climb.hold ? 'climb' : 'seated'
      if (next === 'seated' && gS >= A.climb.grade && this.t >= this.stretchNext && this.postureT > 20) { next = 'stretch'; this.stretchUntil = this.t + 8 + this.rand() * 7; this.stretchNext = this.t + 180 + this.rand() * 180 }
    }
    if (next !== this.posture) { this.posture = next; this.postureT = 0 }
    // --- stand/sit timed to the crank (lead crank 20–60° after TDC to rise, 160–200° to sit)
    const wantStand = pedalling && (this.posture === 'sprint' || this.posture === 'climb' || this.posture === 'stretch')
    const ph = ((((this.crank + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) / DEG
    // on a TT bike the hands leave the extensions before the rider stands (never both at once)
    const handsReady = !this.rig?.isTT || (this.hands.R.p >= 1 && this.hands.L.p >= 1 && this.hands.R.b !== 'aero')
    if (wantStand && handsReady && this.standGoal === 0 && ph >= A.standWindow[0] && ph <= A.standWindow[1]) this.standGoal = 1
    if (!wantStand && this.standGoal === 1 && (!pedalling || ph >= A.sitWindow[0] || ph <= A.sitWindow[1] - 180)) this.standGoal = 0
    // --- grips (forced by sprint/tuck at once; every other change waits out the grip dwell)
    const rig = this.rig
    let goal = this.gripGoal, forced = false
    this.gripT += dt
    const gradeS = gS
    if (rig?.isUpright) goal = 'hoods'
    else if (rig?.isTT) {
      // extensions whenever seated or coasting at speed; the base bar to stand, corner, climb steep or roll slowly
      const aero = (P0 => P0 === 'seated' || P0 === 'coast' || P0 === 'tuck')(this.posture) && this.sp.stand.x < 0.2 && gradeS <= 6 && Math.abs(lean) < 8 * DEG && kmhS > 15
      goal = aero ? 'aero' : 'hoods'
      forced = !aero && (this.posture === 'sprint' || this.posture === 'climb' || Math.abs(lean) >= 8 * DEG)
    } else {
      forced = this.posture === 'sprint' || this.posture === 'tuck'
      if (forced) goal = 'drops'
      else if (this.posture === 'seated') {
        const wantDrops = kmhS >= A.drops.kmh || this.rSlow >= A.drops.r
        const keepDrops = kmhS >= A.drops.exitKmh || this.rSlow >= A.drops.exitR
        const wantTops = gradeS >= A.tops.grade && this.rSlow < A.tops.r
        const keepTops = gradeS >= A.tops.exitGrade && this.rSlow <= A.tops.exitR
        if (this.gripGoal === 'drops' && keepDrops) goal = 'drops'
        else if (this.gripGoal === 'tops' && keepTops && !wantDrops) goal = 'tops'
        else goal = wantDrops ? 'drops' : wantTops ? 'tops' : 'hoods'
      } else goal = this.posture === 'climb' || this.posture === 'stretch' ? 'hoods' : this.posture === 'coast' && this.gripGoal === 'drops' && kmhS > 35 ? 'drops' : 'hoods'
    }
    if (goal !== this.gripGoal && !forced && this.gripT < A.gripDwell) goal = this.gripGoal
    if (goal !== this.gripGoal) {
      const idle = this.hands.R.p >= 1 && this.hands.L.p >= 1
      if (idle) {
        // hands travel at a steady ~0.7 m/s: a short hop is quick, pads-to-base-bar takes longer
        const g0 = rig?.grips?.[this.hands.R.b]?.R?.p, g1 = rig?.grips?.[goal]?.R?.p
        const q0 = rig?.grips?.[this.hands.R.b]?.R?.q, q1 = rig?.grips?.[goal]?.R?.q
        let dur = g0 && g1 ? clamp(Math.max(g0.distanceTo(g1) / 0.7 + 0.12, q0.angleTo(q1) / 4 + 0.1, goal === 'aero' || this.hands.R.b === 'aero' ? 0.5 : 0), A.gripMove, 0.6) : A.gripMove
        this.gripGoal = goal; this.gripT = 0
        if (MUT.has('fastGrip')) dur = 0.08
        this.hands.R = { a: this.hands.R.b, b: goal, p: 0, delay: 0, dur }
        this.hands.L = { a: this.hands.L.b, b: goal, p: 0, delay: A.gripStagger, dur }
      }
    }
    for (const h of [this.hands.R, this.hands.L]) {
      if (h.p >= 1) continue
      const dur = h.dur ?? A.gripMove
      if (h.delay > 0) { h.delay -= dt; if (h.delay > 0) continue; h.p += -h.delay / dur; h.delay = 0 }
      else h.p += dt / dur
      if (h.p >= 1) { h.p = 1; h.a = h.b }
    }
    // --- continuous targets
    const P = this.posture
    const grip = this.hands.R.b
    const elbowGoal = P === 'tuck' ? A.elbow.tuck : P === 'sprint' ? A.elbow.sprint : P === 'climb' || P === 'stretch' ? A.elbow.climb : P === 'coast' || P === 'stopped' ? Math.max(A.elbow[P], (A.elbow[grip] ?? A.elbow.hoods) - 2) : A.elbow[grip] ?? A.elbow.hoods
    const gazeGoal = A.gaze[P === 'stretch' ? 'climb' : P] ?? A.gaze.seated
    const swayStand = (P === 'sprint' ? A.swayDeg.sprint * clamp(this.rFast / A.sprint.enterR, 0.7, 1.15) : A.swayDeg.climb * clamp(this.rSlow, 0.6, 1.3)) * DEG * (rig?.isUpright ? 0.55 : 1)
    const swaySeat = pedalling ? A.swayDeg.seated * clamp(r, 0, 1.2) * DEG : 0
    const swayGoal = reduced ? 0 : this.standGoal ? swayStand : swaySeat
    const rockGoal = reduced || !pedalling ? 0 : (this.standGoal ? A.rockDeg.stand : A.rockDeg.seated * clamp(r, 0.3, 1.2)) * DEG
    const leanGoal = clamp(Math.atan((speed * speed * kappa) / 9.81), -(pedalling ? rig?.leanMax.pedal ?? 0.35 : rig?.leanMax.coast ?? 0.5), pedalling ? rig?.leanMax.pedal ?? 0.35 : rig?.leanMax.coast ?? 0.5)
    const wb = rig?.bk.wheelbase ?? 1
    const steerGoal = clamp(Math.atan(wb * kappa), -0.6, 0.6)
    // look-around: seeded, only when relaxed
    if (this.t >= this.lookNext) { this.lookNext = this.t + 8 + (MUT.has('random') ? Math.random() : this.rand()) * 12; if ((P === 'seated' || P === 'coast') && Math.abs(lean) < 5 * DEG && !reduced) { this.lookUntil = this.t + 1.2; this.lookDir = this.rand() < 0.5 ? -1 : 1 } }
    const lookGoal = this.t < this.lookUntil ? this.lookDir * 0.35 : 0
    if (MUT.has('legsAt0') && this.mode === 'hold') this.crank += 1.2 * dt
    if (MUT.has('expEase')) { this.sp.stand.x += (this.standGoal - this.sp.stand.x) * (1 - Math.exp(-dt / 0.08)); this.sp.stand.v = 0 } else spring(this.sp.stand, this.standGoal, hl.stand, dt)
    spring(this.sp.elbow, elbowGoal, hl.elbow, dt)
    spring(this.sp.gaze, gazeGoal, hl.gaze, dt)
    spring(this.sp.sway, swayGoal, hl.sway, dt)
    spring(this.sp.rock, rockGoal, hl.rock, dt)
    spring(this.sp.tuck, P === 'tuck' ? 1 : 0, hl.tuck, dt)
    spring(this.sp.lean, leanGoal, MUT.has('leanSnap') ? 0.03 : hl.lean, dt)
    spring(this.sp.steer, steerGoal, hl.steer, dt)
    spring(this.sp.pitch, Math.atan(grade / 100), hl.pitch, dt)
    spring(this.sp.yaw, reduced ? 0 : P === 'sprint' ? 5 * DEG : 0, hl.rock, dt)
    spring(this.sp.look, lookGoal, hl.look, dt)
    spring(this.sp.out, P === 'sprint' ? 1 : 0, hl.elbow, dt)
    // the pedalling lean clamp also holds while cadence spins up (hard limit only as a safety net)
    const leanNow = clamp(this.sp.lean.x, -(rig?.leanMax.coast ?? 0.5), rig?.leanMax.coast ?? 0.5)
    const st = this.state
    st.crank = this.crank; st.wheel = this.wheel; st.wheelDelta = this.wheelDelta
    st.stand = clamp(this.sp.stand.x, 0, 1); st.swayAmp = Math.max(0, this.sp.sway.x); st.rockAmp = Math.max(0, this.sp.rock.x)
    st.elbow = this.sp.elbow.x; st.gaze = this.sp.gaze.x; st.tuck = clamp(this.sp.tuck.x, 0, 1); st.lean = leanNow; st.steer = this.sp.steer.x; st.pitch = this.sp.pitch.x
    st.yawAmp = Math.max(0, this.sp.yaw.x); st.headYaw = this.sp.look.x; st.nodAmp = reduced ? 0 : 0.012 * clamp(r, 0, 1.4); st.elbowOut = clamp(this.sp.out.x, 0, 1)
    st.grip = { R: { a: this.hands.R.a, b: this.hands.R.b, p: this.hands.R.p }, L: { a: this.hands.L.a, b: this.hands.L.b, p: this.hands.L.p } }
    st.posture = P; st.cadence = cadNow; st.mode = this.mode; st.pedalling = pedalling
    return st
  }
}

// Mirrors of the fragment shader's spoke/decal coverage (qa.mjs checks they never strobe).
export function blurWindow(d, P) {
  if (MUT.has('noBlur')) return d
  if (d >= 0.35 * P) return P * Math.max(1, Math.ceil(d / P - 1e-4))
  const t = clamp((d - 0.2 * P) / (0.15 * P), 0, 1)
  return lerp(d, P, t * t * (3 - 2 * t))
}
export function spokeCoverage(phi, delta, k, widthRad, h = 0) {
  const P = TAU / k, w = Math.min(widthRad, P), win = blurWindow(delta + 2 * h, P)
  const F = (x) => Math.floor(x / P) * w + Math.min(((x % P) + P) % P, w)
  return clamp((F(phi + h) - F(phi + h - win)) / Math.max(win, 1e-5), 0, 1)
}
