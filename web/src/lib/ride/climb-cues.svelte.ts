import { createMoments } from '$lib/moments';
import type { ClimbClass } from '$lib/road/climbs';
import { play } from '$lib/sound/cues';
import type { ClimbView } from '$lib/ride/climb-view';

/**
 * What the climb's moments are doing right now (#3645), for the surfaces that
 * draw them: the CLIMB page's slide-in and flamme rouge, and the summit strip
 * above the Skyline. One ride per tab, so one store; only the surface that
 * rides writes it (ponytail: a second rider surface in one tab would share it).
 */
export const climbStage = $state({
	slide: false,
	flammeStamp: false,
	summit: null as { cls: ClimbClass; confetti: boolean } | null,
});

const CATEGORY = { HC: 'HC', I: '1', II: '2', III: '3', IV: '4' } as const;

/**
 * The climb card's moments (#3645, ADR-0079, ux.md: state changes announce
 * themselves), through the moments queue, one at a time:
 * - `climb`: cue `climb` as the card opens, hit when its slide-in ends (`--dur-stage`);
 * - `flamme`: the flag's stamp as the last kilometre begins, no sound of its own;
 * - `summit`: cue `summit` as the strip enters, hit when it ends; confetti at HC and I.
 * Called once by the surface that rides the road, never by a display — a
 * TV beside the desk would say it twice. Reduced motion keeps every cue; the
 * stylesheet turns each motion into a held stamp.
 */
export function watchClimbCues(view: () => ClimbView | null | undefined) {
	const queue = createMoments<ClimbClass>({ now: () => performance.now() });
	let opened: number | null = null;
	let flagged: number | null = null;
	let topped: number | null = null;

	$effect(() => {
		const id = setInterval(() => {
			for (const e of queue.tick()) {
				const on = e.stage === 'enter';
				if (e.kind === 'climb') {
					climbStage.slide = on;
					if (on) play('climb');
				} else if (e.kind === 'flamme') climbStage.flammeStamp = on;
				else if (e.kind === 'summit') {
					climbStage.summit =
						e.stage === 'exit'
							? null
							: { cls: e.payloads[0], confetti: e.confetti };
					if (on) play('summit');
				}
			}
		}, 50);
		return () => {
			clearInterval(id);
			climbStage.slide = climbStage.flammeStamp = false;
			climbStage.summit = null;
		};
	});

	$effect(() => {
		const v = view();
		const climb = v?.climb.startM ?? null;
		if (!v || climb === null) return;
		const cls = v.climb.cls;
		if (climb !== opened) {
			opened = climb;
			queue.stage({ kind: 'climb', payload: cls });
		}
		if (v.card.flammeRouge && climb !== flagged) {
			flagged = climb;
			queue.stage({ kind: 'flamme', payload: cls });
		}
		if (v.card.summited && climb !== topped) {
			topped = climb;
			queue.stage({ kind: 'summit', category: CATEGORY[cls], payload: cls });
		}
	});
}
