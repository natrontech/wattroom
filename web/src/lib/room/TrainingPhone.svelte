<script lang="ts">
	// Training at phone width (#412). Same place, same focus slot, one column.
	//
	// A phone is a spectator (WATTROOM.md), so the instrument cannot be "your
	// numbers" — there is no trainer behind them. It is the FOLLOWED rider's:
	// whoever you tapped in the crew strip, else whoever is working hardest.
	// That is the one thing a phone propped on a stem or a kitchen counter is
	// for, and it is the surface #383 built for every other width.
	//
	// Nothing here decides what a spectator may do: `TrainerButton` and
	// `SessionControls` carry that gate themselves, so on a phone they draw
	// nothing and on a narrow screen that CAN reach a trainer — or one that
	// asked for the cockpit with ?full=1 — they are simply there.
	import GamePanel from '$lib/room/GamePanel.svelte';
	import Instrument from '$lib/room/Instrument.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import CrewStrip from '$lib/room/CrewStrip.svelte';
	import SecondaryRow from '$lib/room/SecondaryRow.svelte';
	import SessionControls from '$lib/room/SessionControls.svelte';
	import SprintMoment from '$lib/room/SprintMoment.svelte';
	import Stage from '$lib/room/Stage.svelte';
	import TrainerButton from '$lib/room/TrainerButton.svelte';
	import { device } from '$lib/device.svelte';
	import { followedRider } from '$lib/room/follow';
	import { pictureKey } from '$lib/room/stage';
	import { formatClock } from '$lib/format';
	import { useRoom } from '$lib/room/context';
	import { roomConnection } from '$lib/room/connection.svelte';

	const room = useRoom();
	const total = $derived(room.shared?.totalSeconds ?? 0);
	const elapsed = $derived(room.shared?.elapsed ?? 0);
	const share = $derived(
		room.onStage && room.onStage.key !== 'jukebox' ? room.onStage : null,
	);
	const focus = $derived(
		room.sprint ? 'sprint' : room.game ? 'game' : share ? 'media' : 'rider',
	);
	const followed = $derived(followedRider(room.riders, room.focusId));
	// Everyone but whoever the instrument is already about — and not yourself
	// while you are not pedalling: a spectator's own 0 W tile is the one thing
	// on this screen nobody came to look at.
	const crew = $derived(
		room.riders.filter(
			(rider) => rider.id !== followed?.id && !(rider.you && rider.watts === 0),
		),
	);
</script>

<div class="flex h-full min-h-0 flex-col">
	<header class="shrink-0 px-4 pt-4 pb-3">
		<p class="eyebrow">
			block {room.block?.index ?? 1} of {room.block?.count ?? 1}
		</p>
		<h2 class="font-display truncate text-2xl leading-tight font-bold">
			{room.block?.label ?? room.shared?.workoutName ?? ''}
		</h2>
		<div class="mt-1 flex items-baseline gap-4">
			{#if room.block}
				<p class="font-display text-3xl leading-none font-bold tabular-nums">
					{formatClock(room.block.secondsLeft)}
					<span class="text-muted text-xs font-normal">left in block</span>
				</p>
			{/if}
			<p class="text-muted ml-auto text-sm tabular-nums">
				{formatClock(elapsed)}<span class="text-muted/50"
					>/{formatClock(total)}</span
				>
			</p>
		</div>
		<!-- Both draw nothing on a phone and both come back with ?full=1 or on
		     a narrow screen that can actually reach a trainer: the gate lives
		     in them, so this surface is narrow, not permanently spectating. -->
		<div class="mt-2 flex flex-wrap items-center gap-2 empty:mt-0">
			<SessionControls compact />
			<TrainerButton compact />
		</div>
	</header>

	<!-- The drawer button and the people button both float in the bottom
	     corners, so the column ends above them rather than under them. -->
	<div class="min-h-0 flex-1 overflow-y-auto pb-20">
		{#if focus === 'sprint' && room.sprint}
			<section class="px-4">
				<SprintMoment
					sprint={room.sprint}
					myWatts={room.you.watts}
					roster={room.riders}
				/>
			</section>
		{:else if focus === 'game' && room.game}
			<section class="px-4">
				<GamePanel
					game={room.game}
					roster={roomConnection.current?.live.tick?.roster ?? []}
					canControl={false}
					end={() => room.control('game-end')}
				/>
			</section>
		{:else}
			{#if focus === 'media' && share}
				<!-- The picture leads and the numbers go beneath it, never over
				     it — the RMF rule holds at every width (WATTROOM.md). -->
				<section class="px-4">
					<Stage
						sources={room.stageSources}
						activeKey={share.key}
						trackKey={pictureKey(share)}
						onPick={(key) => room.pickStage(key)}
						attach={(node) => room.attachStage(node, share.key)}
					/>
				</section>
			{/if}

			{#if followed}
				<section class="px-4 {focus === 'media' ? 'mt-3' : 'mt-1'}">
					<p class="eyebrow">
						{followed.you ? 'you' : `watching ${followed.name}`}
					</p>
					<div class="mt-1.5">
						<Instrument
							watts={followed.watts}
							target={followed.target}
							ftp={followed.ftp}
							compact={focus === 'media'}
						/>
					</div>
					<div class="mt-3">
						<!-- No bias: the trim belongs to a target this device is not
						     holding. A dead control with a tooltip is still a
						     control (#565, ux.md). -->
						<SecondaryRow
							cadence={followed.cadence}
							hr={followed.hr}
							watts={followed.watts}
							kg={followed.kg}
							small={focus === 'media'}
						/>
					</div>
				</section>
			{/if}

			<!-- Tap a crewmate to follow them. The strip is how you change who
			     the instrument is about, so it is the one thing on this screen
			     that has to be a target — full tiles, no precision (ux.md). -->
			<div class="mt-4">
				<CrewStrip
					riders={crew}
					followedId={followed?.id ?? null}
					onFollow={(id) => room.setFocus(id === room.focusId ? null : id)}
					pad="px-4"
				/>
			</div>

			{#if focus !== 'media'}
				<div class="mt-3 h-24">
					<IntervalGraph
						segments={room.segments}
						{total}
						{elapsed}
						ftp={followed?.ftp ?? room.you.ftp}
						trace={followed?.trace ?? []}
					/>
				</div>
			{/if}
		{/if}

		{#if device.spectator}
			<!-- Says why there is nothing to pair, once, where the numbers are —
			     not a banner on every place (ux.md: teach, never apologise). -->
			<p class="text-muted/70 px-4 py-3 text-center text-[11px]">
				Spectating — cheers and chat land in the room. Bring a laptop to ride.
			</p>
		{/if}
	</div>
</div>
