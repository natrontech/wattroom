<script lang="ts">
	/**
	 * The ride itself (#1057): what you are holding, how far in, and the handful
	 * of controls a rider can hit at arm's length without looking.
	 *
	 * The other half of the two screens this page was. Like `PreRide`, it owns
	 * no ride state — the page keeps the session, because ending it, saving it
	 * and the summary all belong to the page. The one thing this DOES own is
	 * the flag notice, which is four seconds of its own chrome and nothing
	 * else's business.
	 */
	import { publishHud } from '$lib/hud/feed';
	import Flag from '@lucide/svelte/icons/flag';
	import Logo from '$lib/brand/Logo.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { formatClock } from '$lib/format';
	import Instrument from '$lib/room/Instrument.svelte';
	import { createRideSession, DEFAULTS } from '$lib/workout/session.svelte';
	import type { Workout } from '$lib/workout/types';

	let {
		session,
		workout,
		ftp,
		remaining,
		watts,
		target,
		readouts,
		bands,
		signalLost,
		onFlag,
		onTv,
	}: {
		session: ReturnType<typeof createRideSession>;
		workout: Workout;
		ftp: number;
		/** Seconds left in the whole session. */
		remaining: number;
		watts: number;
		target: number;
		/** The secondary numbers beside the instrument — rpm, bpm, and so on. */
		readouts: { label: string; value: string; tone: string }[];
		/** Cadence and heart-rate targets for this block, when it names any. */
		bands: { text: string; inBand: boolean }[];
		signalLost: boolean;
		onFlag: () => void;
		onTv: () => void;
	} = $props();

	// The ⚑'s own acknowledgement (#52), and nothing outside this screen ever
	// asks about it.
	let flagNotice = $state(false);
	function flag() {
		onFlag();
		flagNotice = true;
		setTimeout(() => (flagNotice = false), 4000);
	}

	// The HUD feed (ADR-0041): what this screen shows, once a second, for a
	// second window to mirror — the shell's overlay, or another tab.
	$effect(() => {
		publishHud({ watts, target, remaining, label: workout.name });
	});
</script>

<header class="flex items-center gap-4">
	<Logo size={26} live={session.state === 'running'} />
	<div>
		<p class="font-display leading-tight font-bold">{workout.name}</p>
		<p class="text-muted text-xs">
			{session.info.segment?.kind ?? ''} · FTP {ftp} W
		</p>
	</div>
	<div class="ml-auto text-right">
		<div class="font-display text-2xl leading-none font-bold tabular-nums">
			{formatClock(remaining)}
		</div>
		<div class="eyebrow">remaining</div>
	</div>
</header>

<!-- Ride-critical states are persistent status, never toasts (.claude/rules/errors.md). -->
{#if session.state === 'autopaused'}
	<div class="border-z5/40 bg-z5/10 mt-4 rounded-lg border px-5 py-3">
		<p class="text-sm font-medium">Paused — you stopped pedalling</p>
		<p class="text-muted text-xs">
			Your targets are released and this time is excluded from your score. Start
			pedalling to pick up where you left off.
		</p>
	</div>
{:else if session.state === 'resuming'}
	<div
		class="border-neon/40 bg-surface-raised mt-4 flex items-center gap-4 rounded-lg border px-5 py-3"
	>
		<span
			class="text-watt glow-text-strong font-display text-3xl font-bold tabular-nums"
			>{session.resumeIn}</span
		>
		<p class="text-sm">Picking back up — ease in.</p>
	</div>
{:else if session.spiralActive}
	<div
		class="border-neon/40 bg-surface-raised mt-4 rounded-lg border px-5 py-3"
	>
		<p class="text-sm font-medium">Spiral guard</p>
		<p class="text-muted text-xs">
			Your cadence collapsed under the target, so it is released until you spin
			back up. This is deliberate, not a dropout.
		</p>
	</div>
{/if}

<!-- The same instrument the room uses (ADR-0020, #386). These were two
     designs for one activity: a number beside a bar here, a needle over
     a tolerance band there. The number travels with your power now, so
     "left or right of the bright slot" reads before any digit does. -->
<section class="mt-4">
	<Instrument {watts} {target} {ftp} />
	{#if bands.length > 0}
		<p class="text-muted mt-2 text-center text-xs">
			{#each bands as b (b.text)}
				<!-- The band is this block's point; colour answers "am I doing it". -->
				<span class="{b.inBand ? 'text-z4' : 'text-z5'} font-semibold"
					>at {b.text}</span
				>
			{/each}
		</p>
	{/if}
</section>

<div class="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3">
	{#each readouts as readout (readout.label)}
		<div>
			<span
				class="font-display text-xl leading-none font-semibold tabular-nums {readout.tone}"
				>{readout.value}</span
			>
			<span class="eyebrow ml-1">{readout.label}</span>
		</div>
	{/each}

	<!-- Rider controls: big targets, no precision needed (.claude/rules/ux.md). -->
	<div class="ml-auto flex items-center gap-2">
		<button
			onclick={() => session.nudgeBias(-DEFAULTS.biasStep)}
			class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded border text-lg"
			aria-label="Lower intensity">−</button
		>
		<div class="w-16 text-center">
			<div class="font-display text-sm leading-none font-bold tabular-nums">
				{Math.round(session.bias * 100)}%
			</div>
			<div class="eyebrow">bias</div>
		</div>
		<button
			onclick={() => session.nudgeBias(DEFAULTS.biasStep)}
			class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded border text-lg"
			aria-label="Raise intensity">+</button
		>
		<button
			onclick={() => session.extend(60)}
			class="border-muted/25 hover:border-muted/60 h-11 rounded border px-4 text-sm"
			>+1 min</button
		>
		<button
			onclick={() => session.skip()}
			class="border-muted/25 hover:border-muted/60 h-11 rounded border px-4 text-sm"
			>Skip block</button
		>
		<button
			onclick={onTv}
			class="border-muted/25 text-muted hover:border-muted/60 hover:text-ink h-11 rounded border px-4 text-sm"
			>TV</button
		>
		<button
			onclick={() => session.stop()}
			class="border-muted/25 text-muted hover:border-muted/60 hover:text-ink h-11 rounded border px-4 text-sm"
			>End ride</button
		>
		<!-- The ⚑ (#52): one tap, no dialog, keep pedalling. -->
		<button
			onclick={flag}
			class="border-neon/40 text-neon hover:bg-neon/10 grid h-11 w-14 place-items-center rounded border"
			aria-label="Flag a problem"><Flag size={18} /></button
		>
	</div>
	{#if signalLost}
		<div class="mt-2">
			<Banner tone="error"
				>Trainer signal lost — reconnecting. Keep pedalling; your targets resume
				the moment it is back.</Banner
			>
		</div>
	{/if}
	{#if flagNotice}
		<!-- Consent in plain words, at the moment of the tap, never blocking. -->
		<p class="text-muted mt-2 text-xs">
			Flagged — after the ride this sends your last two minutes of ride data and
			logs to the developers. Only yours, nobody else's.
		</p>
	{/if}
</div>

<div class="panel mt-3 overflow-hidden">
	<IntervalGraph
		segments={session.segments}
		total={session.total}
		elapsed={session.elapsed}
		{ftp}
		trace={session.trace}
	/>
</div>
