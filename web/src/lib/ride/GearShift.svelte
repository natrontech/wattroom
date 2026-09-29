<script lang="ts">
	/**
	 * Easier / Harder on screen, with the gear between them (ADR-0084, #3330):
	 * the pair a rider hits at arm's length, the gear they are in, what the
	 * trainer cannot do in it, and the one line that says the keys work too.
	 *
	 * The gear is rider state, not live data (ADR-0005): neon, never the watt
	 * accent, and it never glows. It pulses once when it changes and is read
	 * out politely; the cues are the shifter's (ride-shift.ts), so a key and a
	 * tap here sound the same.
	 */
	import { untrack } from 'svelte';
	import { DUR, EASE } from '$lib/motion/tokens';
	import { prefersReducedMotion } from '$lib/motion';
	import type { Clamp } from '$lib/ride/drivetrain';
	import { createLimitWatch, limitLine } from '$lib/ride/limit-line';
	import type { RideShift } from '$lib/ride/ride-shift';
	import type { ShiftDir } from '$lib/ride/shifter';

	let {
		shift,
		gear,
		off,
		resetAt,
		cassette,
	}: {
		shift: Pick<RideShift, 'press' | 'release' | 'drop'>;
		gear: { label: string; clamp: Clamp };
		/** Why the pair cannot act here — its one-line hint — or null. */
		off: string | null;
		/** When the grant came back and the gear restarted at k = 1. */
		resetAt: number;
		/** A real cassette under the virtual gear: not a one-gear setup. */
		cassette: boolean;
	} = $props();

	/** How long "Gear back to your real gear" stays on the field (#3330). */
	const RESET_SHOWN_MS = 5_000;

	let reset = $state(false);
	$effect(() => {
		if (!resetAt) return;
		reset = true;
		const hide = setTimeout(() => (reset = false), RESET_SHOWN_MS);
		return () => clearTimeout(hide);
	});

	let field = $state<HTMLElement>();
	let seen = untrack(() => gear.label);
	$effect(() => {
		const label = gear.label;
		if (label === seen) return;
		seen = label;
		if (prefersReducedMotion.current) return;
		field?.animate?.(
			[{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }],
			{
				duration: DUR.reveal,
				easing: `cubic-bezier(${EASE.arrive.join(',')})`,
			},
		);
	});

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

<div class="flex w-full flex-col gap-2">
	<div class="flex items-stretch gap-3">
		<button
			{...control(-1)}
			disabled={!!off}
			title={off ?? undefined}
			class="btn btn-secondary btn-lg flex-1 touch-manipulation select-none disabled:opacity-40"
			>Easier</button
		>
		<output
			bind:this={field}
			aria-live="polite"
			class="font-display text-neon flex min-w-28 items-center justify-center px-2 text-center text-xl font-bold tabular-nums"
			>{reset ? 'Gear back to your real gear' : gear.label}</output
		>
		<button
			{...control(1)}
			disabled={!!off}
			title={off ?? undefined}
			class="btn btn-secondary btn-lg flex-1 touch-manipulation select-none disabled:opacity-40"
			>Harder</button
		>
	</div>
	{#if limited && gear.clamp}
		<p role="status" class="text-warn text-center text-sm">
			{limitLine(gear.clamp, cassette)}
		</p>
	{/if}
	<p class="text-muted text-center text-sm">
		{off ?? 'Shift with Easier and Harder, or − and + on a keyboard'}
	</p>
</div>
