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
	 *
	 * ADR-0046: the slots below are the room's Training place, in the same
	 * order, minus the crew. Which block this is, how long is left, what is
	 * coming next, rpm and bpm at a size that survives three metres — all of it
	 * comes from the components the room draws, because a rider alone deserves
	 * the screen a rider in a room gets.
	 */
	import { publishHud } from '$lib/hud/feed';
	import Flag from '@lucide/svelte/icons/flag';
	import Banner from '$lib/components/Banner.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import Instrument from '$lib/room/Instrument.svelte';
	import RideHeader from '$lib/room/RideHeader.svelte';
	import SecondaryRow from '$lib/room/SecondaryRow.svelte';
	import type { Block } from '$lib/room/view';
	import type { createRideSession } from '$lib/workout/session.svelte';
	import type { Workout } from '$lib/workout/types';

	let {
		session,
		block,
		workout,
		ftp,
		kg,
		lthr,
		remaining,
		watts,
		target,
		signalLost,
		onFlag,
		onTv,
	}: {
		session: ReturnType<typeof createRideSession>;
		/** Where you are in the work, from the page — the TV draws the same one. */
		block: Block | null;
		workout: Workout;
		ftp: number;
		/** For w/kg — the stat every rider in a room carries and this one did not. */
		kg: number;
		/** Yours, for your own bpm's zone colour (ADR-0014). */
		lthr?: number;
		/** Seconds left in the whole session — the HUD's number, not the header's. */
		remaining: number;
		watts: number;
		target: number;
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

<div class="flex min-h-0 flex-1 flex-col">
	<RideHeader
		{block}
		elapsed={session.elapsed}
		total={session.total}
		cadence={session.sample?.cadence ?? 0}
		hr={session.sample?.heartRate ?? 0}
		title={workout.name}
	>
		{#snippet controls()}
			<!-- Rider controls: big targets, no precision needed (ux.md). The
			     room's coach controls sit in this same slot; the bias trim is not
			     here, because it belongs with the numbers it trims. -->
			<div class="flex shrink-0 items-center gap-2">
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
		{/snippet}
	</RideHeader>

	<!-- Ride-critical states are persistent status, never toasts (.claude/rules/errors.md). -->
	{#if session.state === 'autopaused'}
		<div class="border-z5/40 bg-z5/10 mt-4 rounded-lg border px-5 py-3">
			<p class="text-sm font-medium">Paused — you stopped pedalling</p>
			<p class="text-muted text-xs">
				Your targets are released and this time is excluded from your score.
				Start pedalling to pick up where you left off.
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
				Your cadence collapsed under the target, so it is released until you
				spin back up. This is deliberate, not a dropout.
			</p>
		</div>
	{/if}

	{#if signalLost}
		<div class="mt-4">
			<Banner tone="error"
				>Trainer signal lost — reconnecting. Keep pedalling; your targets resume
				the moment it is back.</Banner
			>
		</div>
	{/if}

	<!-- The focus slot takes the free height rather than sitting under the
	     header with a screen of nothing below it (#1531: "two thirds empty"). -->
	<section class="grid min-h-0 flex-1 content-center">
		<Instrument {watts} {target} {ftp} />
	</section>

	<SecondaryRow
		cadence={session.sample?.cadence ?? 0}
		hr={session.sample?.heartRate ?? 0}
		{watts}
		{kg}
		{lthr}
		bias={session.bias}
		execution={session.scored ? session.execution : undefined}
		onBias={(step) => session.nudgeBias(step)}
	/>

	{#if flagNotice}
		<!-- Consent in plain words, at the moment of the tap, never blocking. -->
		<p class="text-muted mt-2 text-xs">
			Flagged — after the ride this sends your last two minutes of ride data and
			logs to the developers. Only yours, nobody else's.
		</p>
	{/if}

	<div class="mt-4 h-28 shrink-0">
		<IntervalGraph
			segments={session.segments}
			total={session.total}
			elapsed={session.elapsed}
			{ftp}
			trace={session.trace}
		/>
	</div>
</div>
