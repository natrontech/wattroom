<script lang="ts">
	// The Lounge's way into a running session, in every phase (audit
	// 2026-09-09): the session's controls, the trainer, the ride's door, and
	// for whoever stands beside it the roadside's deck. Split out of the
	// Lounge when its riding sizes landed (#3890).
	import type { Snippet } from 'svelte';
	import { useChannel } from '$lib/channel/context';
	import { ridePath, sessionPath } from '$lib/channel/address';
	import { liveSessionId } from '$lib/channel/tick-session';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import SessionControls from '$lib/session/SessionControls.svelte';
	import TrainerOverview from '$lib/session/TrainerOverview.svelte';
	import { needsTrainer } from '$lib/session/sensor-status';
	import RoadsideDeck from '$lib/channel/RoadsideDeck.svelte';
	import { bottleFor } from '$lib/roadside';
	import { device } from '$lib/device.svelte';
	import Radio from '@lucide/svelte/icons/radio';

	let { freeRide }: { freeRide: Snippet } = $props();

	const channel = useChannel();
	const sessionId = $derived(
		liveSessionId(channelConnection.current?.live.tick?.state),
	);
</script>

<!-- The dashboard below the Lounge mounts only while nothing runs, and with
     it went Pause and End for a coach standing here mid-ride — and the way
     into the ride for a member arriving mid-session. -->
<div class="mt-4 flex flex-wrap items-center gap-2">
	<SessionControls />
	{#if needsTrainer(channel.trainer, channel.pairing)}
		<!-- A planned session's Start now lands here mid-countdown (#2594),
		     and so does a rider whose coach started it: the way to pair sits
		     beside the way into the ride. -->
		<TrainerOverview compact />
	{/if}
	{#if !device.spectator}
		<!-- Not to a phone (#1627): it cannot ride, and Training would answer
		     "bring a laptop". The coach needs the way in too: a voice channel
		     has no Training row in the sidebar, and the session's page is
		     where the ride is (#2450). -->
		<a
			href={ridePath(channel.address, sessionId)}
			class="btn btn-accent btn-lg ride-stage:ride-word ride-stage:py-2"
			><Radio size={15} />
			{channel.canControl ? 'Go to the ride' : 'Join the ride'}</a
		>
	{:else if sessionId}
		<!-- A phone watches (#2635): the session's watch page is the phone's
		     view of it since #2450, and the Lounge had no way there once the
		     ride link was held back. -->
		<a
			href="{sessionPath(channel.address.crew, sessionId)}/watch"
			class="btn btn-accent btn-lg ride-stage:ride-word ride-stage:py-2"
			><Radio size={15} /> Watch the session</a
		>
	{/if}
	{@render freeRide()}
</div>
{#if channel.phase === 'live' && !channel.you.inSession}
	<!-- Beside the session, not on it (#3022): the roadside's deck, so a
	     bottle is a button here and not only a tile's menu entry. A rider a
	     game put out has it in the game's panel instead. -->
	<!-- Wide enough that the deck's one status line holds a refusal at the
	     riding floor's 24 px (TARGETS G4). -->
	<div class="mt-3 max-w-xl">
		<RoadsideDeck to={bottleFor(channel.riders, channel.focusId)} />
	</div>
{/if}
