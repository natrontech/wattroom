<script lang="ts">
	// The Training place — the 3 m surface (ADR-0020). Was a tab inside
	// RoomLive; it is a URL now.
	//
	// A FOCUS SLOT, not a fixed layout: sprint › game › shared screen › your
	// instrument. A sprint takes the screen and gives it back, a game replaces
	// the workout, a shared screen replaces both, and the instrument is what
	// returns. The player is never overlaid — RMF — so the numbers go below it.
	import GamePanel from '$lib/room/GamePanel.svelte';
	import Instrument from '$lib/room/Instrument.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import SecondaryRow from '$lib/room/SecondaryRow.svelte';
	import SessionControls from '$lib/room/SessionControls.svelte';
	import SprintMoment from '$lib/room/SprintMoment.svelte';
	import Stage from '$lib/room/Stage.svelte';
	import { pictureKey } from '$lib/room/stage';
	import { formatClock, wkg } from '$lib/format';
	import { ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { useRoom } from '$lib/room/context';
	import { roomConnection } from '$lib/room/connection.svelte';

	const room = useRoom();
	const av = $derived(roomConnection.current?.av);
	const total = $derived(room.shared?.totalSeconds ?? 0);
	const elapsed = $derived(room.shared?.elapsed ?? 0);
	// A shared SCREEN takes the focus; the jukebox never does — it has one
	// player instance and it lives on the dock (RMF: no auto-advance offscreen).
	const share = $derived(
		room.onStage && room.onStage.key !== 'jukebox' ? room.onStage : null,
	);
	const focus = $derived(
		room.sprint ? 'sprint' : room.game ? 'game' : share ? 'media' : 'you',
	);
</script>

{#if room.phase === 'lounge'}
	<!-- Capability gating (ux.md): nothing to render until a session runs, so
	     teach rather than show an empty instrument. -->
	<div class="grid h-full place-items-center px-6">
		<div class="max-w-sm text-center">
			<p class="text-muted text-sm">
				Nothing is running yet. Training is where your numbers live once someone
				starts a session.
			</p>
			<div class="mt-4 flex justify-center"><SessionControls /></div>
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
{:else}
	<div
		class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto_auto] overflow-hidden"
	>
		<header class="flex items-end gap-6 px-6 pt-5 pb-4">
			<div class="min-w-0">
				<p class="eyebrow">
					block {room.block?.index ?? 1} of {room.block?.count ?? 1}
				</p>
				<h2 class="font-display truncate text-3xl leading-none font-bold">
					{room.block?.label ?? room.shared?.workoutName ?? ''}
				</h2>
			</div>
			{#if room.block}
				<div class="shrink-0">
					<p class="eyebrow">left in block</p>
					<p class="font-display text-3xl leading-none font-bold tabular-nums">
						{formatClock(room.block.secondsLeft)}
					</p>
				</div>
				{#if room.block.next}
					<p class="text-muted min-w-0 truncate text-xs">
						next · {room.block.next.label}
						{room.block.next.watts} W for {Math.round(
							room.block.next.seconds / 60,
						)} min
					</p>
				{/if}
			{/if}
			<p class="text-muted ml-auto shrink-0 text-sm tabular-nums">
				{formatClock(elapsed)}
				<span class="text-muted/50">/ {formatClock(total)}</span>
			</p>
			<SessionControls compact />
		</header>

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

		{#if focus === 'sprint' || focus === 'game'}
			<!-- Both carry their own standings; the crew strip below would be a
			     third list of the same people. -->
			<div></div>
			<div></div>
		{:else}
			<div class="mt-4 flex items-center gap-6 px-6">
				{#if focus === 'media'}
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
					small={focus === 'media'}
					onBias={room.trainer ? (step) => room.nudgeBias(step) : undefined}
				/>
			</div>

			<!-- The crew. A group-training surface that shows only your own
			     numbers is a solo app with a chat window attached. -->
			<div class="mt-4">
				<!-- Thumbnails at a fixed width, scrolling past the edge: a tile that grows
				     to fill turns one crewmate into a slab and starves the instrument. -->
				<div class="flex gap-2 overflow-x-auto px-6">
					{#each room.riders.filter((r) => !r.you) as rider (rider.id)}
						{@const zone = zoneOf(rider.watts, rider.ftp)}
						<div class="w-44 shrink-0">
							<div
								class="ring-ink/10 bg-surface-raised relative aspect-video overflow-hidden rounded ring-1"
							>
								{#if room.videoOf(rider.id)}
									{#key room.videoOf(rider.id)}
										<div
											class="absolute inset-0"
											{@attach (node) => room.attachVideo(rider.id, node)}
										></div>
									{/key}
								{:else}
									<div class="grid h-full w-full place-items-center">
										{#if rider.watts > 0}<RidingBars size={16} />{/if}
									</div>
								{/if}
								<span
									class="from-paper/85 absolute inset-x-0 bottom-0 flex items-baseline gap-1 bg-gradient-to-t to-transparent px-1.5 pt-4 pb-1"
								>
									<span
										class="font-display {ZONE_TEXT[
											zone
										]} text-xl leading-none font-bold tabular-nums"
										>{rider.watts}</span
									>
									<span class="text-muted text-[9px]">W</span>
									<span class="text-muted ml-auto truncate text-[10px]"
										>{rider.name}</span
									>
								</span>
							</div>
							<p class="text-muted mt-1 truncate text-[10px] tabular-nums">
								{wkg(rider.watts, rider.kg)} w/kg · {rider.cadence} rpm · {rider.hr}
								bpm
							</p>
						</div>
					{/each}
				</div>

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
