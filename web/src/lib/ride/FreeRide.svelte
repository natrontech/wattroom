<script lang="ts">
	// The free ride (ADR-0059): the channel's riding surface with no workout
	// and no session — you set the watts or the grade, stay in the call, and
	// End ride saves it like any ride. ADR-0046's one surface: the same
	// instrument and secondary row a session draws, with the rider's own
	// control where the workout's target would be.
	import { onMount } from 'svelte';
	import { useChannel } from '$lib/channel/context';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { ridePath } from '$lib/channel/address';
	import { liveSessionId } from '$lib/channel/tick-session';
	import { formatClock } from '$lib/format';
	import Instrument from '$lib/session/Instrument.svelte';
	import SecondaryRow from '$lib/session/SecondaryRow.svelte';
	import SessionControls from '$lib/session/SessionControls.svelte';
	import TrainerOverview from '$lib/session/TrainerOverview.svelte';
	import { trainerTargetsNote } from '$lib/session/sensor-status';
	import { deviceWord } from '$lib/device.svelte';
	import { GRADE, WATTS, type FreeMode } from '$lib/ride/free-ride.svelte';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Radio from '@lucide/svelte/icons/radio';

	const channel = useChannel();
	const conn = $derived(channelConnection.current);
	const free = $derived(conn?.freeRide);
	onMount(() => channelConnection.current?.freeRide.arm());

	const targetsNote = $derived(
		trainerTargetsNote(channel.pairing, deviceWord()),
	);
	const watts = $derived(free?.mode === 'watts');
	const value = $derived(
		watts ? `${free?.watts ?? 0} W` : `${(free?.grade ?? 0).toFixed(1)} %`,
	);
	const atMin = $derived(
		watts ? free?.watts === WATTS.min : free?.grade === GRADE.min,
	);
	const atMax = $derived(
		watts ? free?.watts === WATTS.max : free?.grade === GRADE.max,
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
	const modes: { id: FreeMode; label: string }[] = [
		{ id: 'grade', label: 'Grade' },
		{ id: 'watts', label: 'Watts' },
	];
</script>

<div class="page flex h-full min-h-0 flex-col gap-6 overflow-y-auto pb-20">
	<header class="flex flex-wrap items-center gap-3">
		<p class="eyebrow">free ride</p>
		<span class="font-display text-2xl font-bold tabular-nums"
			>{formatClock(free?.seconds ?? 0)}</span
		>
		{#if !channel.trainer || targetsNote}<TrainerOverview compact />{/if}
		<div class="ml-auto flex flex-wrap items-center gap-2">
			<SessionControls compact />
			{#if free?.recording}
				<button
					onclick={() => void free?.end()}
					disabled={free?.saving}
					class="btn btn-primary btn-lg">End ride</button
				>
			{/if}
		</div>
	</header>

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

	{#if !riding}
		<section class="grid content-center gap-6">
			<Instrument
				watts={channel.you.watts}
				target={watts ? (free?.watts ?? 0) : 0}
				ftp={channel.you.ftp}
			/>
			<div class="flex flex-wrap items-center justify-center gap-4">
				<div
					class="border-muted/20 flex rounded-lg border p-1"
					role="group"
					aria-label="what you set"
				>
					{#each modes as mode (mode.id)}
						<button
							onclick={() => free?.setMode(mode.id)}
							aria-pressed={free?.mode === mode.id}
							class="btn btn-lg {free?.mode === mode.id
								? 'btn-secondary'
								: 'btn-ghost'}">{mode.label}</button
						>
					{/each}
				</div>
				<div class="flex items-center gap-3">
					<button
						onclick={() => free?.nudge(-1)}
						disabled={atMin}
						class="btn btn-secondary btn-lg"
						aria-label={watts ? 'fewer watts' : 'lower grade'}
						><Minus size={18} /></button
					>
					<span
						class="font-display w-28 text-center text-3xl font-bold tabular-nums"
						aria-live="polite">{value}</span
					>
					<button
						onclick={() => free?.nudge(1)}
						disabled={atMax}
						class="btn btn-secondary btn-lg"
						aria-label={watts ? 'more watts' : 'steeper grade'}
						><Plus size={18} /></button
					>
				</div>
			</div>
			<SecondaryRow
				cadence={channel.you.cadence}
				hr={channel.you.hr}
				watts={channel.you.watts}
				kg={channel.you.kg}
				lthr={conn?.profile.current.lthr}
			/>
		</section>

		{#if free?.saving}
			<p class="text-muted text-sm" role="status">Saving your free ride…</p>
		{:else if free?.outcome && 'saved' in free.outcome}
			<p class="text-sm" role="status">
				Saved. <a href="/history/{free.outcome.saved.id}" class="underline"
					>See it in your history</a
				> — and on Strava, if you connected it.
			</p>
		{:else if free?.outcome && 'failure' in free.outcome}
			<p class="text-danger text-sm" role="alert">
				It did not save — {free.outcome.failure.message} It is kept on this device,
				and <a href="/ride" class="underline">Ride</a> offers it again.
			</p>
		{:else if free?.outcome && 'short' in free.outcome}
			<p class="text-muted text-sm" role="status">
				Under a minute — nothing to save.
			</p>
		{:else if !free?.recording}
			<p class="text-muted text-sm">
				Pedal to start. It records while you ride and saves when you press End
				ride — you stay in the call the whole time.
			</p>
		{/if}
	{/if}
</div>
