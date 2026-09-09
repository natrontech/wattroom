<script lang="ts">
	// The Training place — the 3 m surface (ADR-0020). Was a tab inside
	// RoomLive; it is a URL now.
	//
	// A FOCUS SLOT, not a fixed layout: sprint › game › shared screen › your
	// instrument. A sprint takes the screen and gives it back, a game replaces
	// the workout, a shared screen replaces both, and the instrument is what
	// returns. The player is never overlaid — RMF — so the numbers go below it.
	import CrewStrip from '$lib/room/CrewStrip.svelte';
	import ExecutionMeter from '$lib/room/ExecutionMeter.svelte';
	import GamePanel from '$lib/room/GamePanel.svelte';
	import Instrument from '$lib/room/Instrument.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import SecondaryRow from '$lib/room/SecondaryRow.svelte';
	import RideHeader from '$lib/room/RideHeader.svelte';
	import RoomFlag from '$lib/room/RoomFlag.svelte';
	import RoomSensorOverview from '$lib/room/RoomSensorOverview.svelte';
	import SessionControls from '$lib/room/SessionControls.svelte';
	import SprintMoment from '$lib/room/SprintMoment.svelte';
	import Stage from '$lib/room/Stage.svelte';
	import TrainingPhone from '$lib/room/TrainingPhone.svelte';
	import { device } from '$lib/device.svelte';
	import { pictureKey } from '$lib/room/stage';
	import { publishHud } from '$lib/hud/feed';
	import { useRoom } from '$lib/room/context';
	import { account } from '$lib/account.svelte';
	import { serverNow } from '$lib/room/server-clock';
	import { roomConnection } from '$lib/room/connection.svelte';

	const room = useRoom();
	const total = $derived(room.shared?.totalSeconds ?? 0);
	const elapsed = $derived(room.shared?.elapsed ?? 0);

	// The HUD feed (ADR-0041): your own numbers, once a second, for the
	// floating window or another tab to mirror. Solo rides publish from
	// RidingScreen; a room publishes here, where "you" is resolved.
	$effect(() => {
		if (!room.you) return;
		publishHud({
			watts: room.you.watts,
			target: room.you.target,
			remaining: Math.max(0, total - elapsed),
			label: room.shared?.workoutName ?? 'Room ride',
		});
	});
	// A shared SCREEN takes the focus; the jukebox never does — it has one
	// player instance and it lives on the dock (RMF: no auto-advance offscreen).
	const share = $derived(
		room.onStage && room.onStage.key !== 'jukebox' ? room.onStage : null,
	);
	// The podium keeps the focus for a few seconds after the window — the
	// server holds the sprint on the board for 30 s, and the screen used to
	// hold the podium that long too: half a minute back in a block with no
	// watts, no target and no clock (audit 2026-09-09).
	const PODIUM_MS = 8_000;
	let now = $state(serverNow());
	$effect(() => {
		if (!room.sprint) return;
		const id = setInterval(() => (now = serverNow()), 250);
		return () => clearInterval(id);
	});
	const sprintFocus = $derived(
		!!room.sprint && now < room.sprint.endsAtMs + PODIUM_MS,
	);
	const focus = $derived(
		sprintFocus ? 'sprint' : room.game ? 'game' : share ? 'media' : 'you',
	);
	// Only people actually turning the pedals are ranked. The server scores
	// nothing for a rider with no samples and returns 1 for them, which is
	// right for "before the first hard block" and absurd on a leaderboard:
	// a spectator sitting in the room reads 100% and beats everyone riding.
	// `riding` is the server's word (#1016) — a coast holds it — so a rider
	// who freewheels for one sample no longer drops off the list and the
	// ranking stops re-sorting under their eyes (#1411).
	const riding = $derived(room.riders.filter((r) => r.riding));
</script>

{#if room.phase === 'lounge' && room.game}
	<!-- A game with no workout session behind it (#1586): starting a game
	     starts no timeline, so the phase stayed "lounge" and the panel below
	     was unreachable — every mode was dead on screen while its cues
	     played. A game is a session's peer (docs/SPEC.md's glossary), so it
	     gets the place. -->
	<div class="flex h-full min-h-0 flex-col">
		<header class="flex flex-wrap items-center gap-3 px-6 py-3">
			<p class="eyebrow">game</p>
			{#if !room.trainer}<RoomSensorOverview compact />{/if}
			<div class="ml-auto"><SessionControls compact /></div>
		</header>
		<section class="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
			<GamePanel
				game={room.game}
				roster={roomConnection.current?.live.tick?.roster ?? []}
				canControl={room.canControl && !device.spectator}
				end={() => room.control('game-end')}
			/>
		</section>
	</div>
{:else if room.phase === 'lounge'}
	<!-- Capability gating (ux.md): nothing to render until a session runs, so
	     teach rather than show an empty instrument. -->
	<div class="grid h-full place-items-center px-6">
		<div class="w-full max-w-2xl text-center">
			{#if room.shared?.phase === 'done'}
				<!-- The coach ended it, or the timeline ran out (audit
				     2026-09-09): without this line the instrument vanishing
				     into a pairing prompt read as a crash. -->
				<p class="font-display text-lg font-bold">The session has ended.</p>
			{/if}
			<p class="text-muted mt-2 text-sm">
				{#if room.shared?.phase === 'done'}
					<!-- Not "nothing is running yet" right under "it ended"
					     (audit 2026-09-09): where it went, and what comes next. -->
					Its recap is on
					<a href="/r/{room.slug}/sessions" class="underline">Sessions</a>, with
					whatever is planned next.
				{:else if device.spectator}
					<!-- A phone has no trainer to pair and no session to start, so
					     the empty state teaches what it IS for rather than listing
					     controls that are correctly absent (ux.md). -->
					Nothing is running yet. This is where the room's numbers appear the moment
					someone starts the session — follow any rider from the crew strip.
				{:else if !room.canControl}
					<!-- A member cannot start anything (docs/SPEC.md roles), and
					     SessionControls renders nothing for them — so the sentence
					     must not name a button that is not there (audit 2026-09-09). -->
					Nothing is running yet. This is where the room's numbers appear the moment
					the coach starts the session — pair your trainer below so you're ready.
				{:else}
					Nothing is running yet. Get your equipment paired below, then start
					when you're ready.
				{/if}
			</p>
			<div class="mt-5">
				<RoomSensorOverview />
			</div>
			<div class="mt-5 flex flex-wrap justify-center gap-2">
				<SessionControls />
			</div>
		</div>
	</div>
{:else if room.phase === 'countdown'}
	<div class="grid h-full place-items-center">
		<div class="text-center">
			<p class="eyebrow">starting</p>
			<p
				class="font-display text-watt glow-text-strong text-[10rem] leading-none font-bold tabular-nums"
			>
				{room.shared?.countdownRemaining ?? 0}
			</p>
			<p class="font-display mt-4 text-2xl font-bold">
				{room.shared?.workoutName ?? ''}
			</p>
			<p class="text-muted mt-1 text-sm">
				{room.riders.length} rider{room.riders.length === 1 ? '' : 's'}
			</p>
			<div class="mt-4 flex justify-center"><SessionControls compact /></div>
		</div>
	</div>
{:else if device.narrow}
	<!-- One column, the followed rider's instrument, the crew strip (#412). -->
	<TrainingPhone />
{:else}
	<div
		class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto_auto] overflow-hidden"
	>
		<div class="px-6 pt-5 pb-4">
			<RideHeader
				block={room.block}
				{elapsed}
				{total}
				cadence={room.you.cadence}
				hr={room.you.hr}
				title={room.shared?.workoutName ?? ''}
			>
				{#snippet aside()}
					{#if !room.trainer}<RoomSensorOverview compact />{/if}
				{/snippet}
				{#snippet controls()}
					<SessionControls compact />
					<RoomFlag />
				{/snippet}
			</RideHeader>
		</div>

		{#if focus === 'sprint' && room.sprint}
			<section class="min-h-0 px-6">
				<SprintMoment
					sprint={room.sprint}
					myWatts={room.you.watts}
					roster={room.riders}
				/>
			</section>
		{:else if focus === 'game' && room.game}
			<section class="min-h-0 overflow-y-auto px-6">
				<GamePanel
					game={room.game}
					roster={roomConnection.current?.live.tick?.roster ?? []}
					canControl={room.canControl}
					end={() => room.control('game-end')}
					me={account.me?.id}
				/>
			</section>
		{:else if focus === 'media' && share}
			<section class="grid min-h-0 place-items-center px-6">
				<Stage
					sources={room.stageSources}
					activeKey={share.key}
					trackKey={pictureKey(share)}
					onPick={(key) => room.pickStage(key)}
					attach={(node) => room.attachStage(node, share.key)}
				/>
			</section>
		{:else}
			<section class="grid min-h-0 content-center px-6">
				<Instrument
					watts={room.you.watts}
					target={room.you.target}
					ftp={room.you.ftp}
				/>
			</section>
		{/if}

		{#if focus === 'sprint' || (focus === 'game' && room.game?.meterHidden)}
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
							watts={room.you.watts}
							target={room.you.target}
							ftp={room.you.ftp}
							compact
						/>
					</div>
				{/if}
				<SecondaryRow
					cadence={room.you.cadence}
					hr={room.you.hr}
					watts={room.you.watts}
					kg={room.you.kg}
					bias={room.bias}
					lthr={roomConnection.current?.profile.current.lthr}
					small={focus === 'media'}
					onBias={room.trainer ? (step) => room.nudgeBias(step) : undefined}
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
					<CrewStrip riders={room.riders.filter((r) => !r.you)} />
				{/if}

				{#if focus !== 'media'}
					<!-- The horizon: the session is the ground the numbers stand on,
					     not another card. It gives way to the player when media has
					     the focus — two grounds is one too many. -->
					<div class="mt-3 h-28">
						<IntervalGraph
							segments={room.segments}
							{total}
							{elapsed}
							ftp={room.you.ftp}
							trace={room.you.trace}
						/>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
