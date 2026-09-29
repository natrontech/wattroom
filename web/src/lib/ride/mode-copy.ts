import type { FreeMode } from '$lib/ride/free-ride.svelte';

/**
 * What the free ride's two modes do, said once (#3203). A rider asked for a
 * free ride without ERG; grade mode was it all along, and the toggle never
 * said so. The channel's free ride draws these under its toggle, and /ride's
 * free-ride card reads the same lines when it lands (#3027).
 */
export const MODE_LINES: Record<FreeMode, string> = {
	grade: 'You set the slope and shift your own gears (SIM).',
	watts: 'The trainer holds your watts whatever your cadence (ERG).',
};

/** Grade on a one-gear setup: slope mode has no usable range there. */
export const ONE_GEAR_LINE =
	'One gear: the grade has no range here, use Watts.';

/** The same two modes on a road (#3027): the road chooses, not the rider. */
export const ROAD_LINES: Record<FreeMode, string> = {
	grade:
		'The road sets the slope you feel, and you shift your own gears (SIM).',
	watts:
		'The trainer holds the watts the road asks for, whatever your cadence (ERG).',
};

/** The line under the toggle for the mode a rider is in. */
export function modeLine(
	mode: FreeMode,
	singleSpeed: boolean,
	onRoad = false,
): string {
	if (mode === 'grade' && singleSpeed) return ONE_GEAR_LINE;
	return (onRoad ? ROAD_LINES : MODE_LINES)[mode];
}

/** Settings › Equipment's `singleSpeed`, said as what it does. */
export const ONE_GEAR_SETTING = {
	label: "One gear (Zwift Cog), or don't make me shift",
	hint: 'WattRoom holds watts wherever it would put you on a slope.',
} as const;
