<script lang="ts">
	// The session's surface (#2450): the Training place — instrument, the
	// interval strip, the coach's controls, sprints, games, the countdown.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { useChannel } from '#lib/channel/context.ts';
	import { liveSessionId } from '#lib/channel/tick-session.ts';
	import Training from '#lib/session/Training.svelte';
	import CrewStrip from '#lib/session/CrewStrip.svelte';
	import SessionControls from '#lib/session/SessionControls.svelte';
	import FreeRide from '#lib/ride/FreeRide.svelte';
	import { device } from '#lib/device.svelte.ts';
	import { rideFrame } from '#lib/ride/ride-frame.svelte.ts';
	import {
		joinIntent,
		shouldAskJoin,
		takeJoinDoor,
	} from '#lib/session/join-intent.svelte.ts';

	const channel = useChannel();

	// Opening the session watches it (#4469, docs/SESSIONS.md): only a Join
	// (a "Join the ride" link's door, the page's Join, the coach's Start)
	// puts this rider on its timeline. The door comes off the address, so a
	// reload or a shared link watches.
	// Only the address is tracked: the goto changes page.state, and a read of
	// it here looped the page solid.
	$effect(() => {
		const door = takeJoinDoor(page.url);
		if (!door) return;
		untrack(() => {
			const here = page.params.session;
			if (here && !device.spectator) joinIntent.choose(here);
			void goto(door.rest, { replace: true, reset: false });
		});
	});

	// A join a reconnect lost is not a choice to watch: asked again while
	// the hub still has the rider out, at most every few seconds. From the
	// count-in on: a start line is joined with its own button.
	let askedAt = 0;
	$effect(() => {
		const now = Date.now();
		const state = channel.shared;
		if (
			!shouldAskJoin({
				chosen: joinIntent.chosen,
				here: page.params.session,
				running: state
					? liveSessionId({ phase: state.phase, id: state.id ?? '' })
					: undefined,
				inSession: !!channel.you.inSession,
				spectator: device.spectator,
				now,
				askedAt,
			})
		)
			return;
		askedAt = now;
		channel.control('join');
	});
</script>

{#if channelConnection.at(channel.address)?.live.tick?.state.together}
	<!-- Riding together (docs/SESSIONS.md): the crew's numbers on top, the
	     coach's End, and your own free ride underneath driving your trainer. -->
	<!-- A definite height, with the ride taking what is left: under a
	     min-height the free ride's own h-full had nothing to fill and the
	     ride shrank to a sliver on a desk, its rail cut off. -->
	<div class="flex h-full min-h-0 flex-col">
		<div class="shrink-0 px-4 pt-3 sm:px-6">
			<CrewStrip
				riders={channel.riders.filter((r) => r.inSession && !r.you)}
				pad=""
			/>
		</div>
		<!-- Riding, the coach's controls are the now bar's (WATTROOM.md: never
		     on the ride); before the ride they sit here. -->
		{#if !rideFrame.riding || (!channel.you.inSession && !device.spectator)}
			<div class="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3 sm:px-6">
				{#if !channel.you.inSession && !device.spectator}
					<button
						onclick={() => channel.control('join')}
						class="btn btn-accent btn-lg">Join the ride</button
					>
				{/if}
				{#if !rideFrame.riding}<SessionControls />{/if}
			</div>
		{/if}
		<div class="min-h-0 flex-1"><FreeRide /></div>
	</div>
{:else}
	<Training />
{/if}
