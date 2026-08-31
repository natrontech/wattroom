<script lang="ts">
	import { formatClock, ZONE_TEXT, zoneOf } from '../room/mockRoom.svelte';

	// docs/SPEC.md: start 100 W (default), +20 W/min, FTP = 75 % of best 1-min power.
	const START = 100;
	const STEP = 20;

	let elapsed = $state(0);
	let watts = $state(0);
	let running = $state(false);
	let done = $state(false);
	let best1min = $state(0);

	const minute = $derived(Math.floor(elapsed / 60));
	const target = $derived(START + minute * STEP);
	const secondsToStep = $derived(60 - (elapsed % 60));
	const estimatedFtp = $derived(Math.round(best1min * 0.75));

	$effect(() => {
		if (!running) return;
		const timer = setInterval(() => {
			elapsed += 1;
			// The rider holds the step until they can't; failure is the measurement.
			const fade = elapsed > 720 ? (elapsed - 720) / 90 : 0;
			watts = Math.max(
				0,
				Math.round(target * (1 - fade) + (Math.random() * 8 - 4)),
			);
			best1min = Math.max(best1min, target - 6);
			if (watts < target * 0.75) {
				running = false;
				done = true;
			}
		}, 250);
		return () => clearInterval(timer);
	});

	function reset() {
		elapsed = 0;
		watts = 0;
		best1min = 0;
		done = false;
		running = true;
	}
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">Ramp test</h1>
	<p class="text-muted mt-2 max-w-xl text-sm">
		The one workout whose point is to end. Starts at {START} W, adds {STEP} W every
		minute, and stops when you can't hold the step. Your FTP is 75 % of your best
		minute.
	</p>

	{#if !running && !done}
		<div
			class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-8 text-center"
		>
			<p class="text-sm">
				About 12–18 minutes, and the last two are unpleasant.
			</p>
			<p class="text-muted mx-auto mt-2 max-w-md text-xs leading-relaxed">
				Ride each minute at the number shown. When you can't hold it any more,
				stop pedalling — stopping is the measurement, not a failure.
			</p>
			<button
				onclick={reset}
				class="bg-ink text-paper hover:bg-ink/90 mt-6 rounded px-5 py-3 text-sm font-semibold"
				>Start ramp test</button
			>
		</div>
	{:else if running}
		<div class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-8">
			<div class="flex items-end justify-between gap-6">
				<div>
					<div class="flex items-baseline gap-2">
						<span
							class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
							>{watts}</span
						>
						<span class="text-muted text-xl">W</span>
					</div>
					<p class="text-muted mt-2 text-[10px] tracking-wider uppercase">
						your power
					</p>
				</div>
				<div class="text-right">
					<div
						class="font-display text-4xl leading-none font-bold tabular-nums"
					>
						{target}
					</div>
					<p class="text-muted mt-2 text-[10px] tracking-wider uppercase">
						hold this
					</p>
				</div>
			</div>

			<div class="mt-8 flex items-center justify-between text-sm">
				<span class="text-muted">Step {minute + 1}</span>
				<span class="font-mono tabular-nums">{formatClock(elapsed)}</span>
				<span class="text-muted">+{STEP} W in {secondsToStep}s</span>
			</div>
			<div class="bg-surface mt-2 h-1.5 overflow-hidden rounded-full">
				<div
					class="bg-neon h-full transition-[width] duration-300"
					style="width: {((60 - secondsToStep) / 60) * 100}%"
				></div>
			</div>
		</div>
	{:else}
		<div class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-8">
			<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
				your new FTP
			</p>
			<div class="mt-2 flex items-baseline gap-2">
				<span
					class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
					>{estimatedFtp}</span
				>
				<span class="text-muted text-xl">W</span>
			</div>
			<p class="text-muted mt-4 text-xs leading-relaxed">
				Best minute was {best1min} W, and FTP is 75 % of that. You lasted {formatClock(
					elapsed,
				)} —
				{minute + 1} steps. Every workout you ride from here scales to this number.
			</p>
			<p class="mt-3 text-sm">
				That's <span class={ZONE_TEXT[zoneOf(estimatedFtp, estimatedFtp)]}
					>{(estimatedFtp / 74).toFixed(2)} w/kg</span
				> at 74 kg.
			</p>
			<div class="mt-6 flex gap-2">
				<button
					class="bg-ink text-paper hover:bg-ink/90 rounded px-4 py-2.5 text-sm font-medium"
					>Save {estimatedFtp} W</button
				>
				<button
					onclick={reset}
					class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2.5 text-sm"
					>Test again</button
				>
			</div>
		</div>
	{/if}
</main>
