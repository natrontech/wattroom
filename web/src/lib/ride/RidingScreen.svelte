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
	 * ADR-0046: the slots below are a voice channel's Training place, in the
	 * same order, minus the crew. Which block this is, how long is left, what
	 * is coming next, rpm and bpm at a size that survives three metres — all of
	 * it comes from the components a session draws, because a rider alone
	 * deserves the screen a rider in a session gets.
	 */
	import FlagButton from '$lib/ride/FlagButton.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { bindRideShift } from '$lib/ride/keys';
	import { confirm } from '$lib/confirm.svelte';
	import { FLAG_NOTICE_MS, FLAG_SAID } from '$lib/ride/flag';
	import RideStatus from '$lib/ride/RideStatus.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import Instrument from '$lib/session/Instrument.svelte';
	import RideHeader from '$lib/session/RideHeader.svelte';
	import RidingSurface from '$lib/session/RidingSurface.svelte';
	import BiasTrim from '$lib/session/BiasTrim.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import { worldSlotOn } from '$lib/world/flag';
	import SprintMoment from '$lib/session/SprintMoment.svelte';
	import type { Block } from '$lib/workout/block';
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
		/** For w/kg — the stat every rider in a session carries and this one did not. */
		kg: number;
		/** Yours, for your own bpm's zone colour (ADR-0014). */
		lthr?: number;
		watts: number;
		target: number;
		signalLost: boolean;
		/** Nothing is writing this ride down (#1466) — RideStatus says so. */
		noCrashSafety?: boolean;
		/** Absent where the page has its own ⚑ and TV — a voice channel's (#2329). */
		onFlag?: () => void;
		onTv?: () => void;
	} = $props();

	// The ⚑'s own acknowledgement (#52), and nothing outside this screen ever
	// asks about it.
	// End sits in the cluster with TV and Skip block, 44 px each, and a ride
	// it ends cannot be resumed — one stray thumb filed a truncated ride
	// (#2623). It asks, the way a session's End always has (errors.md).
	async function endRide() {
		const ok = await confirm({
			title: 'End the ride?',
			body: 'The rest of the workout cannot be resumed. What you have ridden is saved if it is a minute or longer.',
			action: 'End the ride',
			cancel: 'Keep riding',
		});
		if (ok) session.stop();
	}

	// Easier / Harder from the keys and any clicker, while this ride runs (#3329).
	$effect(() => (gearsEnabled() ? bindRideShift(session) : undefined));

	let flagNotice = $state(false);
	function flag() {
		onFlag?.();
		flagNotice = true;
		setTimeout(() => (flagNotice = false), FLAG_NOTICE_MS);
	}

	// The world in slot 2, where this device has it on (#3031): three.js comes
	// in its own chunk, and a world that will not start leaves the slots as
	// they were for the rest of the ride.
	let worldFailed = $state(false);
	const inWorld = $derived(worldSlotOn() && !worldFailed);
	const rideWorld = () =>
		import('$lib/world/RideWorld.svelte').catch((err: unknown) => {
			console.error('world: the renderer did not load', err);
			worldFailed = true;
			throw err;
		});

	// The HUD feed (ADR-0041): what this screen shows, once a second, for a
	// second window to mirror — the shell's overlay, or another tab.
</script>

<!-- The bottom padding is the floating navigation button's (ux.md: the last
     item clears the chrome); on a desk there is no such button. The slots are
     a session's (ADR-0046), minus the crew. -->
{#snippet rideControls()}
	<!-- Rider controls: big targets, no precision needed (ux.md). The
		     session's coach controls sit in this same slot; the bias trim is not
		     here, because it belongs with the numbers it trims. -->
	<!-- Wraps rather than shrinking (#1634): at 375 px the cluster ran 39
		     px past the viewport and the ⚑ — the last button — could not be
		     reached at all. -->
	<div class="flex flex-wrap items-center justify-end gap-2">
		<!-- The kit's riding size (ux.md: btn-lg is the 44 px a rider hits
			     while pedalling); these used to retype the chrome by hand. -->
		<!-- A road workout's blocks end at their metres (#3499): nothing to
		     skip or hold longer, and the reason said where they were. -->
		{#if session.road}
			<span class="text-muted text-xs"
				>The road decides where a block ends.</span
			>
		{:else}
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
				class="btn btn-secondary btn-lg disabled:opacity-40">Skip block</button
			>
		{/if}
		{#if onTv}
			<button onclick={onTv} class="btn btn-secondary btn-lg">TV</button>
		{/if}
		<button onclick={endRide} class="btn btn-secondary btn-lg">End ride</button>
		{#if onFlag}
			<FlagButton onflag={flag} sends="after" />
		{/if}
	</div>
{/snippet}

{#snippet road()}
	{#await rideWorld() then { default: RideWorld }}
		<RideWorld {watts} {ftp} onfail={() => (worldFailed = true)} />
	{/await}
{/snippet}

<RidingSurface class="flex-1 pb-16 sm:pb-0" world={inWorld ? road : undefined}>
	{#snippet header()}
		<div class={inWorld ? 'px-4 py-2' : ''}>
			<RideHeader
				{block}
				elapsed={session.elapsed}
				total={session.total}
				cadence={session.sample?.cadence ?? 0}
				hr={session.sample?.heartRate ?? 0}
				title={workout.name}
				erg
				controls={inWorld ? undefined : rideControls}
			/>
		</div>
	{/snippet}

	{#snippet status()}
		{#if inWorld}
			<!-- On the road the header keeps to the band above it, and the
			     controls stand in the column beneath. -->
			<div class="p-3">{@render rideControls()}</div>
		{/if}
		<!-- Ride-critical states are persistent status, never toasts
		     (.claude/rules/errors.md); the way back from a dropout is the
		     status's own button, wired to this ride's trainer (#1847). -->
		<RideStatus {session} {signalLost} {noCrashSafety} />
	{/snippet}

	{#snippet focus()}
		<!-- The focus slot takes the free height rather than sitting under the
		     header with a screen of nothing below it (#1531: "two thirds empty"). -->
		<!-- On the road the world has the focus, and your watts sit with your numbers. -->
		{#if !inWorld || session.sprint}
			<section class="grid min-h-0 content-center">
				{#if session.sprint}
					<!-- A sprint block takes the focus, solo as in a session (#1793,
				     ADR-0046): the count-in, the window and your watts, where the
				     instrument used to read "no target — spin easy" for fifteen
				     seconds of all-out. No roster: nobody else is here. -->
					<SprintMoment sprint={session.sprint} myWatts={watts} />
				{:else}
					<Instrument {watts} {target} {ftp} stale={signalLost} />
				{/if}
			</section>
		{/if}
	{/snippet}

	{#snippet numbers()}
		{#if inWorld && !session.sprint}
			<Instrument {watts} {target} {ftp} stale={signalLost} compact />
		{/if}
		<div class="flex flex-wrap items-end gap-4">
			<div class="min-w-0 flex-1">
				<BikeComputer
					cadence={session.sample?.cadence ?? 0}
					stale={signalLost}
					hr={session.sample?.heartRate ?? 0}
					{watts}
					{kg}
					{lthr}
					execution={session.scored ? session.execution : undefined}
					target={target > 0 ? target : undefined}
					stats={session.live}
				/>
			</div>
			<BiasTrim
				bias={session.bias}
				onBias={(step) => session.nudgeBias(step)}
			/>
		</div>

		{#if flagNotice}
			<!-- Consent in plain words, at the moment of the tap, never blocking. -->
			<p class="text-muted mt-2 text-xs">{FLAG_SAID.after}</p>
		{/if}
	{/snippet}

	{#snippet horizon()}
		<div class={inWorld ? 'h-full' : 'mt-4 h-28 shrink-0'}>
			<IntervalGraph
				segments={session.segments}
				total={session.total}
				elapsed={session.elapsed}
				{ftp}
				trace={session.trace}
			/>
		</div>
	{/snippet}
</RidingSurface>
