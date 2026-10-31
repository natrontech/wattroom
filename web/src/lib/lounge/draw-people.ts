/**
 * Who is in the voice channel: on the sofa, or on the bike when they ride.
 * An away rider's seat holds what they went for. The watts above the bike are
 * the picture's one live number, in the theme's watt hue (ADR-0005).
 */
import { LOUNGE as C } from '$lib/lounge/palette';
import {
	dot,
	line,
	rect,
	ring,
	sprite,
	text,
	textWidth,
	type Ctx,
} from '$lib/lounge/pixel';
import {
	SEATS,
	SEAT_STEP,
	SEAT_X0,
	type Rider,
	type SceneInput,
} from '$lib/lounge/scene';

const NOTE = ['011', '010', '110'];
const HEART = ['01010', '11111', '01110', '00100'];
/** What an away seat holds, by $lib/away's reasons; '' is plain away, a mug. */
const LEFT_BEHIND: Record<string, { rows: string[]; colour: string }> = {
	'': { rows: ['1111', '1111', '1111', '0110'], colour: C.lilac },
	food: { rows: ['111111', '011110'], colour: C.amber },
	nature: { rows: ['111', '111', '111', '111'], colour: C.paper },
	shower: { rows: ['11111', '11111', '01010'], colour: C.towel },
};

export function drawPeople(g: Ctx, s: SceneInput) {
	sofa(g, s);
	bike(g, s);
	hearts(g, s);
}

function sofa(g: Ctx, s: SceneInput) {
	rect(g, 38, 138, 96, 10, C.wood);
	rect(g, 34, 140, 6, 18, C.wood);
	rect(g, 132, 140, 6, 18, C.wood);
	const shown = s.seated.slice(0, SEATS);
	shown.forEach((f, i) => {
		const x = SEAT_X0 + i * SEAT_STEP;
		if (f.away !== undefined) return;
		rect(g, x + 1, 138, 9, 10, f.shirt);
		rect(g, x + 2, 137, 7, 1, f.shirt);
		rect(g, x + 4, 136, 3, 1, f.skin);
		rect(g, x + 3, 130, 5, 6, f.skin);
		rect(g, x + 3, 129, 5, 2, f.hair);
		rect(g, x + 2, 130, 1, 3, f.hair);
		dot(g, x + 4, 133, C.ink);
		dot(g, x + 6, 133, C.ink);
		if (f.speaking) sprite(g, NOTE, x + 9, 125, C.lilac);
	});
	rect(g, 36, 148, 100, 8, C.woodLight);
	rect(g, 36, 148, 100, 1, C.cushion);
	rect(g, 38, 156, 3, 4, C.ink);
	rect(g, 131, 156, 3, 4, C.ink);
	shown.forEach((f, i) => {
		const x = SEAT_X0 + i * SEAT_STEP;
		if (f.away === undefined) {
			rect(g, x, 146, 11, 2, C.laptop);
			return;
		}
		const thing = LEFT_BEHIND[f.away] ?? LEFT_BEHIND[''];
		sprite(g, thing.rows, x + 3, 148 - thing.rows.length, thing.colour);
	});
	const more = s.seated.length - SEATS;
	if (more > 0) text(g, `+${more}`, 140 - textWidth(`+${more}`), 133, C.lilac);
}

function bike(g: Ctx, s: SceneInput) {
	rect(g, 158, 158, 20, 6, C.trim);
	rect(g, 154, 163, 28, 2, C.trim);
	rect(g, 200, 160, 12, 4, C.trim);
	const rear = [168, 150];
	const front = [206, 150];
	const bb = [186, 152];
	const seat = [180, 132];
	const head = [200, 134];
	ring(g, rear[0], rear[1], 10, C.lilac);
	ring(g, front[0], front[1], 10, C.lilac);
	for (const [a, b] of [
		[rear, bb],
		[rear, seat],
		[seat, bb],
		[seat, head],
		[head, bb],
		[head, front],
	])
		line(g, a[0], a[1], b[0], b[1], C.violet);
	rect(g, 176, 130, 8, 2, C.ink);
	line(g, 200, 134, 204, 130, C.violet);
	rect(g, 203, 129, 5, 2, C.ink);
	const angle = s.rider?.crank ?? 0.9;
	const p1 = [bb[0] + Math.cos(angle) * 6, bb[1] + Math.sin(angle) * 6];
	const p2 = [bb[0] - Math.cos(angle) * 6, bb[1] - Math.sin(angle) * 6];
	line(g, bb[0], bb[1], p1[0], p1[1], C.lilac);
	line(g, bb[0], bb[1], p2[0], p2[1], C.lilac);
	if (!s.rider) {
		rect(g, 201, 131, 4, 7, C.towel);
		return;
	}
	onTheBike(g, s.rider, p1, p2, s.watt);
}

/** Two-bone legs from the hip to each pedal, the knee always forward. */
function onTheBike(g: Ctx, r: Rider, p1: number[], p2: number[], watt: string) {
	const hip = [181, 128];
	const shoulder = [193, 117];
	const leg = (pedal: number[], colour: string) => {
		const thigh = 11;
		const shin = 12;
		const dx = pedal[0] - hip[0];
		const dy = pedal[1] - hip[1];
		const d = Math.min(thigh + shin - 0.01, Math.hypot(dx, dy));
		const bend = Math.acos(
			(thigh * thigh + d * d - shin * shin) / (2 * thigh * d),
		);
		const toward = Math.atan2(dy, dx);
		const knee = [
			hip[0] + Math.cos(toward - bend) * thigh,
			hip[1] + Math.sin(toward - bend) * thigh,
		];
		line(g, hip[0], hip[1], knee[0], knee[1], colour);
		line(g, hip[0] + 1, hip[1], knee[0] + 1, knee[1], colour);
		line(g, knee[0], knee[1], pedal[0], pedal[1], colour);
	};
	leg(p2, C.legFar);
	for (let o = -1; o <= 1; o++)
		line(g, hip[0], hip[1] + o, shoulder[0], shoulder[1] + o, r.shirt);
	line(g, shoulder[0], shoulder[1], 204, 129, r.skin);
	leg(p1, C.legNear);
	rect(g, 195, 110, 5, 5, r.skin);
	rect(g, 195, 109, 5, 2, r.hair);
	if (r.speaking) sprite(g, NOTE, 201, 106, C.lilac);
	if (r.watts <= 0) return;
	const label = `${Math.round(r.watts)} W`;
	const x = 190 - Math.round(textWidth(label) / 2);
	g.globalAlpha = 0.35;
	for (const [ox, oy] of [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1],
	])
		text(g, label, x + ox, 99 + oy, watt);
	g.globalAlpha = 1;
	text(g, label, x, 99, watt);
}

function hearts(g: Ctx, s: SceneInput) {
	for (const h of s.hearts) {
		const age = s.still ? 0 : s.t - h.born;
		if (age > 1.8) continue;
		const x =
			SEAT_X0 + h.seat * SEAT_STEP + 3 + Math.round(Math.sin(age * 5) * 1.5);
		sprite(g, HEART, x, Math.round(122 - age * 14), C.heart);
	}
}
