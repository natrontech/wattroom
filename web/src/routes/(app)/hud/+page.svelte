<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { formatClock, formatKm } from '$lib/format';
	import { isStale, subscribeHud, type HudSnapshot } from '$lib/hud/feed';
	import { account } from '$lib/account.svelte';
	import { GRADE_FILL, gradeStep } from '$lib/road/skyline';
	import { toleranceBand } from '$lib/workout/guards';

	// The HUD (#296, ADR-0041): the rider's own numbers in a window of their
	// own — the shell floats it over whatever else is on screen while a ride
	// runs and WattRoom is not in front. A mirror of the riding screen through
	// the HUD feed; it reads no sensor and joins no channel.
	let snapshot = $state<HudSnapshot | null>(null);
	let now = $state(Date.now());
	$effect(() => {
		const stop = subscribeHud((s) => (snapshot = s));
		const clock = setInterval(() => (now = Date.now()), 1000);
		return () => {
			stop();
			clearInterval(clock);
		};
	});
	const quiet = $derived(isStale(snapshot, now));
	const shell = (globalThis as { wattroom?: { hud?: (on: boolean) => void } })
		.wattroom;
	// The band the riding screen uses, not a fourth copy of it (#2159): this
	// one dropped docs/SPEC.md's ±10 W floor, so under a 200 W target the HUD
	// read "off target" while the instrument it mirrors read "on target".
	// The ride's clock: time left, or ridden on a ride with no end.
	const clock = $derived(
		!snapshot
			? null
			: snapshot.elapsed === undefined
				? { time: formatClock(snapshot.remaining), word: 'left' }
				: { time: formatClock(snapshot.elapsed), word: 'ridden' },
	);
	const road = $derived(snapshot?.road);

	const onTarget = $derived(
		!!snapshot &&
			snapshot.target > 0 &&
			Math.abs(snapshot.watts - snapshot.target) <=
				toleranceBand(snapshot.target),
	);
</script>

<svelte:head><title>HUD · WattRoom</title></svelte:head>

<!-- Fills the shell's frameless window; draggable by its whole face, the
     close button excepted, so it can be moved without a title bar. The
     window is the container: the block inside is the shell's 320×132 at
     16 px, and any larger window scales that same block as one centred unit
     (#3678), so a browser tab on a second screen reads from the saddle. -->
{#snippet clockText()}
	{#if clock}<span class="num">{clock.time}</span> {clock.word}{/if}
{/snippet}

<main
	class="cave bg-surface text-ink [container-type:size] relative grid h-dvh place-items-center overflow-hidden select-none"
	style="-webkit-app-region: drag"
>
	{#if shell?.hud}
		<button
			onclick={() => shell.hud?.(false)}
			class="text-muted hover:text-ink absolute top-2 right-2 grid h-6 w-6 place-items-center rounded"
			style="-webkit-app-region: no-drag"
			aria-label="Close the HUD"><X size={14} /></button
		>
	{/if}
	<div class="hud flex flex-col justify-center">
		{#if account.loaded && !account.me}
			<!-- #1667: the layout's gate would open the sign-in page in this
			     320 px box, and the shell cannot complete one anyway (ADR-0040). -->
			<p class="label">wattroom</p>
			<p
				class="text-muted mt-[0.25em] text-[0.875em]"
				data-testid="hud-signed-out"
			>
				Sign in on the main window.
			</p>
		{:else if quiet || !snapshot}
			<p class="label">wattroom</p>
			<p class="text-muted mt-[0.25em] text-[0.875em]" data-testid="hud-quiet">
				Waiting for a ride…
			</p>
		{:else}
			<!-- The label never widens the block (contain: inline-size): the
			     numbers set its width, and the label truncates to it. -->
			<div class="rows flex items-baseline gap-[0.5em]">
				<p
					class="label min-w-0 flex-1 truncate [contain:inline-size]"
					data-testid="hud-label"
				>
					{snapshot.label}
				</p>
				{#if road}
					<!-- Row 3 is the road's on a road; the clock moves up beside the
					     label so the window keeps its 320×132 (desktop/main.js). -->
					<p class="clock text-muted" data-testid="hud-remaining">
						{@render clockText()}
					</p>
				{/if}
			</div>
			<div class="mt-[0.25em] flex items-baseline gap-[0.75em]">
				<span
					class="font-display text-watt glow-text text-[3em] leading-none font-bold tabular-nums"
					data-testid="hud-watts">{Math.round(snapshot.watts)}</span
				>
				<span class="text-muted text-[0.875em]">w</span>
				{#if snapshot.target > 0}
					<span
						class="text-muted font-display ml-auto text-[1.5em] leading-none tabular-nums {onTarget
							? 'text-ink'
							: ''}"
						data-testid="hud-target"
						>{Math.round(snapshot.target)}<span class="text-[0.5em]">
							target</span
						></span
					>
				{/if}
			</div>
			{#if snapshot.fault}
				<p
					class="text-danger mt-[0.25em] text-[0.75em]"
					data-testid="hud-fault"
				>
					{snapshot.fault === 'trainer'
						? 'Trainer signal lost — reconnecting'
						: 'Channel connection lost — reconnecting'}
				</p>
			{/if}
			{#if road}
				<!-- On a road (#3092, #3060's readout): the grade under the rider
				     and, on a classed climb, how far to its top. Numbers in the
				     display face, units at half their size (TARGETS G4). -->
				<p class="text-ink mt-[0.25em] text-[0.75em]" data-testid="hud-road">
					<span class="num">{road.grade.toFixed(1)}</span>
					<span class="unit">%</span>
					{#if road.toTopM !== undefined}
						· top <span class="num">{formatKm(road.toTopM)}</span>
						<span class="unit">km</span>
					{/if}
				</p>
				{#if road.ahead}
					<!-- The next 2 km in 100 m bars, in the Skyline's grade ramp:
					     steeper is stronger and taller. -->
					<svg
						viewBox="0 0 20 5"
						preserveAspectRatio="none"
						width="100%"
						class="mt-[0.25em] block h-[0.75em]"
						role="img"
						aria-label="The grade over the next 2 km"
						data-testid="hud-ahead"
					>
						{#each road.ahead as grade, i (i)}
							{@const step = gradeStep(grade)}
							<rect
								x={i + 0.1}
								y={4 - step}
								width="0.8"
								height={step + 1}
								class="{GRADE_FILL[step]} forced-colors:fill-[GrayText]"
							/>
						{/each}
					</svg>
				{/if}
			{:else}
				<p class="clock text-muted mt-[0.5em]" data-testid="hud-remaining">
					{@render clockText()}
				</p>
			{/if}
		{/if}
	</div>
</main>

<style>
	/* The shell's 320×132 window at 16 px is the design (ADR-0041): every
	   size inside is in em, and the font size is whatever fits that block
	   into the window, never less than the shell's. */
	.hud {
		font-size: max(16px, min(100cqw / 20, 100cqh / 8.25));
		box-sizing: border-box;
		width: 20em;
		height: 8.25em;
		max-width: 100cqw;
		max-height: 100cqh;
		padding: 0.75em 1.25em;
	}
	/* The kit's eyebrow, in em so it scales with the block. */
	.label {
		color: var(--color-muted);
		font-size: 0.625em;
		/* Tighter than the kit's 0.2em, so “Free ride · <road>” fits beside
		   the clock in the shell's 320 px. */
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.clock {
		font-size: 0.75em;
	}
	.unit {
		font-size: 0.5em;
	}
	/* A larger window (#3857) scales the same rows from the window's height:
	   at 11cqh the watts' numerals stand about a quarter of it tall and every
	   word meets SPEC's HUD column (docs/SPEC.md, "The bike computer"). The
	   shell's 2.4 : 1 proportion would bind on the width of any ordinary
	   screen, so here the block is as wide as its numbers, at least 12em, and
	   the cave centres it as one unit; every state shares that left edge.
	   14em holds the widest row (four-digit watts beside a four-digit
	   target), so a narrower window shrinks the block whole, never clips it. */
	@container (min-width: 480px) and (min-height: 200px) {
		.hud {
			font-size: min(11cqh, 100cqw / 14);
			width: auto;
			min-width: 12em;
			height: auto;
			padding: 0;
		}
		/* Leading of one: the clock's line box would otherwise carry its
		   half-leading above the label, and the block would sit low. */
		.rows {
			line-height: 1;
		}
		/* The label keeps the shell's share of the block; a road's name that
		   outgrows the width the numbers set wraps onto a second line rather
		   than vanish into an ellipsis. */
		.label {
			line-height: 1.25;
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			white-space: normal;
		}
		/* SPEC's time-left floor, kept when the width binds the block. */
		.clock {
			font-size: max(0.75em, 9cqh);
		}
	}
</style>
