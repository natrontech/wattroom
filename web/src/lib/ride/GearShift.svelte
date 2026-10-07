<script lang="ts">
	/**
	 * Easier / Harder on screen (ADR-0084, #3330): the pair a rider hits at
	 * arm's length, 44 px each, in slot 1's control row (TARGETS ride-free-road
	 * 7). The gear itself has one home, the RIDE page (D17), where it pulses
	 * on a change; what the trainer cannot do in this gear is the pair's
	 * tooltip. The cues are the shifter's (ride-shift.ts), so a key and a tap
	 * here sound the same.
	 */
	import type { Clamp } from '$lib/ride/drivetrain';
	import { createLimitWatch, limitLine } from '$lib/ride/limit-line';
	import type { RideShift } from '$lib/ride/ride-shift';
	import type { ShiftDir } from '$lib/ride/shifter';

	let {
		shift,
		gear,
		off,
		cassette,
	}: {
		shift: Pick<RideShift, 'press' | 'release' | 'drop'>;
		gear: { clamp: Clamp };
		/** Why the pair cannot act here — its one-line hint — or null. */
		off: string | null;
		/** A real cassette under the virtual gear: not a one-gear setup. */
		cassette: boolean;
	} = $props();

	// The limit line waits out a clamp that only brushes the limit.
	const limit = createLimitWatch();
	let limited = $state(false);
	$effect(() => {
		const look = setInterval(
			() => (limited = limit.see(gear.clamp !== null, Date.now())),
			1_000,
		);
		return () => clearInterval(look);
	});
	// ponytail: the limit rides as the pair's tooltip; its own line when a
	// rider asks why Harder stopped.
	const title = $derived(
		off ??
			(limited && gear.clamp ? limitLine(gear.clamp, cassette) : undefined),
	);

	/** A finger or a mouse holds; a keyboard's Enter or Space taps (detail 0). */
	function control(dir: ShiftDir) {
		const source = `screen:${dir}`;
		return {
			onpointerdown: (event: PointerEvent) => {
				if (event.button === 0 && !off) shift.press(dir, source);
			},
			onpointerup: () => shift.release(source),
			onpointerleave: () => shift.release(source),
			onpointercancel: () => shift.drop(source),
			onclick: (event: MouseEvent) => {
				if (event.detail !== 0 || off) return;
				shift.press(dir, source);
				shift.release(source);
			},
			oncontextmenu: (event: Event) => event.preventDefault(),
		};
	}
</script>

<button
	{...control(-1)}
	disabled={!!off}
	{title}
	class="btn btn-secondary btn-lg touch-manipulation select-none disabled:opacity-40"
	>Easier</button
>
<button
	{...control(1)}
	disabled={!!off}
	{title}
	class="btn btn-secondary btn-lg touch-manipulation select-none disabled:opacity-40"
	>Harder</button
>
