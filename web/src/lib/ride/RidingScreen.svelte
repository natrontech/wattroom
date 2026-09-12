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
	import Flag from '@lucide/svelte/icons/flag';
	import RideStatus from '$lib/ride/RideStatus.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import Instrument from '$lib/room/Instrument.svelte';
	import RideHeader from '$lib/room/RideHeader.svelte';
	import SecondaryRow from '$lib/room/SecondaryRow.svelte';
	import SprintMoment from '$lib/room/SprintMoment.svelte';
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
		watts,
		target,
		signalLost,
		noCrashSafety = false,
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
		watts: number;
		target: number;
		signalLost: boolean;
		/** Nothing is writing this ride down (#1466) — RideStatus says so. */
		noCrashSafety?: boolean;
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
</script>

<!-- The bottom padding is the floating navigation button's (ux.md: the last
     item clears the chrome); on a desk there is no such button. -->
<div class="flex min-h-0 flex-1 flex-col pb-16 sm:pb-0">
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
			<!-- Wraps rather than shrinking (#1634): at 375 px the cluster ran 39
			     px past the viewport and the ⚑ — the last button — could not be
			     reached at all. -->
			<div class="flex flex-wrap items-center justify-end gap-2">
				<!-- The kit's riding size (ux.md: btn-lg is the 44 px a rider hits
				     while pedalling); these used to retype the chrome by hand. -->
				<button
					onclick={() => session.extend(60)}
					class="btn btn-secondary btn-lg">+1 min</button
				>
				<!-- Nothing to skip to on the last block: disabled with the
				     reason, never a click that does nothing (ux.md, #1799). -->
				<button
					onclick={() => session.skip()}
					disabled={session.info.segmentIndex + 1 >= session.segments.length}
					title={session.info.segmentIndex + 1 >= session.segments.length
						? 'Last block — End ride instead'
						: undefined}
					class="btn btn-secondary btn-lg disabled:opacity-40"
					>Skip block</button
				>
				<button onclick={onTv} class="btn btn-secondary btn-lg">TV</button>
				<button onclick={() => session.stop()} class="btn btn-secondary btn-lg"
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

	<!-- Ride-critical states are persistent status, never toasts
	     (.claude/rules/errors.md); the way back from a dropout is the
	     status's own button, wired to this ride's trainer (#1847). -->
	<RideStatus {session} {signalLost} {noCrashSafety} />

	<!-- The focus slot takes the free height rather than sitting under the
	     header with a screen of nothing below it (#1531: "two thirds empty"). -->
	<section class="grid min-h-0 flex-1 content-center">
		{#if session.sprint}
			<!-- A sprint block takes the focus, solo as in a room (#1793,
			     ADR-0046): the count-in, the window and your watts, where the
			     instrument used to read "no target — spin easy" for fifteen
			     seconds of all-out. No roster: nobody else is here. -->
			<SprintMoment sprint={session.sprint} myWatts={watts} />
		{:else}
			<Instrument {watts} {target} {ftp} />
		{/if}
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
