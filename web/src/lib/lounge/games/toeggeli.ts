/**
 * Töggeli, the room's table football, drawn from the hub's match
 * (server/internal/hub/toeggeli_table.go). The hub runs it; a screen only
 * draws the table and sends its rider's rods and button.
 */
import type { ToeggeliState } from '$lib/protocol';
import { initialsOf } from '$lib/lounge/memory';
import { LOUNGE as C } from '$lib/lounge/palette';
import {
	outlined,
	rect,
	ring,
	text,
	textWidth,
	type Ctx,
} from '$lib/lounge/pixel';
import { SCREEN_H as H, SCREEN_W as W } from './game';

/** The field on the screen: the table's 0 to 1 along and across. */
const FX = 10;
const FY = 10;
const FW = 140;
const FH = 74;
const sx = (x: number) => Math.round(FX + x * FW);
const sy = (y: number) => Math.round(FY + y * FH);

/** The goal's half width, about the middle, as the hub has it. */
const MOUTH = 0.18;

/** A side's figures, where the hub stands them: a keeper, then three forwards. */
export function menOf(rodY: number, left: boolean): [number, number][] {
	const keeperX = left ? 0.08 : 0.92;
	const forwardX = left ? 0.62 : 0.38;
	const mid = 0.3 + 0.4 * rodY;
	return [
		[keeperX, 0.12 + 0.76 * rodY],
		[forwardX, mid - 0.27],
		[forwardX, mid],
		[forwardX, mid + 0.27],
	];
}

/** Where a pointer at a screen row puts the rods: the forwards follow it. */
export function rodAt(screenY: number): number {
	const y = (screenY - FY) / FH;
	return Math.min(1, Math.max(0, (y - 0.3) / 0.4));
}

const clockOf = (ms: number) => {
	const s = Math.ceil(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function side(g: Ctx, s: ToeggeliState, left: boolean) {
	const y = left ? s.leftY : s.rightY;
	const kick = left ? s.leftKick : s.rightKick;
	const shirt = left ? C.teal : C.red;
	const shade = left ? C.tealLight : C.redLight;
	const men = menOf(y, left);
	// The rods across the table, one for the keeper and one for the forwards.
	for (const x of new Set(men.map(([x]) => x)))
		rect(g, sx(x), FY, 1, FH, C.cable);
	const toward = left ? 1 : -1;
	for (const [x, my] of men) {
		const px = sx(x);
		const py = sy(my);
		outlined(g, [[px - 1, py - 4, 3, 7, shirt]], C.ink);
		rect(g, px - 1, py - 4, 3, 2, C.heart);
		rect(g, px - 1, py - 2, 3, 1, shade);
		// The foot, swung forward while the button is down.
		rect(g, px + (kick ? toward * 2 : 0), py + 2, 1, 2, C.ink);
	}
}

export function drawTable(g: Ctx, s: ToeggeliState | null) {
	// The wooden table, its field and lines.
	rect(g, 0, 0, W, H, C.woodDark);
	rect(g, FX - 4, FY - 3, FW + 8, FH + 6, C.wood);
	rect(g, FX, FY, FW, FH, C.leaf);
	for (let x = 0; x < FW; x += 20) rect(g, FX + x, FY, 10, FH, C.leafDark);
	rect(g, FX, FY, FW, 1, C.paper);
	rect(g, FX, FY + FH - 1, FW, 1, C.paper);
	rect(g, FX, FY, 1, FH, C.paper);
	rect(g, FX + FW - 1, FY, 1, FH, C.paper);
	rect(g, FX + FW / 2, FY, 1, FH, C.paper);
	ring(g, FX + FW / 2, FY + FH / 2, 9, C.paper);
	// The goals' mouths, dark through the end walls.
	for (const x of [FX - 4, FX + FW])
		rect(g, x, sy(0.5 - MOUTH), 4, sy(0.5 + MOUTH) - sy(0.5 - MOUTH), C.ink);
	if (!s) return;
	side(g, s, true);
	side(g, s, false);
	// The ball, a pixel bigger than a figure's foot.
	outlined(g, [[sx(s.ballX) - 1, sy(s.ballY) - 1, 2, 2, C.paper]], C.ink);
	// The score and the clock on the table's edge.
	const score = `${initialsOf(s.leftName)} ${s.leftGoals}  ${s.rightGoals} ${initialsOf(s.rightName)}`;
	text(g, score, Math.round((W - textWidth(score)) / 2), 2, C.amber);
	text(g, clockOf(s.leftMs), 3, 2, C.paper);
	const said =
		s.phase === 'goal'
			? 'TOR'
			: s.phase === 'over'
				? s.ended
					? 'WALKED OFF'
					: s.winner
						? `${initialsOf(s.winner === s.left ? s.leftName : s.rightName)} WINS`
						: 'DRAW'
				: '';
	if (said) {
		const w = textWidth(said);
		rect(g, Math.round((W - w) / 2) - 3, 39, w + 6, 11, C.ink);
		text(g, said, Math.round((W - w) / 2), 42, C.amber);
	}
}
