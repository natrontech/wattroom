/**
 * A cyclist, built once and seen from anywhere. A real bike and a rider on it
 * in art pixels: hips over the saddle, back leaning to the bars, knees that
 * bend to pedals turning a circle. A view is that model turned and looked at
 * from a little above, rasterised one whole pixel at a time, so every view
 * and every frame of the stroke agree. The room's trainers and the road draw
 * the same one. Facing left as drawn; the world mirrors it for the other way.
 */
import { LOUNGE as C, shadeOf } from '$lib/lounge/palette';
import { outlined, rect, type Ctx, type Part } from '$lib/lounge/pixel';
import {
	PET_ROWS,
	beard,
	hair,
	specs,
	stripeOn,
} from '$lib/lounge/draw-people';
import type { Figure } from '$lib/lounge/scene';

/** How the camera sees the rider, from behind round to the front. */
export const VIEWS = ['back', 'quarter', 'side', 'nose', 'front'] as const;
export type View = (typeof VIEWS)[number];
/** Each view's turn away from straight behind, in degrees. */
const YAW: Record<View, number> = {
	back: 0,
	quarter: 42,
	side: 90,
	nose: 138,
	front: 180,
};

/** A pedal stroke's frames. */
export const PEDAL_FRAMES = 8;

/**
 * The right crank's angle at a point of the stroke, from the front. The bike
 * faces +x with y up, so pedalling forward turns it the negative way: the
 * front foot goes down.
 */
export const crankAngle = (stroke: number): number =>
	-(stroke / PEDAL_FRAMES) * Math.PI * 2;
/** One cell of a rider's sheet, and where its ground sits. */
export const CELL_W = 60;
export const CELL_H = 60;
export const GROUND = 55;

// The bike, x forward and y up from the ground, z to the rider's right. A
// small bike on round wheels under a chibi rider, built like the room's
// people: a low saddle, so the legs are short and thick, and high bars.
const WHEEL = 7.5;
const REAR = [-12.5, WHEEL, 0];
const FRONT = [12.5, WHEEL, 0];
const BB = [-1, 6.5, 0];
const SEAT = [-5, 16, 0];
const HEAD_TOP = [9, 16, 0];
const HEAD_LOW = [10, 11, 0];
const BARS = [12, 18.5, 0];
const CRANK = 3.5;
const PEDAL_Z = 3.5;
// The rider: sat up, arms bent to the bars, and legs just longer than hip to
// ankle at the bottom of the stroke, so the knee is never locked.
const HIP = [-5, 18, 0];
const SHOULDER = [2.5, 27, 0];
const NECK = [4, 29.5, 0];
const HEAD = [6, 33.5, 0];
const THIGH = 7.5;
const SHIN = 7;
/** Standing on the pedals: the hips up and over the cranks, leaning to the bars. */
const STANDING = new Map<P, P>([
	[HIP, [0, 18.5, 0]],
	[SHOULDER, [6.5, 27, 0]],
	[NECK, [8, 29.5, 0]],
	[HEAD, [10, 33, 0]],
]);
/** The bike and the body against the head: smaller, so the rider reads as a chibi. */
const SMALL = 0.8;
/** Looked at from this far above the road, in degrees. */
const ABOVE = (14 * Math.PI) / 180;

type P = readonly number[];
type Tone = 'bike' | 'pants' | 'shirt' | 'arm' | 'skin' | 'shoe' | 'scarf';
type Pixel = { c: string; order: number; group: number; tone: Tone | null };
/** What a body is made of: where one of its parts covers another, a line of ink parts them. */
const BODY = new Set<Tone | null>(['pants', 'shirt', 'arm', 'shoe']);
type Paint = (t: number, shaded: boolean, x: number, y: number) => string;

/** What is drawn so far: a pixel at a time, nearest last. */
class Picture {
	pixels = new Map<number, Pixel>();
	order = 0;
	/** Which part of the picture is being drawn: a leg, an arm, the torso. */
	group = 0;
	private key = (x: number, y: number) => (y + 256) * 1024 + x + 256;
	put(x: number, y: number, c: string, tone: Tone | null) {
		this.pixels.set(this.key(x, y), {
			c,
			order: this.order,
			group: this.group,
			tone,
		});
	}
	/** Ink where a shape meets nothing, or something further off that is not itself. */
	inked(): [number, number, string][] {
		const edges = new Map<number, string>();
		for (const [k, p] of this.pixels) {
			if (!p.tone) continue;
			for (const d of [1, -1, 1024, -1024]) {
				const n = this.pixels.get(k + d);
				if (!n) edges.set(k + d, C.ink);
				// A leg in front of the other, or an arm across the chest.
				else if (
					BODY.has(p.tone) &&
					BODY.has(n.tone) &&
					n.group !== p.group &&
					n.order < p.order
				)
					edges.set(k + d, C.ink);
			}
		}
		const out: [number, number, string][] = [];
		for (const [k, p] of this.pixels)
			if (!edges.has(k)) out.push([(k % 1024) - 256, (k >> 10) - 256, p.c]);
		for (const [k, c] of edges)
			out.push([(k % 1024) - 256, (k >> 10) - 256, c]);
		return out;
	}
}

/** A tube from a to b that goes from w0 to w1 wide, round at both ends. */
function tube(
	pic: Picture,
	a: P,
	b: P,
	w0: number,
	w1: number,
	paint: Paint,
	tone: Tone | null,
) {
	pic.order++;
	const pad = Math.ceil(Math.max(w0, w1) / 2) + 1;
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const len2 = dx * dx + dy * dy || 1;
	const x0 = Math.floor(Math.min(a[0], b[0])) - pad;
	const x1 = Math.ceil(Math.max(a[0], b[0])) + pad;
	const y0 = Math.floor(Math.min(a[1], b[1])) - pad;
	const y1 = Math.ceil(Math.max(a[1], b[1])) + pad;
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			const px = x + 0.5;
			const py = y + 0.5;
			const t = Math.max(
				0,
				Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2),
			);
			const ox = px - (a[0] + dx * t);
			const oy = py - (a[1] + dy * t);
			const r = (w0 + (w1 - w0) * t) / 2;
			const d = Math.hypot(ox, oy);
			if (d > r) continue;
			// Lit from the top left, as everything in the room is.
			const shaded = d > r * 0.35 && (ox * -0.6 + oy * -0.8) / (d || 1) < -0.35;
			pic.put(x, y, paint(t, shaded, x, y), tone);
		}
}

/** The outline around a set of points on the page: a solid box seen from anywhere. */
function hull(points: P[]): P[] {
	const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const cross = (o: P, a: P, b: P) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const half = (list: P[]) => {
		const out: P[] = [];
		for (const p of list) {
			while (
				out.length > 1 &&
				cross(out[out.length - 2], out[out.length - 1], p) <= 0
			)
				out.pop();
			out.push(p);
		}
		return out.slice(0, -1);
	};
	return [...half(sorted), ...half([...sorted].reverse())];
}

/** A filled outline, `t` running from `from` to `to` for what it is painted with. */
function solid(
	pic: Picture,
	outline: P[],
	from: P,
	to: P,
	paint: Paint,
	tone: Tone,
) {
	pic.order++;
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const len2 = dx * dx + dy * dy || 1;
	const xs = outline.map((p) => p[0]);
	const ys = outline.map((p) => p[1]);
	const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
	const wide = (Math.max(...xs) - Math.min(...xs)) / 2;
	for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y++)
		for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) {
			const px = x + 0.5;
			const py = y + 0.5;
			const inside = outline.every((a, i) => {
				const b = outline[(i + 1) % outline.length];
				return (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]) >= 0;
			});
			if (!inside) continue;
			const t = Math.max(
				0,
				Math.min(1, ((px - from[0]) * dx + (py - from[1]) * dy) / len2),
			);
			pic.put(x, y, paint(t, px > middle + wide * 0.55, x, y), tone);
		}
}

/**
 * A colour that shows against a dark road or floor: the legs are what say
 * someone is pedalling, so dark trousers are lifted toward the room's lilac.
 */
export function legible(hex: string): string {
	const n = parseInt(hex.slice(1), 16);
	const rgb = [n >> 16, (n >> 8) & 255, n & 255];
	if (0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2] >= 70) return hex;
	const to = parseInt(C.lilac.slice(1), 16);
	const lit = [to >> 16, (to >> 8) & 255, to & 255];
	const mixed = rgb.map((c, i) => Math.round(c + (lit[i] - c) * 0.42));
	return `#${((mixed[0] << 16) | (mixed[1] << 8) | mixed[2]).toString(16).padStart(6, '0')}`;
}

const flat =
	(c: string, shade = c): Paint =>
	(_t, shaded) =>
		shaded ? shade : c;

/** The knee of a leg from hip to foot: bent forward, along the bike's own x. */
function kneeOf(hip: P, foot: P): number[] {
	const dx = foot[0] - hip[0];
	const dy = foot[1] - hip[1];
	const d = Math.min(THIGH + SHIN - 0.01, Math.hypot(dx, dy));
	const bend = Math.acos(
		Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)),
	);
	const toward = Math.atan2(dy, dx);
	return [
		hip[0] + Math.cos(toward + bend) * THIGH,
		hip[1] + Math.sin(toward + bend) * THIGH,
		foot[2],
	];
}

/** Hair and a cap in profile, facing left: the back of the head is the right. */
function profileHair(f: Figure, hx: number, ht: number): Part[] {
	const h = f.hair;
	const short: Part[] = [
		[hx, ht, 10, 3, h],
		[hx + 6, ht + 3, 4, 3, h],
	];
	const style = f.hairStyle;
	const shaped: Part[] =
		style === 7
			? []
			: style === 4
				? [[hx + 1, ht - 3, 8, 3, h]]
				: style === 3
					? [
							[hx - 1, ht - 1, 12, 4, f.shirtShade],
							[hx + 7, ht + 3, 3, 2, h],
						]
					: style === 5
						? [
								[hx - 1, ht - 2, 13, 5, h],
								[hx + 7, ht + 3, 4, 4, h],
							]
						: style === 8
							? [
									[hx - 2, ht - 4, 15, 7, h],
									[hx + 6, ht + 3, 6, 4, h],
								]
							: [
									...short,
									...(style === 1 || style === 9
										? ([[hx + 6, ht + 6, 5, 7, h]] as Part[])
										: []),
									...(style === 2
										? ([[hx + 7, ht - 3, 4, 3, h]] as Part[])
										: []),
									...(style === 6
										? ([
												[hx + 10, ht + 3, 3, 2, h],
												[hx + 12, ht + 4, 2, 5, h],
											] as Part[])
										: []),
									...(style === 11
										? ([
												[hx + 3, ht - 4, 4, 2, h],
												[hx + 4, ht - 2, 2, 2, h],
											] as Part[])
										: []),
								];
	return f.cap
		? [
				...shaped.filter(() => style !== 8 && style !== 2),
				[hx - 1, ht - 1, 11, 3, f.cap],
				[hx - 3, ht + 2, 5, 1, shadeOf(f.cap)],
			]
		: shaped;
}

/** Their head, by how far round it has turned from the back. */
function head(
	g: Ctx,
	f: Figure,
	view: View,
	cx: number,
	cy: number,
	talking: boolean,
) {
	const hx = Math.round(cx - 5);
	const ht = Math.round(cy - 4.5);
	if (view === 'side') {
		outlined(
			g,
			[
				[hx + 1, ht, 8, 9, f.skin],
				[hx, ht + 1, 10, 7, f.skin],
				[hx - 1, ht + 5, 1, 2, f.skin],
				...profileHair(f, hx, ht),
			],
			C.ink,
		);
		rect(g, hx + 1, ht + 8, 7, 1, f.skinShade);
		rect(g, hx + 2, ht + 4, 1, 2, C.ink);
		rect(g, hx + 1, ht + 7, 3, talking ? 2 : 1, talking ? C.ink : f.skinShade);
		if (f.beard === 3) rect(g, hx, ht + 6, 6, 3, f.hair);
		else if (f.beard === 2) rect(g, hx, ht + 6, 4, 1, f.hair);
		else if (f.beard === 1)
			for (let i = 0; i < 6; i += 2) rect(g, hx + i, ht + 8, 1, 1, f.skinShade);
		if (f.glasses === 1) {
			rect(g, hx, ht + 3, 4, 1, C.ink);
			rect(g, hx + 4, ht + 4, 4, 1, C.ink);
		} else if (f.glasses === 2) rect(g, hx, ht + 4, 4, 2, C.ink);
		return;
	}
	if (view === 'back' || view === 'quarter') {
		const fill: Part[] =
			f.hairStyle === 7
				? []
				: f.hairStyle === 4
					? [[hx + 4, ht + 2, 2, 7, f.hair]]
					: [[hx, ht, 10, 7, f.hair]];
		const tail: Part[] =
			f.hairStyle === 6 ? [[hx + 4, ht + 6, 2, 8, f.hair]] : [];
		outlined(
			g,
			[
				[hx + 1, ht, 8, 9, f.skin],
				[hx, ht + 1, 10, 7, f.skin],
				...fill,
				...tail,
				...hair(f, hx, ht),
			],
			C.ink,
		);
		// The cheek and an ear: the side of the head that turns to the camera.
		if (view === 'quarter' && f.hairStyle !== 7)
			rect(g, hx, ht + 4, 3, 4, f.skin);
		return;
	}
	outlined(
		g,
		[
			[hx + 1, ht, 8, 9, f.skin],
			[hx, ht + 1, 10, 7, f.skin],
			...hair(f, hx, ht),
		],
		C.ink,
	);
	rect(g, hx + 1, ht + 8, 8, 1, f.skinShade);
	const eyes = view === 'nose' ? [1, 5] : [2, 7];
	for (const e of eyes) rect(g, hx + e, ht + 5, 1, 2, C.ink);
	const mouth = view === 'nose' ? 2 : 4;
	rect(
		g,
		hx + mouth,
		ht + 7,
		2,
		talking ? 2 : 1,
		talking ? C.ink : f.skinShade,
	);
	beard(g, f, hx, ht, talking);
	if (view === 'front') specs(g, f, hx, ht + 5);
}

/** Their pet where a bike has room for one: a parrot on the shoulder, a hamster on the head. */
function pet(g: Ctx, f: Figure, shoulder: P, top: P) {
	const colour = f.pet === 2 ? C.teal : C.amber;
	const at = f.pet === 2 ? shoulder : f.pet === 3 ? top : null;
	if (!at) return;
	for (const [i, row] of PET_ROWS[f.pet ?? 0].entries())
		for (const [j, c] of [...row].entries())
			if (c !== '.')
				rect(
					g,
					Math.round(at[0]) + j,
					Math.round(at[1]) + i,
					1,
					1,
					c === 'k' ? C.ink : colour,
				);
}

/**
 * The bike, and whoever is on it, seen from `view` with its ground at
 * (ox, oy). `stroke` is how far round the pedals are, in frames; a towel hangs
 * over the bars of a bike nobody rides.
 */
export function drawCyclist(
	g: Ctx,
	f: Figure | null,
	view: View,
	stroke: number,
	ox: number,
	oy: number,
	opts: { shadow?: boolean; talking?: boolean; standing?: boolean } = {},
) {
	const yaw = (YAW[view] * Math.PI) / 180;
	const sin = Math.sin(yaw);
	const cos = Math.cos(yaw);
	const across = Math.abs(cos);
	const angle = crankAngle(stroke);
	// Out of the saddle the bike rocks under you, away from the foot going down.
	const rock = opts.standing ? Math.sin(angle) * 0.13 : 0;
	/** Where a joint stands in this pose, before the bike rocks. */
	const pose = (p: P): P => (opts.standing ? (STANDING.get(p) ?? p) : p);
	const stood = (p: P): P => {
		if (!opts.standing) return p;
		const moved = pose(p);
		return [
			moved[0],
			moved[1] * Math.cos(rock) - moved[2] * Math.sin(rock),
			moved[2] * Math.cos(rock) + moved[1] * Math.sin(rock),
		];
	};
	/** On the page, and how far from the camera: the last number. */
	const at = (raw: P): number[] => {
		const full = stood(raw);
		const p = [full[0] * SMALL, full[1] * SMALL, full[2] * SMALL];
		const depth = p[0] * cos + p[2] * sin;
		return [
			ox - p[0] * sin + p[2] * cos,
			oy - p[1] * Math.cos(ABOVE) - depth * Math.sin(ABOVE),
			depth,
		];
	};
	const pic = new Picture();

	const wheel = (hub: P) => {
		pic.order++;
		const sample = (r: number, z: number, c: string, i: number, n: number) => {
			const t = (i / n) * Math.PI * 2;
			const [x, y] = at([
				hub[0] + Math.cos(t) * r,
				hub[1] + Math.sin(t) * r,
				z,
			]);
			pic.put(Math.floor(x), Math.floor(y), c, null);
		};
		for (let i = 0; i < 90; i++) sample(WHEEL - 1.6, 0, C.lilac, i, 90);
		for (let i = 0; i < 120; i++)
			for (const z of [-1, 0, 1]) sample(WHEEL - 0.3, z, C.ink, i, 120);
		// One bright spot on the rim says the wheel turns.
		sample(
			WHEEL - 1.6,
			0,
			C.paper,
			(Math.round(angle * 2 * (90 / (Math.PI * 2))) % 90) + 90,
			90,
		);
		const [hx, hy] = at(hub);
		for (const [x, y] of [
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
		])
			pic.put(Math.floor(hx) + x - 1, Math.floor(hy) + y - 1, C.lilac, null);
	};
	const bikeTube = (a: P, b: P, w = 2) =>
		tube(pic, at(a), at(b), w * 0.75, w * 0.75, flat(C.violet), 'bike');
	const stays = () => {
		bikeTube(REAR, BB);
		bikeTube(REAR, SEAT);
		bikeTube(SEAT, BB);
		tube(pic, at([-8, 17, 0]), at([-2.5, 17, 0]), 2, 2, flat(C.cable), 'bike');
	};
	const tubes = () => {
		bikeTube(BB, HEAD_LOW);
		bikeTube(SEAT, HEAD_TOP);
	};
	const front = () => {
		bikeTube(HEAD_TOP, HEAD_LOW, 3);
		bikeTube(HEAD_LOW, FRONT);
		tube(pic, at(HEAD_TOP), at(BARS), 2, 2, flat(C.cable), 'bike');
		tube(
			pic,
			at([BARS[0], BARS[1], -9]),
			at([BARS[0], BARS[1], 9]),
			2,
			2,
			flat(C.cable),
			'bike',
		);
	};
	/** One side's crank and pedal; f.left is -1, the right +1, half a turn apart. */
	const footOf = (side: number): P => {
		const a = angle + (side > 0 ? 0 : Math.PI);
		return [
			BB[0] + Math.cos(a) * CRANK,
			BB[1] + Math.sin(a) * CRANK,
			side * PEDAL_Z,
		];
	};
	const crank = (side: number) => {
		const foot = footOf(side);
		tube(
			pic,
			at([BB[0], BB[1], side * 2]),
			at([foot[0], foot[1], side * 2]),
			1,
			1,
			flat(C.lilac),
			'bike',
		);
	};
	const leg = (rider: Figure, side: number, near: boolean) => {
		const foot = footOf(side);
		const h = pose(HIP);
		const hip = [h[0], h[1], side * 3];
		const ankle = [foot[0] - 0.5, foot[1] + 1.5, foot[2]];
		const knee = kneeOf(hip, ankle);
		knee[2] = side * (3.5 + across);
		const pants = near ? legible(rider.pants) : rider.pantsShade;
		// Flat, so the near leg reads as one shape against the far one.
		const shade = pants;
		tube(pic, at(hip), at(knee), 4, 3.6, flat(pants, shade), 'pants');
		tube(
			pic,
			at(knee),
			at(ankle),
			3.4,
			3,
			rider.socks
				? (t, s) => (t > 0.55 ? rider.socks! : s ? shade : pants)
				: flat(pants, shade),
			'pants',
		);
		tube(
			pic,
			at([foot[0] - 2, foot[1] + 0.8, foot[2]]),
			at([foot[0] + 2.5, foot[1] + 0.5, foot[2]]),
			3.2,
			3.2,
			flat(rider.shoes),
			'shoe',
		);
	};
	const arm = (rider: Figure, side: number) => {
		const sh = pose(SHOULDER);
		const shoulder = [sh[0], sh[1] - 1, side * 6.5];
		const hand = [BARS[0], BARS[1] + 1, side * 8];
		const elbow = [(sh[0] + BARS[0]) / 2 + 0.5, BARS[1] + 3, side * 8.5];
		// A tee's sleeves end at the elbow, and a vest has none.
		const bare = rider.top === 0 || rider.top === 4;
		tube(
			pic,
			at(shoulder),
			at(elbow),
			3.5,
			3,
			rider.top === 4
				? flat(rider.skin, rider.skinShade)
				: flat(rider.shirt, rider.shirtShade),
			'arm',
		);
		tube(
			pic,
			at(elbow),
			at(hand),
			3,
			2.5,
			bare
				? flat(rider.skin, rider.skinShade)
				: (t, s) =>
						t > 0.75 ? rider.skin : s ? rider.shirtShade : rider.shirt,
			'arm',
		);
	};
	const torso = (rider: Figure) => {
		const stripe = rider.stripes ? stripeOn(rider.shirt) : null;
		// The box of the back: narrow at the hips, broad at the shoulders, as
		// deep as a chest, across the line of the spine.
		const hip = pose(HIP);
		const top = pose(SHOULDER);
		const spine = Math.hypot(top[0] - hip[0], top[1] - hip[1]);
		const nx = -(top[1] - hip[1]) / spine;
		const ny = (top[0] - hip[0]) / spine;
		const box: P[] = [];
		for (const [p, half] of [
			[hip, 5.5],
			[top, 7.5],
		] as const)
			for (const z of [-half, half])
				for (const up of [-3.5, 3.5])
					box.push(at([p[0] + nx * up, p[1] + ny * up, z]));
		tube(
			pic,
			at(SHOULDER),
			at(NECK),
			rider.scarf ? 6 : 3.5,
			rider.scarf ? 6 : 3.5,
			flat(rider.scarf ?? rider.skin),
			rider.scarf ? 'scarf' : 'skin',
		);
		solid(
			pic,
			hull(box),
			at(HIP),
			at(SHOULDER),
			(t, shaded) => {
				if (t < 0.2) return shaded ? rider.pantsShade : legible(rider.pants);
				if (stripe && Math.floor(t * 9) % 3 === 1) return stripe;
				if (rider.top === 5 && t > 0.45 && t < 0.55) return C.paper;
				if (rider.top === 2 && t < 0.36 && view === 'back')
					return rider.shirtShade;
				return shaded ? rider.shirtShade : rider.shirt;
			},
			'shirt',
		);
	};

	// Far things first. Each part stands where it really is along the bike,
	// so whichever way the rider faces, what is nearer covers what is not.
	const depthAt = (x: number, z = 0) => at([x, 0, z])[2];
	const parts: { depth: number; draw: () => void }[] = [
		{ depth: depthAt(-14), draw: () => wheel(REAR) },
		{ depth: depthAt(14), draw: () => wheel(FRONT) },
		{ depth: depthAt(-6), draw: stays },
		{ depth: depthAt(3), draw: tubes },
		{ depth: depthAt(13), draw: front },
	];
	for (const side of [-1, 1]) {
		const depth = depthAt(-2, side * 5);
		parts.push({ depth: depth + 0.1, draw: () => crank(side) });
		if (f)
			parts.push({
				depth,
				draw: () => leg(f, side, depth <= depthAt(-2, -side * 5)),
			});
	}
	if (f) {
		parts.push({ depth: depthAt(0), draw: () => torso(f) });
		for (const side of [-1, 1])
			parts.push({
				depth: depthAt(11, side * 7),
				draw: () => arm(f, side),
			});
	}
	for (const p of parts.sort((a, b) => b.depth - a.depth)) {
		pic.group++;
		p.draw();
	}

	if (opts.shadow) {
		const long = 17 * Math.abs(sin) + 5;
		for (let y = -1; y <= 1; y++)
			for (let x = -long; x <= long; x++)
				if ((Math.round(ox + x) + oy + y) % 2 === 0)
					rect(g, ox + x, oy + 1 + y, 1, 1, C.ink);
	}
	for (const [x, y, c] of pic.inked()) rect(g, x, y, 1, 1, c);
	if (!f) {
		const [bx, by] = at(BARS);
		outlined(g, [[bx - 1, by + 1, 3, 6, C.towel]], C.ink);
		return;
	}
	// Seen along the back the head sits down between the shoulders.
	const top = pose(HEAD);
	const [cx, cy] = at([top[0], top[1] - across * 2.5, 0]);
	head(g, f, view, cx, cy, !!opts.talking);
	const [sx, sy] = at([pose(SHOULDER)[0], pose(SHOULDER)[1] + 3, 7]);
	pet(g, f, [sx - 1, sy - 4], [cx - 2, cy - 9]);
}

/** One cell of a rider's sheet, with its top left at the origin: seated, or out of the saddle. */
export function drawRider(
	g: Ctx,
	f: Figure,
	view: View,
	frame: number,
	standing = false,
) {
	drawCyclist(g, f, view, frame, CELL_W / 2, GROUND, {
		shadow: true,
		standing,
	});
}

/** Someone by the road, watching you ride by: facing the road, waving now and then. */
export function drawWatcher(g: Ctx, f: Figure, frame: number) {
	const x = CELL_W / 2;
	const y = GROUND;
	const up = frame % 4 < 2;
	const sway = frame % 2;
	const shadow: Part[] = [];
	for (let i = -6; i <= 6; i += 2) shadow.push([x + i, y, 1, 1, C.ink]);
	for (const [px, py, w, h, c] of shadow) rect(g, px, py, w, h, c);
	outlined(
		g,
		[
			[x - 4, y - 9, 3, 9, f.pantsShade],
			[x + 1, y - 9, 3, 9, f.pants],
			[x - 5, y - 1, 4, 2, f.shoes],
			[x + 1, y - 1, 4, 2, f.shoes],
			[x - 6, y - 19, 12, 10, f.shirt],
			// A wave goes up and out to an open hand, swaying: an arm straight
			// up with a skin tip read as a finger.
			...((up
				? [
						[x - 8, y - 22, 2, 4, f.shirt],
						[x - 9 - sway, y - 25, 2, 4, f.shirt],
						[x - 10 - sway, y - 28, 3, 3, f.skin],
					]
				: [
						[x - 8, y - 18, 2, 8, f.shirt],
						[x - 8, y - 10, 2, 2, f.skin],
					]) as Part[]),
			[x + 6, y - 18, 2, 8, f.shirt],
			[x + 6, y - 10, 2, 2, f.skin],
		],
		C.ink,
	);
	rect(g, x + 4, y - 19, 2, 10, f.shirtShade);
	if (f.stripes)
		for (const row of [y - 17, y - 14])
			rect(g, x - 6, row, 12, 1, stripeOn(f.shirt));
	head(g, f, 'front', x, y - 24, false);
}
