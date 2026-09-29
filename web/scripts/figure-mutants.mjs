#!/usr/bin/env node
// The figure's mutants (#3072): inject each gate's bug, confirm the figure's
// tests catch it, restore. A local check, not a CI job — about two minutes.
// A mutant whose text is gone reports "stale": rewrite it against the code
// it was meant to break, never delete it to go green.
//
//   node scripts/figure-mutants.mjs            every mutant
//   node scripts/figure-mutants.mjs G12 G13    just those gates
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const dir = 'src/lib/world/figure/';

// [gate, what breaks, file, [from, to] pairs — each `from` replaced everywhere]
// prettier-ignore
const MUTANTS = [
	['G1', 'shin 3% short', 'pose.ts', [['d.thigh, d.shin, pole, S_.knee', 'd.thigh, d.shin * 0.97, pole, S_.knee']]],
	['G1', 'ankle on the spindle, not behind the cleat', 'pose.ts', [['.negate()\n\t\t\t.add(sp);', '.multiplyScalar(0)\n\t\t\t.add(sp);']]],
	['G4', 'saddle 3 cm high', 'pose.ts', [['\thip.x += tuck * 0.012 * k;', '\thip.x += tuck * 0.012 * k;\n\thip.y += 0.03;']]],
	['G4', 'fit to a 15° knee', 'bikes/fit.ts', [['FIT_KNEE_DEG = 35', 'FIT_KNEE_DEG = 15']]],
	['G7', 'forearm 3% short', 'pose.ts', [['twoBone(shJ, w, u, f, pole', 'twoBone(shJ, w, u, f * 0.97, pole']]],
	['G8', 'front wheel on the frame, not the fork', 'pose-frame.ts', [['.copy(S_.forkM)', '.copy(S_.bikeM)']]],
	['G8', 'crank 1 cm off its shell', 'pose-frame.ts', [['makeTranslation(bk.bb.x, bk.bb.y, 0)', 'makeTranslation(bk.bb.x + 0.01, bk.bb.y, 0)']]],
	['G8', 'wrist on the grip centre', 'pose.ts', [['.copy(pos).sub(grip);', '.copy(pos);']]],
	['G9', 'steering about the origin', 'pose-frame.ts', [['.multiply(_m.makeTranslation(bk.htTop.x, bk.htTop.y, 0))\n\t\t.multiply(_m2.makeRotationAxis(bk.up, -steer))', '.multiply(_m2.makeRotationAxis(bk.up, -steer))']]],
	['G10', 'knees turned in', 'pose.ts', [['\t\t\t0.08 +\n', '\t\t\t-0.4 +\n']]],
	['G10', 'elbows turned in', 'pose.ts', [['side * lerp(0.5, 0.85, out) * (1 - 0.55 * tuck)', 'side * -1.5']]],
	['G11', 'coasting settles backwards', 'crank-motion.ts', [['Math.ceil((this.crank + dmin) / Math.PI - 1e-9)', 'Math.round(this.crank / Math.PI)']]],
	['G12', 'no stand spring', 'animator.ts', [['spring(sp.stand, mind.standGoal, hl.stand, dt);', 'sp.stand.x = mind.standGoal;']]],
	['G12', 'no lean spring', 'animator.ts', [['\t\t\thl.lean,\n', '\t\t\t1e-6,\n']]],
	['G12', 'hands jump between grips', 'behaviour.ts', [['} else h.p += r.dt / h.dur;', '} else h.p = 1;']]],
	['G12', 'toe-down snaps as you stand', 'pose.ts', [['s * 8 * DEG', '(s > 0.5 ? 8 : 0) * DEG']]],
	['G13', 'the pattern stays past 0.6 of a period', 'material.ts', [['0.35 * P', '0.6 * P'], ['full: 0.35', 'full: 0.6']]],
	['G13', 'no blur at all', 'material.ts', [['\tif (d >= 0.35 * P) return P * max(1.0, ceil(d / P - 1e-4));\n\treturn mix(d, P, smoothstep(0.2 * P, 0.35 * P, d));', '\treturn d;'], ['\tif (d >= BLUR.full * P)', '\treturn d;\n\tif (d >= BLUR.full * P)']]],
	['G13', 'JS % beside floor', 'material.ts', [['return n * w + Math.min(x - n * P, w);', 'return n * w + Math.min(((x % P) + P) % P, w);']]],
	['G13', 'window not normalised', 'material.ts', [['/ Math.max(win, 1e-5)', '/ Math.max(P, 1e-5)']]],
	['G13b', 'the shader drifts from its mirror', 'material.ts', [['smoothstep(0.2 * P', 'smoothstep(0.25 * P']]],
	['G13', 'an emissive term', 'material.ts', [['vertexColors: true,', 'vertexColors: true, emissive: 0x111111,']]],
	['G13', 'the patch misses its anchor', 'material.ts', [["'#include <color_fragment>', WHEELS", "'#include <color_fragment_x>', WHEELS"]]],
	['G13', 'every rider blurs alike', 'material.ts', [['u.uWheelDelta.value = Math.abs(Number(object.userData.wheelDelta) || 0);', 'void object;']]],
	['G14', 'lean unguarded', 'pose.ts', [['const lean = clamp(fin(st.lean, 0), -0.7, 0.7);', 'const lean = clamp(st.lean ?? 0, -0.7, 0.7);']]],
	['G14', 'dt unguarded', 'animator.ts', [['clamp(fin(dtIn, 0), 0, 1)', 'clamp(dtIn, 0, 1)']]],
	['G15', 'no posture floor', 'behaviour.ts', [['next !== P && this.postureT >= A.postureFloor', 'next !== P']]],
	['G15', 'no pedal hold', 'anim-params.ts', [['pedalHold: 0.3', 'pedalHold: 0']]],
	['G16', 'unseeded glances', 'animator.ts', [['this.lookDir = this.rand() < 0.5 ? -1 : 1;', 'this.lookDir = Math.random() < 0.5 ? -1 : 1;']]],
	['G21', 'the legacy rock ignored', 'pose.ts', [['const compat = st.swayAmp === undefined && st.rock !== undefined;', 'const compat = false;']]],
	['G21', 'the legacy nod ignored', 'pose.ts', [[' + fin(st.nod, 0)', '']]],
	['SPEC', 'coasting never gives up on a far level crank', 'crank-motion.ts', [['if (dd > (v0 * ANIM.settleWithin) / 2) dd = v0 * 0.175;', '']]],
	['SPEC', 'reduced motion keeps the sway', 'animator.ts', [['reduced ? 0 : stood ? swayStand : swaySeat', 'stood ? swayStand : swaySeat']]],
	['SPEC', 'standing up anywhere in the stroke', 'anim-params.ts', [['standWindow: [20, 60]', 'standWindow: [0, 180]']]],
	['SPEC', 'both hands move at once', 'anim-params.ts', [['gripStagger: 0.12', 'gripStagger: 0']]],
	['SPEC', '20 W counts as stopped', 'animator.ts', [['return power >= A.stopped.power', 'return power > A.stopped.power']]],
	['SPEC', 'pedalling lean from level cranks', 'rig.ts', [['pedal: Math.min(maxLean(Math.PI / 2), 28 * DEG)', 'pedal: Math.min(maxLean(0), 28 * DEG)']]],
];

const only = process.argv.slice(2);
const run = () => {
	try {
		execFileSync('pnpm', ['exec', 'vitest', 'run', dir], {
			cwd: web,
			stdio: 'pipe',
			timeout: 180_000,
		});
		return true;
	} catch {
		return false;
	}
};

if (!run()) {
	console.error('The figure tests fail before any mutant — fix that first.');
	process.exit(1);
}
const originals = new Map();
const restore = () => {
	for (const [path, text] of originals) writeFileSync(path, text);
	originals.clear();
};
process.on('SIGINT', () => {
	restore();
	process.exit(130);
});

const results = [];
for (const [gate, what, file, edits] of MUTANTS) {
	if (only.length && !only.includes(gate)) continue;
	const path = `${web}/${dir}${file}`;
	const text = readFileSync(path, 'utf8');
	let next = text;
	const stale = edits.some(([from]) => !next.includes(from));
	for (const [from, to] of edits) next = next.replaceAll(from, to);
	let verdict = 'stale';
	if (!stale) {
		originals.set(path, text);
		writeFileSync(path, next);
		try {
			verdict = run() ? 'SURVIVED' : 'caught';
		} finally {
			restore();
		}
	}
	results.push({ gate, what, verdict });
	console.log(`${verdict.padEnd(8)} ${gate.padEnd(5)} ${what}`);
}
const bad = results.filter((r) => r.verdict !== 'caught');
console.log(`\n${results.length - bad.length}/${results.length} caught`);
process.exit(bad.length ? 1 : 0);
