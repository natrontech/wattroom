import { durationSeconds } from './engine';
import type { Workout } from './types';

/**
 * The curated library (WATTROOM.md: ~25 workouts).
 *
 * Catalogue metadata wraps the workout rather than extending it: `Workout` is the
 * interchange format specified in docs/SPEC.md, and an id or a focus label is our
 * shelving, not part of the file someone might import or export.
 *
 * Every intensity below sits in a zone defined by docs/SPEC.md's Coggan table —
 * nothing here is an invented prescription. "Sweet spot" is the one named band that
 * is not a Coggan zone: it straddles tempo and threshold at 88–94 % FTP, which is
 * the standard definition and the one WATTROOM.md names.
 */
export type Focus =
	| 'Recovery'
	| 'Endurance'
	| 'Tempo'
	| 'Sweet spot'
	| 'Threshold'
	| 'VO₂ max'
	| 'Anaerobic';

export interface LibraryWorkout {
	id: string;
	focus: Focus;
	/** One line on what it is for — the only onboarding most riders read. */
	summary: string;
	workout: Workout;
}

const warm = (seconds: number, from: number, to: number) =>
	({ type: 'warmup', seconds, from, to }) as const;
const cool = (seconds: number, from: number, to: number) =>
	({ type: 'cooldown', seconds, from, to }) as const;
const hold = (seconds: number, target: number) =>
	({ type: 'steady', seconds, target }) as const;
const repeat = (times: number, steps: Workout['steps']) =>
	({ type: 'repeat', times, steps }) as const;
const sprint = (seconds: number) => ({ type: 'sprint', seconds }) as const;

export const library: LibraryWorkout[] = [
	// ── Recovery: ≤ 55 % FTP ────────────────────────────────────────────────────
	{
		id: 'recovery-spin',
		focus: 'Recovery',
		summary:
			'Easy spinning to move blood, not to train. Should feel like nothing.',
		workout: {
			name: 'Recovery Spin',
			author: 'wattroom',
			steps: [warm(300, 0.35, 0.5), hold(1800, 0.5), cool(300, 0.45, 0.3)],
		},
	},
	{
		id: 'openers',
		focus: 'Recovery',
		summary:
			'Pre-event activation: short raises to wake the legs without spending anything.',
		workout: {
			name: 'Openers',
			author: 'wattroom',
			// The raises are sprints on purpose: openers are "wind it up", not a
			// prescribed ERG number — slope mode, the watts are yours.
			steps: [
				warm(600, 0.4, 0.65),
				repeat(3, [sprint(60), hold(180, 0.55)]),
				repeat(2, [sprint(15), hold(165, 0.5)]),
				cool(420, 0.55, 0.35),
			],
		},
	},
	{
		id: 'legs-loosener',
		focus: 'Recovery',
		summary: 'Twenty easy minutes for the day after something hard.',
		workout: {
			name: 'Legs Loosener',
			author: 'wattroom',
			steps: [warm(300, 0.3, 0.45), hold(900, 0.48), cool(180, 0.4, 0.3)],
		},
	},

	// ── Endurance: 56–75 % FTP ──────────────────────────────────────────────────
	{
		id: 'endurance-60',
		focus: 'Endurance',
		summary:
			'An hour of steady aerobic work. The bread and butter of a base block.',
		workout: {
			name: 'Endurance 60',
			author: 'wattroom',
			steps: [warm(600, 0.45, 0.65), hold(2400, 0.68), cool(600, 0.6, 0.4)],
		},
	},
	{
		id: 'endurance-90',
		focus: 'Endurance',
		summary: 'Ninety minutes at conversational pace. Long, dull and effective.',
		workout: {
			name: 'Endurance 90',
			author: 'wattroom',
			steps: [warm(600, 0.45, 0.65), hold(4200, 0.7), cool(600, 0.6, 0.4)],
		},
	},
	{
		id: 'endurance-surges',
		focus: 'Endurance',
		summary:
			'Steady endurance broken up by short tempo lifts, to stop it being boring.',
		workout: {
			name: 'Endurance with Surges',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.65),
				repeat(6, [hold(120, 0.85), hold(360, 0.65)]),
				cool(420, 0.6, 0.4),
			],
		},
	},
	{
		id: 'cadence-pyramid',
		focus: 'Endurance',
		summary:
			'Endurance power throughout — the work is holding the cadence you are told.',
		workout: {
			name: 'Cadence Pyramid',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.6),
				repeat(5, [hold(300, 0.68), hold(120, 0.6)]),
				cool(300, 0.55, 0.4),
			],
		},
	},

	// ── Tempo: 76–90 % FTP ──────────────────────────────────────────────────────
	{
		id: 'tempo-3x10',
		focus: 'Tempo',
		summary:
			'Three tempo blocks. Comfortably hard, and a gentle way into structure.',
		workout: {
			name: 'Tempo 3×10',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(3, [hold(600, 0.82), hold(300, 0.55)]),
				cool(300, 0.55, 0.4),
			],
		},
	},
	{
		id: 'tempo-2x20',
		focus: 'Tempo',
		summary:
			'Two long tempo efforts. Sustainable, but you will know you did it.',
		workout: {
			name: 'Tempo 2×20',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(2, [hold(1200, 0.8), hold(300, 0.55)]),
				cool(300, 0.55, 0.4),
			],
		},
	},
	{
		id: 'tempo-45',
		focus: 'Tempo',
		summary: 'One continuous tempo block. Simple, and harder than it reads.',
		workout: {
			name: 'Tempo 45',
			author: 'wattroom',
			steps: [warm(600, 0.45, 0.7), hold(2700, 0.8), cool(300, 0.55, 0.4)],
		},
	},

	// ── Sweet spot: 88–94 % FTP ─────────────────────────────────────────────────
	{
		id: 'sweet-spot-2x20',
		focus: 'Sweet spot',
		summary:
			'The classic. Most of the benefit of threshold work at a fraction of the cost.',
		workout: {
			name: 'Sweet Spot 2×20',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(2, [hold(1200, 0.9), hold(300, 0.55)]),
				cool(300, 0.6, 0.4),
			],
		},
	},
	{
		id: 'sweet-spot-3x12',
		focus: 'Sweet spot',
		summary:
			'Three shorter sweet-spot blocks — the same work, easier to hold together.',
		workout: {
			name: 'Sweet Spot 3×12',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(3, [hold(720, 0.91), hold(300, 0.55)]),
				cool(300, 0.6, 0.4),
			],
		},
	},
	{
		id: 'sweet-spot-4x8',
		focus: 'Sweet spot',
		summary:
			'Short sweet-spot reps at the top of the band. A good first structured session.',
		workout: {
			name: 'Sweet Spot 4×8',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(4, [hold(480, 0.93), hold(240, 0.55)]),
				cool(300, 0.6, 0.4),
			],
		},
	},
	{
		id: 'sweet-spot-over-unders',
		focus: 'Sweet spot',
		summary:
			'Alternating just under and just over. Teaches you to clear lactate while riding.',
		workout: {
			name: 'Sweet Spot Over-Unders',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(3, [
					repeat(4, [hold(120, 0.88), hold(60, 1.0)]),
					hold(300, 0.55),
				]),
				cool(300, 0.6, 0.4),
			],
		},
	},
	{
		id: 'sweet-spot-60',
		focus: 'Sweet spot',
		summary: 'A big sweet-spot day. Three long blocks; pace the first one.',
		workout: {
			name: 'Sweet Spot 3×20',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(3, [hold(1200, 0.89), hold(300, 0.55)]),
				cool(300, 0.6, 0.4),
			],
		},
	},

	// ── Threshold: 91–105 % FTP ─────────────────────────────────────────────────
	{
		id: 'threshold-2x20',
		focus: 'Threshold',
		summary: 'Twenty minutes at FTP, twice. The session that moves the number.',
		workout: {
			name: 'Threshold 2×20',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(2, [hold(1200, 1.0), hold(600, 0.5)]),
				cool(300, 0.55, 0.4),
			],
		},
	},
	{
		id: 'threshold-3x12',
		focus: 'Threshold',
		summary: 'Three threshold blocks with full recovery. Hard, but repeatable.',
		workout: {
			name: 'Threshold 3×12',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(3, [hold(720, 1.0), hold(360, 0.5)]),
				cool(300, 0.55, 0.4),
			],
		},
	},
	{
		id: 'threshold-over-unders',
		focus: 'Threshold',
		summary:
			'Over and under FTP without rest between. The most honest session here.',
		workout: {
			name: 'Threshold Over-Unders',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(3, [
					repeat(5, [hold(60, 1.05), hold(120, 0.95)]),
					hold(300, 0.5),
				]),
				cool(300, 0.55, 0.4),
			],
		},
	},
	{
		id: 'threshold-4x8',
		focus: 'Threshold',
		summary:
			'Short threshold reps slightly over FTP. Sharper than 2×20, less grim.',
		workout: {
			name: 'Threshold 4×8',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(4, [hold(480, 1.03), hold(240, 0.5)]),
				cool(300, 0.55, 0.4),
			],
		},
	},

	// ── VO₂ max: 106–120 % FTP ──────────────────────────────────────────────────
	{
		id: 'vo2-5x3',
		focus: 'VO₂ max',
		summary: 'Five three-minute efforts. Long enough to hurt properly.',
		workout: {
			name: 'VO₂ 5×3',
			author: 'wattroom',
			steps: [
				warm(720, 0.4, 0.75),
				repeat(5, [hold(180, 1.15), hold(180, 0.5)]),
				cool(420, 0.55, 0.35),
			],
		},
	},
	{
		id: 'vo2-6x2',
		focus: 'VO₂ max',
		summary: 'Shorter, sharper VO₂ reps at the top of the band.',
		workout: {
			name: 'VO₂ 6×2',
			author: 'wattroom',
			steps: [
				warm(720, 0.4, 0.75),
				repeat(6, [hold(120, 1.2), hold(180, 0.5)]),
				cool(420, 0.55, 0.35),
			],
		},
	},
	{
		id: 'vo2-4x4',
		focus: 'VO₂ max',
		summary: 'Four by four — the most studied interval in endurance sport.',
		workout: {
			name: 'VO₂ 4×4',
			author: 'wattroom',
			steps: [
				warm(720, 0.4, 0.75),
				repeat(4, [hold(240, 1.1), hold(240, 0.5)]),
				cool(420, 0.55, 0.35),
			],
		},
	},
	{
		id: 'vo2-30-30',
		focus: 'VO₂ max',
		summary:
			'Thirty on, thirty off. Enormous time at VO₂ for how survivable it feels.',
		workout: {
			name: 'VO₂ 30/30s',
			author: 'wattroom',
			steps: [
				warm(720, 0.4, 0.75),
				repeat(3, [repeat(10, [hold(30, 1.2), hold(30, 0.5)]), hold(300, 0.5)]),
				cool(420, 0.55, 0.35),
			],
		},
	},

	// ── Anaerobic: 121–150 % FTP ────────────────────────────────────────────────
	{
		id: 'anaerobic-8x1',
		focus: 'Anaerobic',
		summary:
			'One-minute efforts well over threshold. Full recovery between; use it.',
		workout: {
			name: 'Anaerobic 8×1',
			author: 'wattroom',
			steps: [
				warm(720, 0.4, 0.7),
				repeat(8, [hold(60, 1.35), hold(240, 0.45)]),
				cool(420, 0.55, 0.35),
			],
		},
	},
	{
		id: 'attacks',
		focus: 'Anaerobic',
		summary: 'Repeated attacks off a tempo base — for the ability to go again.',
		workout: {
			name: 'Attacks',
			author: 'wattroom',
			steps: [
				warm(720, 0.4, 0.7),
				repeat(4, [
					hold(30, 1.4),
					hold(150, 0.8),
					hold(30, 1.4),
					hold(300, 0.5),
				]),
				cool(420, 0.55, 0.35),
			],
		},
	},
	{
		id: 'sprint-sharpener',
		focus: 'Anaerobic',
		summary:
			'Six all-out sprints. No ERG target — the trainer gets out of your way.',
		workout: {
			name: 'Sprint Sharpener',
			author: 'wattroom',
			steps: [
				warm(600, 0.45, 0.7),
				repeat(6, [{ type: 'sprint', seconds: 15 }, hold(285, 0.5)]),
				cool(300, 0.5, 0.35),
			],
		},
	},
];

// Test fixtures: resolvable by id (CI rides in real time and needs a short
// one), never listed — a two-minute 'workout' with a product name was how a
// smoke fixture ended up in the curated library once.
const fixtures: LibraryWorkout[] = [
	{
		id: 'smoke-test',
		focus: 'Recovery',
		summary: 'CI fixture — two minutes, end to end.',
		workout: {
			name: 'Smoke Test',
			author: 'wattroom',
			steps: [warm(60, 0.4, 0.65), hold(60, 0.75)],
		},
	},
];

export const byId = (id: string): LibraryWorkout | undefined =>
	library.find((entry) => entry.id === id) ??
	fixtures.find((entry) => entry.id === id);

export const focuses: Focus[] = [
	'Recovery',
	'Endurance',
	'Tempo',
	'Sweet spot',
	'Threshold',
	'VO₂ max',
	'Anaerobic',
];

/** Sorted shortest-first within a focus, so a browsing rider sees the easy way in. */
export function byFocus(focus: Focus): LibraryWorkout[] {
	return library
		.filter((entry) => entry.focus === focus)
		.sort((a, b) => durationSeconds(a.workout) - durationSeconds(b.workout));
}
