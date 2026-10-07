<script lang="ts">
	// The free ride (ADR-0059): the channel's riding surface with no workout
	// and no session — you set the watts or the grade, stay in the call, and
	// End ride saves it like any ride. ADR-0046's one surface: the riding
	// surface a road free ride draws (FreeRiding, #3669), with the rider's
	// own control where the workout's transport would be.
	import { onMount } from 'svelte';
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
	import FreeRiding from '$lib/ride/FreeRiding.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { createGhostSplit } from '$lib/ride/ghost-split.svelte';
	import RoadPick from '$lib/ride/RoadPick.svelte';
	import { roadsEnabled } from '$lib/ride/roads';
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
	// ADR-0068).
	const ghost = createGhostSplit(() => (riding ? null : free));
</script>

{#snippet controls()}
	<SessionControls compact />
	<!-- Your own workout, beside anything running here (#2329): the same
	     picker, the ride-alone lifecycle. It needs the trainer to hold
	     its targets, so without one it says so rather than failing. -->
	{#if !riding}
		<button
			onclick={() => channel.openPicker('ride')}
			disabled={!channel.trainer}
			title={channel.trainer ? undefined : 'Pair your trainer first'}
			class="btn btn-secondary btn-lg disabled:opacity-40"
			>Ride a workout</button
		>
	{/if}
{/snippet}

{#snippet setup()}
	{#if !channel.trainer || targetsNote}<TrainerOverview compact />{/if}
	{#if free && roadsEnabled()}
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
	<HrShare class="px-4 pb-3" />
{/snippet}

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
			<a
				href={ridePath(channel.address, session)}
				class="btn btn-accent btn-lg ml-auto"
				><Radio size={15} /> Go to the ride</a
			>
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
				class="btn btn-accent btn-lg ml-auto"
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
			resetAt={conn.ride.gearResetAt}
			cassette={!conn.profile.current.singleSpeed}
			split={ghost.split ?? undefined}
			onend={free.recording ? () => void free?.end() : undefined}
			ending={free.saving}
			{controls}
			{setup}
			{foot}
			worldClass="-mx-4 -my-6 sm:-mx-8 sm:-my-8"
		/>

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
