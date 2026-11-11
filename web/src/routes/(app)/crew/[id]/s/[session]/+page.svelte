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
	<div class="flex min-h-full flex-col gap-4 px-4 py-5 sm:px-6">
		<CrewStrip
			riders={channel.riders.filter((r) => r.inSession && !r.you)}
			pad=""
		/>
		<div class="flex flex-wrap items-center gap-2">
			{#if !channel.you.inSession && !device.spectator}
				<button
					onclick={() => channel.control('join')}
					class="btn btn-accent btn-lg">Join the ride</button
				>
			{/if}
			<SessionControls />
		</div>
		<FreeRide />
	</div>
{:else}
	<Training />
{/if}
