/**
 * The room's furniture: walls, the sign that moves to the music, the clock,
 * the desk and lamp, the record player and its speaker, and the dark that
 * falls when the lamp is off.
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import { disc, dot, line, rect, ring, type Ctx } from '$lib/lounge/pixel';
import { pulseOf, type SceneInput } from '$lib/lounge/scene';
import { hash3 } from '$lib/lounge/hash';

/** The sign's five bars trace the equalizer W (ADR-0005). */
const SIGN_BARS = [26, 12, 20, 12, 26];

export function drawRoom(g: Ctx, s: SceneInput) {
	rect(g, 0, 0, 320, 160, C.wall);
	rect(g, 0, 128, 320, 32, C.wainscot);
	rect(g, 0, 127, 320, 1, C.trim);
	rect(g, 0, 160, 320, 20, C.floor);
	for (let y = 163; y < 180; y += 5) rect(g, 0, y, 320, 1, C.plank);
	for (let y = 160, k = 0; y < 180; y += 5, k++)
		for (let x = (k % 2) * 20; x < 320; x += 40) rect(g, x, y, 1, 5, C.plank);
	sign(g, s);
	clock(g, s);
	poster(g);
	plant(g, s);
	desk(g, s);
	deck(g, s);
}

function sign(g: Ctx, s: SceneInput) {
	rect(g, 20, 24, 74, 36, C.poster);
	rect(g, 20, 24, 74, 1, C.trim);
	rect(g, 20, 59, 74, 1, C.trim);
	SIGN_BARS.forEach((tall, i) => {
		const level = pulseOf({ ...s, beat: s.beat + i * 0.13, t: s.t + i });
		const h = Math.max(3, Math.round(tall * (0.55 + 0.45 * level)));
		rect(g, 30 + i * 12, 55 - h, 8, h, C.teal);
		rect(g, 30 + i * 12, 55 - h, 8, 1, C.tealLight);
	});
}

function clock(g: Ctx, s: SceneInput) {
	const hour = (((s.hours % 12) + s.minutes / 60) / 12) * Math.PI * 2;
	const minute = (s.minutes / 60) * Math.PI * 2;
	disc(g, 106, 40, 7, C.paper);
	ring(g, 106, 40, 7, C.trim);
	line(
		g,
		106,
		40,
		106 + Math.sin(hour) * 3.5,
		40 - Math.cos(hour) * 3.5,
		C.ink,
	);
	line(
		g,
		106,
		40,
		106 + Math.sin(minute) * 5.5,
		40 - Math.cos(minute) * 5.5,
		C.frame,
	);
}

/** A climb with a flag on it: the wall's one picture until medals hang there. */
function poster(g: Ctx) {
	rect(g, 272, 36, 30, 34, C.trim);
	rect(g, 274, 38, 26, 30, C.shelf);
	for (let x = 0; x < 26; x++) {
		const h = Math.round(Math.max(0, 16 - Math.abs(x - 14) * 1.3));
		rect(g, 274 + x, 64 - h, 1, h + 4, C.book);
	}
	rect(g, 287, 46, 1, 6, C.lilac);
	rect(g, 288, 46, 4, 3, C.amber);
}

function plant(g: Ctx, s: SceneInput) {
	const sway = s.still ? 0 : Math.round(Math.sin(s.t * 1.1));
	const leaves: [number, number][] = [
		[-0.4, 13],
		[0.1, 16],
		[0.7, 14],
		[1.3, 15],
		[1.9, 12],
		[2.5, 13],
	];
	leaves.forEach(([angle, length], i) =>
		line(
			g,
			12,
			148,
			12 + Math.cos(angle + Math.PI * 0.18) * length * 0.7 + sway,
			148 - Math.abs(Math.sin(angle + 0.6)) * length,
			i % 2 ? C.leaf : C.leafLight,
		),
	);
	rect(g, 6, 148, 12, 12, C.woodLight);
	rect(g, 5, 148, 14, 2, C.wood);
}

function desk(g: Ctx, s: SceneInput) {
	rect(g, 18, 118, 100, 3, C.woodLight);
	rect(g, 18, 121, 100, 2, C.wood);
	rect(g, 20, 123, 3, 32, C.wood);
	rect(g, 113, 123, 3, 32, C.wood);
	// The laptop's code scrolls a line every half second.
	rect(g, 40, 98, 30, 18, C.laptop);
	rect(g, 42, 100, 26, 14, C.screen);
	const scroll = s.still ? 0 : Math.floor(s.t * 2);
	for (let i = 0; i < 6; i++) {
		const n = i + scroll;
		const indent = Math.floor(hash3(n, 1, 2) * 3) * 2;
		const length = 6 + Math.floor(hash3(n, 3, 4) * 16);
		const hue = [C.violet, C.teal, C.lilac][Math.floor(hash3(n, 5, 6) * 3)];
		rect(g, 43 + indent, 101 + i * 2, Math.min(length, 24 - indent), 1, hue);
	}
	rect(g, 38, 116, 34, 2, C.rug);
	// The mug, and its steam.
	rect(g, 82, 111, 6, 7, C.lilac);
	rect(g, 88, 113, 2, 1, C.lilac);
	rect(g, 89, 113, 1, 3, C.lilac);
	rect(g, 88, 115, 2, 1, C.lilac);
	g.globalAlpha = 0.6;
	for (let i = 0; i < 3; i++)
		dot(g, 84 + Math.round(Math.sin(s.t * 2 + i * 1.7)), 108 - i * 2, C.lilac);
	g.globalAlpha = 1;
	// The lamp.
	rect(g, 100, 115, 10, 3, C.trim);
	rect(g, 104, 100, 2, 15, C.trim);
	rect(g, 98, 96, 12, 5, C.woodLight);
	if (!s.lampOn) return;
	rect(g, 100, 101, 8, 1, C.amber);
	g.globalAlpha = 0.13;
	g.fillStyle = C.amber;
	g.beginPath();
	g.moveTo(99, 101);
	g.lineTo(109, 101);
	g.lineTo(126, 118);
	g.lineTo(82, 118);
	g.closePath();
	g.fill();
	g.globalAlpha = 1;
}

/** The record player is the deck: it turns while something plays. */
function deck(g: Ctx, s: SceneInput) {
	rect(g, 262, 118, 52, 3, C.woodLight);
	rect(g, 266, 121, 2, 5, C.wood);
	rect(g, 308, 121, 2, 5, C.wood);
	rect(g, 266, 110, 40, 8, C.trim);
	rect(g, 266, 109, 40, 1, C.sillTop);
	rect(g, 276, 106, 12, 1, C.ink);
	rect(g, 273, 107, 18, 2, C.ink);
	rect(g, 276, 109, 12, 1, C.ink);
	rect(g, 282, 107, 2, 1, C.amber);
	if (s.playing && !s.still) {
		const a = s.t * 3.5;
		dot(
			g,
			282 + Math.round(Math.cos(a) * 7),
			107 + Math.round(Math.sin(a)),
			C.cable,
		);
	}
	rect(g, 298, 103, 1, 6, C.lilac);
	rect(g, 292, 103, 6, 1, C.lilac);
	dot(g, 302, 113, s.playing ? C.teal : C.wood);
	// The speaker's cone moves on the kick.
	rect(g, 290, 134, 20, 26, C.door);
	rect(g, 290, 134, 20, 1, C.trim);
	const pump =
		s.playing && s.pulsing && !s.still ? Math.round(pulseOf(s) * 1.4) : 0;
	disc(g, 300, 150, 5 + pump, C.ink);
	ring(g, 300, 150, 5 + pump, C.woodLight);
	disc(g, 300, 139, 2, C.ink);
}

/** With the lamp off, the room darkens and the window stays as bright. */
export function drawShade(g: Ctx, s: SceneInput) {
	const dim = s.lampOn
		? s.sky === 'night'
			? 0.12
			: 0
		: s.sky === 'night'
			? 0.42
			: s.sky === 'dusk'
				? 0.25
				: 0.1;
	if (!dim) return;
	g.globalAlpha = dim;
	g.fillStyle = C.shade;
	g.beginPath();
	g.rect(0, 0, 320, 180);
	g.rect(122, 22, 136, 86);
	g.fill('evenodd');
	g.globalAlpha = 1;
}
