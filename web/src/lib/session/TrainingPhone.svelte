<script lang="ts">
	// Training at phone width (#412). Same place, same focus slot, one column.
	//
	// A phone is a spectator (WATTROOM.md), so the instrument cannot be "your
	// numbers" — there is no trainer behind them. It is the FOLLOWED rider's:
	// whoever you tapped in the crew strip, else whoever is working hardest.
	// That is the one thing a phone propped on a stem or a kitchen counter is
	// for, and it is the surface #383 built for every other width.
	//
	// Nothing here decides what a spectator may do: `TrainerOverview` and
	// `SessionControls` carry that gate themselves, so on a phone they draw
	// nothing and on a narrow screen that CAN reach a trainer — or one that
	// asked for the cockpit with ?full=1 — they are simply there.
	import GamePanel from '$lib/session/GamePanel.svelte';
	import Instrument from '$lib/session/Instrument.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import CrewStrip from '$lib/session/CrewStrip.svelte';
	import SecondaryRow from '$lib/session/SecondaryRow.svelte';
	import SessionControls from '$lib/session/SessionControls.svelte';
	import SprintMoment from '$lib/session/SprintMoment.svelte';
	import Stage from '$lib/channel/Stage.svelte';
	import SessionFlag from '$lib/session/SessionFlag.svelte';
	import TrainerOverview from '$lib/session/TrainerOverview.svelte';
	import { device } from '$lib/device.svelte';
	import { followedRider } from '$lib/session/follow';
	import { pictureKey } from '$lib/channel/stage';
	import { formatClock } from '$lib/format';
	import { useChannel } from '$lib/channel/context';
	import { endGame } from '$lib/session/end-game';
	import { account } from '$lib/account.svelte';
	import { blockBands } from '$lib/workout/block';
	import { serverNow } from '$lib/server-clock';
	import { channelConnection } from '$lib/channel/connection.svelte';

	const channel = useChannel();
	const total = $derived(channel.shared?.totalSeconds ?? 0);
	const elapsed = $derived(channel.shared?.elapsed ?? 0);
	const share = $derived(
		channel.onStage && channel.onStage.key !== 'jukebox'
			? channel.onStage
			: null,
	);
	// The podium yields the instrument a few seconds after the window, as
	// the desktop Training place does (audit 2026-09-09).
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
		sprintFocus ? 'sprint' : channel.game ? 'game' : share ? 'media' : 'rider',
	);
	const followed = $derived(followedRider(channel.riders, channel.focusId));
	const bands = $derived(
		blockBands(channel.block, followed?.cadence ?? 0, followed?.hr ?? 0),
	);
	// Everyone but whoever the instrument is already about — and not yourself
	// while you are not pedalling: a spectator's own 0 W tile is the one thing
	// on this screen nobody came to look at.
	// The followed rider stays in the strip, pressed (#1627): excluded, the
	// toggle-off tap had nothing to land on and a phone could never stop
	// following.
	const crew = $derived(
		channel.riders.filter((rider) => !(rider.you && rider.watts === 0)),
	);
</script>

<div class="flex h-full min-h-0 flex-col">
	<header class="shrink-0 px-4 pt-4 pb-3">
		<p class="eyebrow">
			block {channel.block?.index ?? 1} of {channel.block?.count ?? 1}
		</p>
		<h2 class="font-display truncate text-2xl leading-tight font-bold">
			{channel.block?.label ?? channel.shared?.workoutName ?? ''}
		</h2>
		<div class="mt-1 flex items-baseline gap-4">
			{#if channel.block}
				<p class="font-display text-3xl leading-none font-bold tabular-nums">
					{formatClock(channel.block.secondsLeft)}
					<span class="text-muted text-xs font-normal">left in block</span>
				</p>
			{/if}
			{#each bands as band (band.unit)}
				<p
					class="font-display text-lg leading-none font-bold tabular-nums {band.inBand
						? 'text-z4'
						: 'text-muted'}"
				>
					{band.text}
				</p>
			{/each}
			<p class="text-muted ml-auto text-sm tabular-nums">
				{formatClock(elapsed)}<span class="text-muted-dim"
					>/{formatClock(total)}</span
				>
			</p>
		</div>
		<!-- Both draw nothing on a phone and both come back with ?full=1 or on
		     a narrow screen that can actually reach a trainer: the gate lives
		     in them, so this surface is narrow, not permanently spectating. -->
		<div class="mt-2 flex flex-wrap items-center gap-2 empty:mt-0">
			<SessionControls compact />
			<TrainerOverview compact />
			<SessionFlag />
		</div>
	</header>

	<!-- The drawer button and the people button both float in the bottom
	     corners, so the column ends above them rather than under them. -->
	<div class="min-h-0 flex-1 overflow-y-auto pb-20">
		{#if followed && !followed.you && (focus === 'sprint' || focus === 'game')}
			<!-- Whose number the biggest number is (#1627): the eyebrow lived in
			     the rider branch alone, and a sprint glowed someone else's watts
			     unnamed. -->
			<p class="eyebrow px-4 pb-2">watching {followed.name}</p>
		{/if}
		{#if focus === 'sprint' && channel.sprint}
			<section class="px-4">
				<!-- Whose number this is: the followed rider's, like every other
				     number on the phone (#1591) — a spectator's own 0 W used to
				     glow "all out" for fifteen seconds. -->
				<SprintMoment
					sprint={channel.sprint}
					myWatts={followed?.watts ?? channel.you.watts}
					roster={channel.riders}
				/>
			</section>
		{:else if focus === 'game' && channel.game}
			<section class="px-4">
				<!-- The same gate SessionControls wears two blocks up (#1411): a
				     coach on a narrow window that can reach a trainer keeps the
				     game's controls; a spectator never had them. -->
				<GamePanel
					game={channel.game}
					roster={channelConnection.current?.live.tick?.roster ?? []}
					canControl={channel.canControl && !device.spectator}
					end={() => void endGame(channel)}
					me={account.me?.id}
				/>
				{#if followed && !channel.game.meterHidden}
					<!-- The rider's own watts under the game (audit 2026-09-09):
					     the panel says the line and who is left, never what you
					     are producing. Watt Golf hides it on purpose. -->
					<div class="mt-3">
						<Instrument
							watts={followed.watts}
							target={followed.target}
							ftp={followed.ftp}
							compact
						/>
					</div>
				{/if}
			</section>
		{:else}
			{#if focus === 'media' && share}
				<!-- The picture leads and the numbers go beneath it, never over
				     it — the RMF rule holds at every width (WATTROOM.md). -->
				<section class="px-4">
					<Stage
						sources={channel.stageSources}
						activeKey={share.key}
						trackKey={pictureKey(share)}
						onPick={(key) => channel.pickStage(key)}
						attach={(node) => channel.attachStage(node, share.key)}
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
							lthr={followed.you
								? channelConnection.current?.profile.current.lthr
								: undefined}
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
					onFollow={(id) =>
						channel.setFocus(id === channel.focusId ? null : id)}
					pad="px-4"
				/>
			</div>

			{#if focus !== 'media'}
				<div class="mt-3 h-24">
					<IntervalGraph
						segments={channel.segments}
						{total}
						{elapsed}
						ftp={followed?.ftp ?? channel.you.ftp}
						trace={followed?.trace ?? []}
					/>
				</div>
			{/if}
		{/if}

		{#if device.spectator}
			<!-- Says why there is nothing to pair, once, where the numbers are —
			     not a banner on every place (ux.md: teach, never apologise). -->
			<p class="text-muted-dim px-4 py-3 text-center text-[11px]">
				Spectating — cheers land in the voice channel. Bring a laptop to ride.
			</p>
		{/if}
	</div>
</div>
