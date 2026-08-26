import type { Workout } from '$lib/workout/types';

/** A slice of the curated library (~25 planned, WATTROOM.md). Shapes only, no invented science. */
export const library: Workout[] = [
	{
		name: 'Sweet Spot 2×20',
		steps: [
			{ type: 'warmup', seconds: 600, from: 0.45, to: 0.7 },
			{
				type: 'repeat',
				times: 2,
				steps: [
					{ type: 'steady', seconds: 1200, target: 0.9 },
					{ type: 'steady', seconds: 300, target: 0.55 },
				],
			},
			{ type: 'cooldown', seconds: 300, from: 0.6, to: 0.4 },
		],
	},
	{
		name: 'VO₂ 5×3',
		steps: [
			{ type: 'warmup', seconds: 720, from: 0.4, to: 0.75 },
			{
				type: 'repeat',
				times: 5,
				steps: [
					{ type: 'steady', seconds: 180, target: 1.15 },
					{ type: 'steady', seconds: 180, target: 0.5 },
				],
			},
			{ type: 'cooldown', seconds: 420, from: 0.55, to: 0.35 },
		],
	},
	{
		name: 'Threshold 3×12',
		steps: [
			{ type: 'warmup', seconds: 600, from: 0.45, to: 0.7 },
			{
				type: 'repeat',
				times: 3,
				steps: [
					{ type: 'steady', seconds: 720, target: 1.0 },
					{ type: 'steady', seconds: 360, target: 0.5 },
				],
			},
			{ type: 'cooldown', seconds: 300, from: 0.55, to: 0.35 },
		],
	},
	{
		name: 'Recovery spin',
		steps: [
			{ type: 'warmup', seconds: 300, from: 0.35, to: 0.5 },
			{ type: 'steady', seconds: 1800, target: 0.5 },
			{ type: 'cooldown', seconds: 300, from: 0.45, to: 0.3 },
		],
	},
	{
		name: 'Sprint sharpener',
		steps: [
			{ type: 'warmup', seconds: 600, from: 0.45, to: 0.7 },
			{
				type: 'repeat',
				times: 6,
				steps: [
					{ type: 'sprint', seconds: 15 },
					{ type: 'steady', seconds: 285, target: 0.5 },
				],
			},
			{ type: 'cooldown', seconds: 300, from: 0.5, to: 0.35 },
		],
	},
];
