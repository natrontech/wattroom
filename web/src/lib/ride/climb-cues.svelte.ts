import { createMoments } from '$lib/moments';
import type { ClimbClass } from '$lib/road/climbs';
import { play } from '$lib/sound/cues';
import type { ClimbView } from '$lib/ride/climb-view';
import type { GhostCall } from '$lib/ride/ghost-split.svelte';

/**
 * What the climb's moments are doing right now (#3645), for the surfaces that
 * draw them: the CLIMB page's slide-in and flamme rouge, and the strip above
 * the Skyline with the summit or your ghost's call (#3246). One ride per tab, so one store; only the surface that
 * rides writes it (ponytail: a second rider surface in one tab would share it).
 */
export const climbStage = $state({
	slide: false,
	flammeStamp: false,
	summit: null as { cls: ClimbClass; confetti: boolean } | null,
	call: null as GhostCall | null,
});

const CATEGORY = { HC: 'HC', I: '1', II: '2', III: '3', IV: '4' } as const;

/**
 * The climb card's moments (#3645, ADR-0079, ux.md: state changes announce
 * themselves), through the moments queue, one at a time:
 * - `climb`: cue `climb` as the card opens, hit when its slide-in ends (`--dur-stage`);
 * - `flamme`: the flag's stamp as the last kilometre begins, no sound of its own;
 * - `summit`: cue `summit` as the strip enters, hit when it ends; confetti at HC and I;
 * - `split`: your ghost's gap called on the strip (#3246), cue `split` as it
 *   enters, hit when it ends; a new best at the road's end is a `pr`, cue `fanfare`.
 * Called once by the surface that rides the road, never by a display — a
 * TV beside the desk would say it twice. Reduced motion keeps every cue; the
 * stylesheet turns each motion into a held stamp.
 */
export function watchClimbCues(
	view: () => ClimbView | null | undefined,
	ghostCall: () => GhostCall | null | undefined = () => null,
) {
	const queue = createMoments<ClimbClass | GhostCall>({
		now: () => performance.now(),
	});
	let opened: number | null = null;
	let flagged: number | null = null;
	let topped: number | null = null;
	let called: GhostCall | null = null;

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
							: { cls: e.payloads[0] as ClimbClass, confetti: e.confetti };
					if (on) play('summit');
				} else if (e.kind === 'split' || e.kind === 'pr') {
					climbStage.call =
						e.stage === 'exit' ? null : (e.payloads.at(-1) as GhostCall);
					if (on) play(e.kind === 'pr' ? 'fanfare' : 'split');
				}
			}
		}, 50);
		return () => {
			clearInterval(id);
			climbStage.slide = climbStage.flammeStamp = false;
			climbStage.summit = climbStage.call = null;
		};
	});

	$effect(() => {
		const call = ghostCall();
		if (!call || call === called) return;
		called = call;
		queue.stage({ kind: call.kind, payload: call });
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
