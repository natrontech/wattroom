// Set pieces scheduled by riding time, not by metres: something small every
// 20–40 s, something medium every 3–5 min, something big every 15–25 min —
// the rhythm that stops a 25-minute climb from being 25 minutes of nothing.
// Restraint is part of the rule: small kits are ≤ 2 m and ≥ 6 m off the
// asphalt, no kit repeats within four of its class, an empty meadow counts.
import { Biome } from './biome';
import type { Ground } from './dress';
import { clearOf } from './field';
import { namesFor } from './names';
import type { Marker } from './markers';
import { REFERENCE, steadySpeed } from './physics';
import { type Route } from '$lib/road/route';
import { frameAt } from '$lib/road/along';

export type PieceKind =
	| 'bench'
	| 'woodpile'
	| 'bales'
	| 'wayside'
	| 'signpost'
	| 'fountain'
	| 'fence'
	| 'flag'
	| 'linden'
	| 'chapel'
	| 'snowpole'
	| 'delineator'
	| 'house'
	| 'barn'
	| 'hut'
	| 'cow';
// `flag` indexes the style's flag colours: the world says where, the style says what.
export type Piece = {
	kind: PieceKind;
	x: number;
	y: number;
	z: number;
	rot: number;
	flag?: number;
};
export type SignLook = 'pass' | 'climb' | 'hairpin' | 'village';
export type Sign = {
	x: number;
	y: number;
	z: number;
	rot: number;
	lines: string[];
	look: SignLook;
	w: number;
	h: number;
};
export type Arch = { d: number; label: string };

type Ctx = Ground & { villages: { d: number; name: string }[] };

export const FLAGS = 4; // flagpoles at the summit, one colour each from the style

export function setPieces(route: Route, markers: Marker[], c: Ctx) {
	const { rand, field, nearest, heightAt, biomeAt } = c;
	const pieces: Piece[] = [];
	const signs: Sign[] = [];
	const arches: Arch[] = [];
	const names = namesFor(rand);
	const n = route.x.length;
	const frame = (i: number) => frameAt(route, i);
	const put = (
		kind: PieceKind,
		i: number,
		side: number,
		off: number,
		along = 0,
		need = 9.2,
		extra: Partial<Piece> = {},
	) => {
		const j = Math.min(n - 1, Math.max(0, i + Math.round(along / route.step)));
		const { lx, lz, heading } = frame(j);
		const x = route.x[j] + lx * off * side;
		const z = route.z[j] + lz * off * side;
		if (!clearOf(field, nearest, x, z, need) || biomeAt(x, z) === Biome.Water)
			return false;
		pieces.push({
			kind,
			x,
			y: heightAt(x, z),
			z,
			rot: heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2),
			...extra,
		});
		return true;
	};
	const sign = (
		i: number,
		off: number,
		look: SignLook,
		lines: string[],
		w: number,
		h: number,
	) => {
		const j = Math.min(n - 1, Math.max(0, i));
		const f = frame(j);
		const x = route.x[j] + f.lx * off;
		const z = route.z[j] + f.lz * off;
		signs.push({
			x,
			y: heightAt(x, z),
			z,
			rot: f.heading + Math.PI,
			lines,
			look,
			w,
			h,
		});
	};

	// Riding time at the reference rider — every schedule is in seconds of this.
	const t = new Float64Array(n);
	for (let i = 1; i < n; i++)
		t[i] =
			t[i - 1] +
			route.step /
				Math.max(
					1.5,
					steadySpeed(REFERENCE.watts, route.grade[i], REFERENCE.body),
				);
	const nearVillage = (i: number) =>
		c.villages.some((v) => Math.abs(v.d - i * route.step) < 600);

	// Big: the pass summit — sign, hut, flags, KOM arch, a bench on the view side.
	const summit = markers.find((m) => m.kind === 'summit');
	if (summit) {
		const i = Math.round(summit.d / route.step);
		const top = Math.round(route.ele[i]);
		put('hut', i, -1, 22, 18, 15);
		put('bench', i, 1, 10, 6);
		put('signpost', i, 1, 10.5, -8);
		for (let k = 0; k < FLAGS; k++)
			put('flag', i, -1, 11, -14 + k * 5, 10, { flag: k });
		sign(i - 3, 5.2, 'pass', [names.pass, `${top} m`], 2.6, 1.1);
		arches.push({ d: summit.d, label: 'KOM' });
	}

	// Climbs: a board at the foot, numbered hairpins counting down to the top,
	// snow poles on the downhill side once you are above 1,100 m.
	for (const cl of markers.filter((m) => m.kind === 'climb')) {
		const i0 = Math.round(cl.d / route.step);
		const [len, avg] = cl.label.split(' at ');
		sign(i0, -7, 'climb', [len, `${avg} avg`], 1.8, 1.0); // right verge
		const pins = markers.filter(
			(m) => m.kind === 'hairpin' && m.d > cl.d && m.d < (cl.to ?? cl.d),
		);
		pins.forEach((p, k) =>
			sign(
				Math.round(p.d / route.step),
				-6.5,
				'hairpin',
				[`${pins.length - k}`],
				0.7,
				0.7,
			),
		);
		const end = Math.round((cl.to ?? cl.d) / route.step);
		for (let i = i0; i < end; i += 3)
			if (route.ele[i] > 1100)
				put('snowpole', i, route.grade[i] > 0 ? -1 : 1, 4.4, 0, 0);
	}

	// Villages get a fountain and a chapel-and-linden landmark on the way in.
	for (const v of c.villages) {
		const i = Math.round(v.d / route.step);
		put('fountain', i, -1, 10.5, 12, 9.5);
		put('bench', i, 1, 10.5, -20);
		put('linden', i, 1, 26, 40, 14);
		sign(i - 20, -5.8, 'village', [v.name], 1.9, 0.55);
	}

	// Medium, every 3–5 minutes: a farmstead, a chapel under a linden, a fountain.
	let lastChapel = -Infinity;
	const side = () => (rand() < 0.5 ? -1 : 1);
	const MED: ((i: number) => boolean)[] = [
		(i) => {
			// farmstead: house + barn + woodpile + bales + a herd facing one way
			const s = side();
			const f = frame(i);
			const meadow =
				biomeAt(route.x[i] + f.lx * 60 * s, route.z[i] + f.lz * 60 * s) ===
				Biome.Meadow;
			if (!meadow || nearVillage(i)) return false;
			if (!put('house', i, s, 30, 0, 14)) return false;
			put('barn', i, s, 44, 22, 16);
			put('woodpile', i, s, 23, -8, 12);
			put('bales', i, s, 40, -30, 12);
			const herdDir = rand() * Math.PI * 2;
			const herd = 3 + Math.floor(rand() * 4);
			for (let k = 0; k < herd; k++)
				put('cow', i, s, 55 + rand() * 25, 30 + k * 4, 20, {
					rot: herdDir + (rand() - 0.5) * 1.4,
				});
			return true;
		},
		(i) => {
			const s = side();
			if (t[i] - lastChapel < 900) return false; // a chapel is a landmark only if it is rare: one per 15 min
			if (!put('chapel', i, s, 28, 0, 18)) return false;
			lastChapel = t[i];
			put('linden', i, s, 40, 10, 22);
			put('bench', i, s, 11, -4);
			return true;
		},
		(i) =>
			put('fountain', i, side(), 10.5, 0, 9.5) && put('signpost', i, 1, 10, 5),
	];
	// Small, every 20–40 s, from a shuffle bag with no repeat within four.
	const SMALL: {
		kind: PieceKind | 'meadow';
		ok: (x: number, z: number) => boolean;
	}[] = [
		{ kind: 'bench', ok: () => true },
		{
			kind: 'woodpile',
			ok: (x, z) =>
				biomeAt(x, z) === Biome.Forest || biomeAt(x, z) === Biome.Meadow,
		},
		{ kind: 'bales', ok: (x, z) => biomeAt(x, z) === Biome.Meadow },
		{ kind: 'wayside', ok: () => true },
		{ kind: 'signpost', ok: () => true },
		{ kind: 'fence', ok: (x, z) => biomeAt(x, z) === Biome.Meadow },
		{ kind: 'meadow', ok: () => true }, // an empty meadow is an event too
	];
	const recent: string[] = [];
	let nextSmall = 25;
	let nextMed = 200;
	for (let i = 30; i < n - 30; i++) {
		if (t[i] >= nextMed && !nearVillage(i)) {
			const tries = [MED[0], MED[0], MED[1], MED[2]].sort(() => rand() - 0.5); // farmsteads twice as likely
			if (tries.some((f) => f(i))) nextMed = t[i] + 180 + rand() * 120;
			else nextMed = t[i] + 20;
		}
		if (t[i] >= nextSmall) {
			nextSmall = t[i] + 20 + rand() * 20;
			if (nearVillage(i)) continue;
			const s = side();
			const { lx, lz } = frame(i);
			const off = 9.5 + rand() * 7;
			const x = route.x[i] + lx * off * s;
			const z = route.z[i] + lz * off * s;
			const bag = SMALL.filter((k) => !recent.includes(k.kind) && k.ok(x, z));
			if (!bag.length) continue;
			const kit = bag[Math.floor(rand() * bag.length)];
			recent.push(kit.kind);
			if (recent.length > 4) recent.shift();
			if (kit.kind !== 'meadow') put(kit.kind, i, s, off);
		}
	}

	// Swiss delineators: 50 m apart on straights, closer in bends (R/5, ≥ 10 m),
	// 0.5 m outside the edge line on both sides.
	for (let d = 0; d < route.length;) {
		const i = Math.round(d / route.step);
		const a = frame(i - 2);
		const b = frame(i + 2);
		let dh = Math.abs(b.heading - a.heading);
		if (dh > Math.PI) dh = Math.PI * 2 - dh;
		const R = dh > 1e-3 ? (4 * route.step) / dh : 1e9;
		const { lx, lz, heading } = frame(i);
		for (const s of [-1, 1]) {
			const x = route.x[i] + lx * 3.7 * s;
			const z = route.z[i] + lz * 3.7 * s;
			pieces.push({ kind: 'delineator', x, y: route.ele[i], z, rot: heading });
		}
		d += Math.min(50, Math.max(10, R / 5));
	}

	return { pieces, signs, arches, names };
}
