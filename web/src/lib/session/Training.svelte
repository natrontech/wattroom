<script lang="ts">
	// The Training place — the 3 m surface (ADR-0020). Was a tab inside
	// RoomLive, then a URL of the room's own; since #2449 a voice channel's.
	//
	// A FOCUS SLOT, not a fixed layout: sprint › game › shared screen › your
	// instrument. A sprint takes the screen and gives it back, a game replaces
	// the workout, a shared screen replaces both, and the instrument is what
	// returns. The player is never overlaid — RMF — so the numbers go below it.
	import CountdownScreen from '$lib/session/CountdownScreen.svelte';
	import CrewStrip from '$lib/session/CrewStrip.svelte';
	import ExecutionMeter from '$lib/session/ExecutionMeter.svelte';
	import GamePanel from '$lib/session/GamePanel.svelte';
	import Instrument from '$lib/session/Instrument.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import SecondaryRow from '$lib/session/SecondaryRow.svelte';
	import RideHeader from '$lib/session/RideHeader.svelte';
	import MonitorUp from '@lucide/svelte/icons/monitor-up';
	import SessionFlag from '$lib/session/SessionFlag.svelte';
	import TrainerOverview from '$lib/session/TrainerOverview.svelte';
	import SessionControls from '$lib/session/SessionControls.svelte';
	import SprintMoment from '$lib/session/SprintMoment.svelte';
	import Stage from '$lib/channel/Stage.svelte';
	import TrainingPhone from '$lib/session/TrainingPhone.svelte';
	import { device, deviceWord } from '$lib/device.svelte';
	import { trainerTargetsNote } from '$lib/session/sensor-status';
	import { pictureKey } from '$lib/channel/stage';
	import { useChannel } from '$lib/channel/context';
	import { account } from '$lib/account.svelte';
	import { serverNow } from '$lib/server-clock';
	import { channelConnection } from '$lib/channel/connection.svelte';

	const channel = useChannel();
	// Another of the rider's screens drives the trainer (#2075). This one
	// keeps the link, the watts and Forget (ADR-0025, amended) and writes no
	// control point, so the trim is disabled and the card gets a place to say
	// why — it is otherwise hidden the moment a trainer is linked, which is
	// exactly the state this is about.
	const targetsNote = $derived(
		trainerTargetsNote(channel.pairing, deviceWord()),
	);
	const total = $derived(channel.shared?.totalSeconds ?? 0);
	const elapsed = $derived(channel.shared?.elapsed ?? 0);

	// A shared SCREEN takes the focus; the jukebox never does — it has one
	// player instance and it lives on the dock (RMF: no auto-advance offscreen).
	const share = $derived(
		channel.onStage && channel.onStage.key !== 'jukebox'
			? channel.onStage
			: null,
	);
	// The podium keeps the focus for a few seconds after the window — the
	// server holds the sprint on the board for 30 s, and the screen used to
	// hold the podium that long too: half a minute back in a block with no
	// watts, no target and no clock (audit 2026-09-09).
	const PODIUM_MS = 8_000;
	let now = $state(serverNow());
	$effect(() => {
		if (!channel.sprint) return;
		const id = setInterval(() => (now = serverNow()), 250);
		return () => clearInterval(id);
	});
	const sprintFocus = $derived(
		!!channel.sprint && now < channel.sprint.endsAtMs + PODIUM_MS,
	);
	const focus = $derived(
		sprintFocus ? 'sprint' : channel.game ? 'game' : share ? 'media' : 'you',
	);
	// Only people actually turning the pedals are ranked. The server scores
	// nothing for a rider with no samples and returns 1 for them, which is
	// right for "before the first hard block" and absurd on a leaderboard:
	// a spectator sitting in the channel reads 100% and beats everyone riding.
	// `riding` is the server's word (#1016) — a coast holds it — so a rider
	// who freewheels for one sample no longer drops off the list and the
	// ranking stops re-sorting under their eyes (#1411).
	const riding = $derived(channel.riders.filter((r) => r.riding));
</script>

{#if channel.phase === 'lounge' && channel.game}
	<!-- A game with no workout session behind it (#1586): starting a game
	     starts no timeline, so the phase stayed "lounge" and the panel below
	     was unreachable — every mode was dead on screen while its cues
	     played. A game is a session's peer (docs/SPEC.md's glossary), so it
	     gets the place. -->
	<div class="flex h-full min-h-0 flex-col">
		<header class="flex flex-wrap items-center gap-3 px-6 py-3">
			<p class="eyebrow">game</p>
			{#if !channel.trainer || targetsNote}<TrainerOverview compact />{/if}
			<div class="ml-auto"><SessionControls compact /></div>
		</header>
		<section class="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
			<GamePanel
				game={channel.game}
				roster={channelConnection.current?.live.tick?.roster ?? []}
				canControl={channel.canControl && !device.spectator}
				end={() => channel.control('game-end')}
			/>
		</section>
	</div>
{:else if channel.phase === 'lounge'}
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
					     (audit 2026-09-09): where it went, and what comes next. -->
					Its recap is on the crew's
					<a href={channel.address.members} class="underline">Members</a> page.
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
			<div class="mt-5">
				<TrainerOverview />
			</div>
			<div class="mt-5 flex flex-wrap justify-center gap-2">
				<SessionControls />
			</div>
		</div>
	</div>
{:else if channel.phase === 'countdown'}
	<!-- One count-in for the surface (ADR-0046, #1800): the same screen a solo
	     ride draws, with a rider count instead of what is first up. -->
	<CountdownScreen
		remaining={channel.shared?.countdownRemaining ?? 0}
		title={channel.shared?.workoutName ?? ''}
		note="{channel.riders.length} rider{channel.riders.length === 1 ? '' : 's'}"
	>
		{#snippet controls()}
			<!-- The running header's card, ten seconds early (#2594): a rider
			     pulled in by someone else's start pairs during the count-in
			     rather than during the first interval. -->
			<div class="flex flex-wrap items-center justify-center gap-3">
				{#if !channel.trainer || targetsNote}<TrainerOverview compact />{/if}
				<SessionControls compact />
			</div>
		{/snippet}
	</CountdownScreen>
{:else if device.narrow}
	<!-- One column, the followed rider's instrument, the crew strip (#412). -->
	<TrainingPhone />
{:else}
	<div
		class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto_auto] overflow-hidden"
	>
		<div class="px-6 pt-5 pb-4">
			<RideHeader
				block={channel.block}
				{elapsed}
				{total}
				cadence={channel.you.cadence}
				hr={channel.you.hr}
				title={channel.shared?.workoutName ?? ''}
			>
				{#snippet aside()}
					{#if !channel.trainer || targetsNote}<TrainerOverview compact />{/if}
				{/snippet}
				{#snippet controls()}
					<SessionControls compact />
					<!-- The 3 m view, from the place the rider is on (#1667): the
					     Lounge had the only button, off the numbers, mid-interval. -->
					<!-- btn-lg, as /ride and /ramp give the same control and as
					     every neighbour in this header already is (#2161): it is
					     pressed while pedalling, which is what ux.md's 44 px is
					     about. -->
					<button
						onclick={() => channel.openTv()}
						class="btn btn-secondary btn-lg"
						aria-label="TV mode"><MonitorUp size={15} /> TV</button
					>
					<SessionFlag />
				{/snippet}
			</RideHeader>
		</div>

		{#if focus === 'sprint' && channel.sprint}
			<section class="min-h-0 px-6">
				<SprintMoment
					sprint={channel.sprint}
					myWatts={channel.you.watts}
					roster={channel.riders}
				/>
			</section>
		{:else if focus === 'game' && channel.game}
			<section class="min-h-0 overflow-y-auto px-6">
				<GamePanel
					game={channel.game}
					roster={channelConnection.current?.live.tick?.roster ?? []}
					canControl={channel.canControl}
					end={() => channel.control('game-end')}
					me={account.me?.id}
				/>
			</section>
		{:else if focus === 'media' && share}
			<section class="grid min-h-0 place-items-center px-6">
				<Stage
					sources={channel.stageSources}
					activeKey={share.key}
					trackKey={pictureKey(share)}
					onPick={(key) => channel.pickStage(key)}
					attach={(node) => channel.attachStage(node, share.key)}
				/>
			</section>
		{:else}
			<section class="grid min-h-0 content-center px-6">
				<Instrument
					watts={channel.you.watts}
					target={channel.you.target}
					ftp={channel.you.ftp}
				/>
			</section>
		{/if}

		{#if focus === 'sprint' || (focus === 'game' && channel.game?.meterHidden)}
			<!-- The sprint carries its own numbers, and Watt Golf hides the
			     meter on purpose; every other game showed the line and who was
			     left and never the rider's own watts (audit 2026-09-09). -->
			<div></div>
			<div></div>
		{:else}
			<div class="mt-4 flex items-center gap-6 px-6">
				{#if focus === 'media' || focus === 'game'}
					<!-- Under the player, never over it (RMF). -->
					<div class="min-w-0 flex-1">
						<Instrument
							watts={channel.you.watts}
							target={channel.you.target}
							ftp={channel.you.ftp}
							compact
						/>
					</div>
				{/if}
				<SecondaryRow
					cadence={channel.you.cadence}
					hr={channel.you.hr}
					watts={channel.you.watts}
					kg={channel.you.kg}
					bias={channel.bias}
					lthr={channelConnection.current?.profile.current.lthr}
					small={focus === 'media'}
					onBias={channel.trainer && channel.actuating
						? (step) => channel.nudgeBias(step)
						: undefined}
					biasHint={targetsNote
						? `${targetsNote} — trim them there`
						: undefined}
				/>

				<!-- The live half of the execution score (WATTROOM.md: "live on the
				     group dashboard during sessions"). The server has sent it per
				     rider since #27 and only the render site was missing (#543).
				     It rides in the secondary row's spare width rather than beside
				     the crew: the strip is presence, this is the contest, and a
				     second full-width list of the same people is what the sprint
				     and game branches below already refuse to draw.
				     Alone it is not a leaderboard, so solo rides do not show it. -->
				{#if riding.length > 1 && focus !== 'media' && focus !== 'game'}
					<!-- Not while a screen has the focus: this row already picks up
					     the compact instrument there, and the player's own floor
					     (RMF) is what the width is for. -->
					<div class="ml-auto max-h-32 w-64 shrink-0 overflow-y-auto">
						<ExecutionMeter riders={riding} />
					</div>
				{/if}
			</div>

			<!-- The crew. A group-training surface that shows only your own
			     numbers is a solo app with a chat window attached. -->
			<div class="mt-4">
				{#if focus !== 'game'}
					<!-- A game's panel already lists everyone; a second list of the
					     same people is what the sprint branch refuses too. -->
					<CrewStrip riders={channel.riders.filter((r) => !r.you)} />
				{/if}

				{#if focus !== 'media'}
					<!-- The horizon: the session is the ground the numbers stand on,
					     not another card. It gives way to the player when media has
					     the focus — two grounds is one too many. -->
					<div class="mt-3 h-28">
						<IntervalGraph
							segments={channel.segments}
							{total}
							{elapsed}
							ftp={channel.you.ftp}
							trace={channel.you.trace}
						/>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
