<script lang="ts">
	// The free ride (ADR-0059): the channel's riding surface with no workout
	// and no session — you set the watts or the grade, stay in the call, and
	// End ride saves it like any ride. ADR-0046's one surface: the riding
	// surface a road free ride draws (FreeRiding, #3669), with the rider's
	// own control where the workout's transport would be.
	import { onDestroy, onMount, untrack } from 'svelte';
	import { useChannel } from '$lib/channel/context';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { ridePath } from '$lib/channel/address';
	import { liveSessionId } from '$lib/channel/tick-session';
	import Banner from '$lib/components/Banner.svelte';
	import HrShare from '$lib/channel/HrShare.svelte';
	import SessionControls from '$lib/session/SessionControls.svelte';
	import TrainerOverview from '$lib/session/TrainerOverview.svelte';
	import { trainerTargetsNote } from '$lib/session/sensor-status';
	import { deviceWord } from '$lib/device.svelte';
	import { createRideFlags } from '$lib/ride/flags.svelte';
	import FreeRiding from '$lib/ride/FreeRiding.svelte';
	import FreeRideTv from '$lib/ride/FreeRideTv.svelte';
	import { freeRideLabel } from '$lib/ride/free-ride.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { createGhostSplit } from '$lib/ride/ghost-split.svelte';
	import RoadPick from '$lib/ride/RoadPick.svelte';
	import { createRoadMates, rideWith } from '$lib/channel/road-mates';
	import Radio from '@lucide/svelte/icons/radio';

	const channel = useChannel();
	const conn = $derived(channelConnection.current);
	const free = $derived(conn?.freeRide);
	onMount(() => channelConnection.current?.freeRide.arm());

	const targetsNote = $derived(
		trainerTargetsNote(channel.pairing, deviceWord()),
	);
	// A session beside you (ADR-0059): it leaves your trainer alone until you
	// join, and joining saves this ride first.
	const session = $derived(
		channel.phase !== 'lounge'
			? liveSessionId(conn?.live.tick?.state)
			: undefined,
	);
	// Riding the session instead: the trainer follows it, so the controls
	// here would set nothing.
	const riding = $derived(!!session && channel.you.inSession);
	// Your ghost on your own road, raced alone — never in a session (#3615,
	// ADR-0068), and only from the road's start: never after riding in at a
	// mate's metre (#3117).
	const ghost = createGhostSplit(() =>
		riding || (free?.road?.from ?? 0) > 0 ? null : free,
	);
	// Channel-mates free-riding your road (#3117): the hub puts them on it.
	const roadMates = createRoadMates();
	const mates = $derived(
		free?.road
			? roadMates(conn?.live.tick, channel.riders, channel.you.id)
			: [],
	);

	// The ⚑ as a workout ride has it (#3894): the channel's own recorder
	// ticks from pairing on, so the ride only marks where it began; flags go
	// out when the page does, or when the ride ends.
	const flags = createRideFlags(channel.address.training, channel.recorder);
	let tv = $state(false);
	let began = untrack(() => !!free?.recording);
	$effect(() => {
		const recording = !!free?.recording;
		untrack(() => {
			if (recording && !began) {
				began = true;
				flags.riding(channel.trainerName || 'none', freeRideLabel(free?.road));
			} else if (!recording && began) {
				began = false;
				tv = false;
				flags.flush();
			}
		});
	});
	onDestroy(() => flags.flush());
</script>

{#snippet controls()}
	<!-- "Ride with <name>" (#3117): one jump to a channel-mate's metre on
	     your road, their way, then ride freely. -->
	{#each mates as mate (mate.id)}
		{@const jump = mate.name ? rideWith(mate, free) : null}
		{#if jump}
			<button onclick={jump} class="btn btn-secondary btn-ride"
				>Ride with {mate.name}</button
			>
		{/if}
	{/each}
	<SessionControls compact />
	<!-- Your own workout, beside anything running here (#2329): the same
	     picker, the ride-alone lifecycle. It needs the trainer to hold
	     its targets, so without one it says so rather than failing. -->
	{#if !riding}
		{#if !channel.trainer}<span
				id="free-ride-workout-hint"
				class="text-muted text-xs">Pair your trainer first</span
			>{/if}
		<button
			onclick={() => channel.openPicker('ride')}
			disabled={!channel.trainer}
			aria-describedby={channel.trainer ? undefined : 'free-ride-workout-hint'}
			class="btn btn-secondary btn-ride disabled:opacity-40"
			>Ride a workout</button
		>
	{/if}
{/snippet}

{#snippet setup()}
	{#if !channel.trainer || targetsNote}<TrainerOverview compact />{/if}
	{#if free}
		<RoadPick {free} />
	{/if}
	<!-- Armed, not yet ridden: one line on what happens — the setup is not
	     the ride yet. -->
	<p class="text-muted text-2xl leading-6">
		Pedal to start. It records while you ride and saves when you press End ride
		— you stay in the call the whole time.
	</p>
{/snippet}

{#snippet foot()}
	<!-- A free ride shows the call your numbers (ADR-0059), heart rate
	     included, so it says so under them (ADR-0008, #2804). -->
	<HrShare ride class="px-4 pb-3" />
{/snippet}

<svelte:window
	onkeydown={(e) => e.key === 'Escape' && (tv = false)}
	onpagehide={() => flags.flush(true)}
/>

<div class="page flex h-full min-h-0 flex-col gap-6 overflow-y-auto pb-20">
	{#if conn?.ownRide.error}
		<Banner tone="error">{conn.ownRide.error}</Banner>
	{/if}

	{#if riding}
		<!-- In the session already: its screen is where the ride is, and the
		     trainer follows it rather than anything set here. -->
		<div
			class="border-muted/20 flex flex-wrap items-center gap-3 rounded-lg border p-3"
		>
			<p class="text-sm">
				You're riding <strong
					>{channel.shared?.workoutName || 'the session'}</strong
				> here. Leave the ride on its screen to free-ride instead.
			</p>
			<div class="ml-auto flex flex-wrap items-center gap-2">
				<SessionControls compact />
				<a
					href={ridePath(channel.address, session)}
					class="btn btn-accent btn-ride"><Radio size={15} /> Go to the ride</a
				>
			</div>
		</div>
	{:else if session}
		<div
			class="border-muted/20 flex flex-wrap items-center gap-3 rounded-lg border p-3"
		>
			<p class="text-sm">
				{channel.shared?.coachName || 'Someone'} is running
				<strong>{channel.shared?.workoutName || 'a session'}</strong> here. It leaves
				your trainer alone; joining saves this ride first.
			</p>
			<a
				href={ridePath(channel.address, session)}
				class="btn btn-accent btn-ride ml-auto"
				><Radio size={15} /> Join the ride</a
			>
		</div>
	{/if}

	{#if !riding && free && conn}
		<FreeRiding
			{free}
			watts={channel.you.watts}
			cadence={channel.you.cadence}
			hr={channel.you.hr}
			kg={channel.you.kg}
			lthr={conn.profile.current.lthr}
			ftp={channel.you.ftp}
			stale={channel.youStale}
			idle={channel.youUnmeasured}
			gear={gearsEnabled() ? conn.ride.gear : undefined}
			shift={conn.shift}
			shiftOff={conn.ride.shiftOff}
			cassette={!conn.profile.current.singleSpeed}
			{ghost}
			onend={free.recording ? () => void free?.end() : undefined}
			ending={free.saving}
			{controls}
			{setup}
			{foot}
			onflag={() => flags.recorder.flag()}
			ontv={() => (tv = true)}
			worldClass="-mx-4 -my-6 sm:-mx-8 sm:-my-8"
			mates={() => mates}
		/>
		{#if tv}
			<FreeRideTv
				{free}
				rider={channel.you}
				ftp={channel.you.ftp}
				placeName={freeRideLabel(free.road)}
				onExit={() => (tv = false)}
			/>
		{/if}

		{#if ghost.newBest && !free.recording}
			<!-- Your best beaten, end to end (#3246): a record, so the neon ramp (G2). -->
			<p
				data-testid="new-best"
				class="font-display text-neon text-lg font-bold"
			>
				{ghost.newBest}
			</p>
		{/if}
		{#if free.saving}
			<p class="text-muted text-sm" role="status">Saving your free ride…</p>
		{:else if free.outcome && 'saved' in free.outcome}
			<p class="text-sm" role="status">
				Saved. <a href="/history/{free.outcome.saved.id}" class="underline"
					>See it in your history</a
				> — and on Strava, if you connected it.
			</p>
		{:else if free.outcome && 'failure' in free.outcome}
			<p class="text-danger text-sm" role="alert">
				It did not save — {free.outcome.failure.message} It is kept on this device,
				and <a href="/ride" class="underline">Ride</a> offers it again.
			</p>
		{:else if free.outcome && 'short' in free.outcome}
			<p class="text-muted text-sm" role="status">
				Under a minute — nothing to save.
			</p>
		{/if}
	{/if}
</div>
