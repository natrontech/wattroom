<script lang="ts">
	/**
	 * A session's slot 3 (ADR-0046): the bike computer with its head, the
	 * trim and whether your heart rate reaches the call (ADR-0008). Your
	 * numbers on a desk; on a phone the followed rider's (#412, #4233), where
	 * POWER, CLIMB, MAP and the trim, all your own ride's, stand aside.
	 */
	import { useChannel } from '$lib/channel/context';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import type { LiveRider } from '$lib/channel/types';
	import HrShare from '$lib/channel/HrShare.svelte';
	import type { ClimbView } from '$lib/ride/climb-view';
	import type { MapView } from '$lib/ride/map-view';
	import BiasTrim from '$lib/session/BiasTrim.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import ExecutionMeter from '$lib/session/ExecutionMeter.svelte';

	let {
		rider,
		phone,
		climb,
		map,
		riding,
		meter,
		targetsNote,
	}: {
		/** Whose numbers: you, or on a phone the rider it follows. */
		rider: LiveRider;
		phone: boolean;
		climb: ClimbView | null;
		map: MapView | null;
		/** The session's riders turning the pedals, for the execution meter. */
		riding: LiveRider[];
		/** The meter has room here: a flat desk, nothing else in the focus. */
		meter: boolean;
		/** Why another screen holds the targets, when one does. */
		targetsNote?: string;
	} = $props();

	const channel = useChannel();
	const mine = $derived(rider.you);
</script>

{#if !mine}
	<!-- Whose numbers these are (#1627): the phone follows a rider. -->
	<p class="ride-label truncate px-4 pt-3">following {rider.name}</p>
{/if}
<!-- One panel: the computer with its head, the trim, and whether
     your heart rate reaches the call beside it (ADR-0008, #2804): the
     button's heart alone, since its words would wrap the trim to a
     second row, on a road into slot 1 (#4056). POWER, CLIMB and MAP
     read your own ride, so a crewmate followed keeps to RIDE. -->
<BikeComputer
	docked
	climb={mine ? climb : null}
	map={mine ? map : null}
	roadLine={!!(channel.block?.road || channel.roadReadout)}
	road={mine && channel.ridden
		? {
				speedKph: channel.ridden.mps * 3.6,
				km: channel.ridden.m / 1000,
				ofKm: channel.ridden.road.length / 1000,
			}
		: undefined}
	ftp={rider.ftp}
	cadence={rider.cadence}
	stale={mine
		? channel.youStale || (phone && channel.youUnmeasured)
		: rider.stale}
	hr={rider.hr}
	watts={rider.watts}
	kg={rider.kg}
	lthr={mine ? channelConnection.current?.profile.current.lthr : undefined}
	execution={mine && riding.length <= 1 && channel.you.inSession
		? channel.you.execution
		: undefined}
	target={rider.target > 0 ? rider.target : undefined}
	stats={mine ? channelConnection.current?.recording.live : undefined}
	race={mine ? (channel.race ?? undefined) : undefined}
/>
<!-- No trim on a phone without a trainer: a dead control with a
     tooltip is still a control (#565, ux.md). -->
{#if mine && (!phone || channel.trainer)}
	<div class="flex flex-col gap-2 px-4 pb-3">
		<div class="flex items-center gap-2">
			<BiasTrim
				ride
				bias={channel.bias}
				onBias={channel.trainer && channel.actuating
					? (step) => channel.nudgeBias(step)
					: undefined}
				hint={targetsNote ? `${targetsNote} — trim them there` : undefined}
			/>
			<HrShare ride icon />
		</div>
		{#if meter && riding.length > 1}
			<!-- The live half of the execution score (#543), alone not a
			     leaderboard (#2635). -->
			<div class="max-h-32 w-64 overflow-y-auto">
				<ExecutionMeter riders={riding} />
			</div>
		{/if}
	</div>
{/if}
