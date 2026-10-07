<script lang="ts">
	// The Training place before and after a session runs (ADR-0020): a game
	// with no session behind it, the empty state that teaches, and the end.
	// Lifted out of Training.svelte along its phase seam.
	import GamePanel from '$lib/session/GamePanel.svelte';
	import HrShare from '$lib/channel/HrShare.svelte';
	import SessionControls from '$lib/session/SessionControls.svelte';
	import SessionRecapCard from '$lib/session/SessionRecapCard.svelte';
	import TrainerOverview from '$lib/session/TrainerOverview.svelte';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { useChannel } from '$lib/channel/context';
	import { device } from '$lib/device.svelte';
	import { endGame } from '$lib/session/end-game';

	let {
		targetsNote,
	}: {
		/** Another of the rider's screens drives the trainer (#2075). */
		targetsNote: string | null | undefined;
	} = $props();

	const channel = useChannel();
</script>

{#if channel.game}
	<!-- A game with no workout session behind it (#1586): starting a game
	     starts no timeline, so the phase stayed "lounge" and the panel below
	     was unreachable — every mode was dead on screen while its cues
	     played. A game is a session's peer (docs/SPEC.md's glossary), so it
	     gets the place. -->
	<div class="flex h-full min-h-0 flex-col">
		<header class="flex flex-wrap items-center gap-3 px-6 py-3">
			<p class="eyebrow">game</p>
			{#if !channel.trainer || targetsNote}<TrainerOverview compact />{/if}
			<HrShare />
			<div class="ml-auto"><SessionControls compact /></div>
		</header>
		<section class="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
			<GamePanel
				game={channel.game}
				roster={channelConnection.current?.live.tick?.roster ?? []}
				canControl={channel.canDrive}
				end={() => void endGame(channel)}
			/>
		</section>
	</div>
{:else}
	<!-- Capability gating (ux.md): nothing to render until a session runs, so
	     teach rather than show an empty instrument. -->
	<div class="grid h-full place-items-center px-6">
		<div class="w-full max-w-2xl text-center">
			{#if channel.shared?.phase === 'done'}
				<!-- The coach ended it, or the timeline ran out (audit
				     2026-09-09): without this line the instrument vanishing
				     into a pairing prompt read as a crash. -->
				<p class="font-display text-lg font-bold">The session has ended.</p>
			{/if}
			<p class="text-muted mt-2 text-sm">
				{#if channel.shared?.phase === 'done'}
					<!-- Not "nothing is running yet" right under "it ended"
					     (audit 2026-09-09): where it went, and what comes next —
					     the recap itself once its row lands (#2600). -->
					{#if !channelConnection.current?.live.recap}
						Its recap is on the crew's
						<a href={channel.address.members} class="underline">Members</a> page.
					{/if}
				{:else if device.spectator}
					<!-- A phone has no trainer to pair and no session to start, so
					     the empty state teaches what it IS for rather than listing
					     controls that are correctly absent (ux.md). -->
					Nothing is running yet. This is where everyone's numbers appear the moment
					someone starts the session — follow any rider from the crew strip.
				{:else if !channel.canControl}
					<!-- Someone else coaches here, and SessionControls renders
					     nothing for the rest — so the sentence must not name a button
					     that is not there (audit 2026-09-09). -->
					Nothing is running yet. This is where everyone's numbers appear the moment
					the coach starts the session — pair your trainer below so you're ready.
				{:else}
					Nothing is running yet. Get your equipment paired below, then start
					when you're ready.
				{/if}
			</p>
			{#if channel.shared?.phase === 'done' && channelConnection.current?.live.recap}
				<div class="mt-4 text-left">
					<SessionRecapCard recap={channelConnection.current.live.recap} />
				</div>
			{/if}
			<div class="mt-5">
				<TrainerOverview />
				<!-- The pairing screen says what it is transmitting (ADR-0008),
				     before the first interval does. -->
				<HrShare class="mt-3 justify-center" />
			</div>
			<div class="mt-5 flex flex-wrap justify-center gap-2">
				<SessionControls />
			</div>
		</div>
	</div>
{/if}
