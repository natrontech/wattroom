<script lang="ts">
	// The training half of the room (#359). With the stage in the middle
	// (#316/#346) everything a session actually is — the clock, the block, the
	// target, the graph — lived below the fold under the rider tiles, so
	// mid-ride you either watched the video or scrolled to your numbers. It is
	// a tab now, and this is what is behind it.
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { hrZoneOf, ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { formatClock, wkg } from '$lib/format';
	import type { GameState, Rider, SprintState } from '$lib/protocol';
	import ExecutionMeter from '$lib/room/ExecutionMeter.svelte';
	import GamePanel from '$lib/room/GamePanel.svelte';
	import IntervalStrip from '$lib/room/IntervalStrip.svelte';
	import SprintMoment from '$lib/room/SprintMoment.svelte';
	import TargetWidget from '$lib/room/TargetWidget.svelte';
	import type { Block, RoomRider } from '$lib/room/view';
	import type { Segment } from '$lib/workout/types';

	let {
		phase,
		workoutName = '',
		countdown = 0,
		elapsed = 0,
		total = 0,
		segments = [],
		riders,
		you,
		block,
		bias = 1,
		onBias,
		lthr,
		hrSource = null,
		shareHr = false,
		onShareHr,
		sprint,
		game,
		roster = [],
		canControl = false,
		onEndGame,
		onPick,
	}: {
		phase: 'lounge' | 'countdown' | 'live';
		workoutName?: string;
		countdown?: number;
		elapsed?: number;
		total?: number;
		segments?: Segment[];
		riders: RoomRider[];
		you: RoomRider;
		block: Block | null;
		bias?: number;
		/** Absent while no trainer is paired: nothing to nudge. */
		onBias?: (step: number) => void;
		/** Lactate threshold, for colouring own bpm by HR zone (ADR-0014).
		 *  Absent until a ramp test anchors one — bpm then reads uncoloured. */
		lthr?: number;
		hrSource?: 'heart-rate' | 'trainer' | null;
		shareHr?: boolean;
		onShareHr: (on: boolean) => void;
		sprint?: SprintState;
		game?: GameState;
		roster?: Rider[];
		canControl?: boolean;
		onEndGame: () => void;
		/** The lounge CTA — opens the session picker. */
		onPick: () => void;
	} = $props();

	const readouts = $derived([
		{ label: 'rpm', value: String(you.cadence), tone: '' },
		...(you.hr > 0
			? [
					{
						label: 'bpm',
						value: String(you.hr),
						// Own bpm coloured by HR zone once an LTHR anchors them (ADR-0014).
						tone: ZONE_TEXT[hrZoneOf(you.hr, lthr)],
					},
				]
			: []),
		{ label: 'w/kg', value: wkg(you.watts, you.kg), tone: '' },
		{ label: 'exec', value: `${Math.round(you.execution * 100)}%`, tone: '' },
	]);
	const myZone = $derived(zoneOf(you.watts, you.ftp));
</script>

{#if phase === 'live'}
	<div class="flex items-end gap-4 pb-3">
		<div>
			<div class="font-display text-4xl leading-none font-bold tabular-nums">
				{formatClock(elapsed)}
			</div>
			<div class="eyebrow mt-1">elapsed</div>
		</div>
		<div class="ml-auto flex items-center gap-5">
			{#each readouts as readout (readout.label)}
				<div class="text-right">
					<span
						class="font-display text-2xl leading-none font-semibold tabular-nums {readout.tone}"
						>{readout.value}</span
					>
					<span class="eyebrow ml-1">{readout.label}</span>
				</div>
			{/each}
			<div class="text-right">
				<span
					class="font-display text-2xl leading-none font-semibold {ZONE_TEXT[
						myZone
					]}">Z{myZone}</span
				>
				<span class="eyebrow ml-1">zone</span>
			</div>
		</div>
	</div>
	{#if hrSource}
		<p class="text-muted -mt-2 mb-1 text-right text-[10px]">
			{#if shareHr}
				Sharing heart rate from your {hrSource === 'heart-rate'
					? 'strap'
					: 'trainer'} ·
				<button
					onclick={() => onShareHr(false)}
					class="hover:text-ink underline">stop sharing</button
				>
			{:else}
				Heart rate not shared with this room ·
				<button onclick={() => onShareHr(true)} class="hover:text-ink underline"
					>share</button
				>
			{/if}
		</p>
	{/if}
{/if}

{#if game}
	<div class="mb-2">
		<GamePanel {game} {roster} end={onEndGame} {canControl} />
	</div>
{/if}

{#if phase === 'countdown'}
	<div
		class="border-neon/40 bg-surface-raised flex items-center justify-center gap-4 rounded-lg border py-6"
	>
		<span
			class="text-watt glow-text-strong font-display text-5xl leading-none font-bold tabular-nums"
			>{countdown}</span
		>
		<div>
			<p class="font-display font-bold">{workoutName}</p>
			<p class="text-muted text-xs">The session is starting — get pedalling</p>
		</div>
	</div>
{:else if phase === 'live'}
	{#if sprint}
		<div class="mb-2">
			<SprintMoment {sprint} myWatts={you.watts} />
		</div>
	{:else if block}
		<div class="mb-2">
			<IntervalStrip
				{block}
				{bias}
				cadence={you.cadence}
				hr={you.hr}
				{onBias}
			/>
		</div>
		<div class="mb-2">
			<TargetWidget {you} variant="notch" />
		</div>
	{/if}
	<div class="grid gap-2 lg:grid-cols-[1fr_260px]">
		<div class="overflow-hidden rounded-lg">
			<IntervalGraph
				{segments}
				{total}
				{elapsed}
				ftp={you.ftp}
				trace={you.trace}
			/>
		</div>
		<ExecutionMeter {riders} />
	</div>
{:else if !game}
	<!-- ux.md: empty states teach. What a session is, and the one button that
	     starts one — for the people allowed to press it. -->
	<EmptyState>
		Nothing running. A session puts one workout on the room's clock: everyone
		rides the same blocks, and your target, execution and graph live here.
		{#snippet cta()}
			{#if canControl}
				<button onclick={onPick} class="btn btn-primary btn-xs"
					>Pick a workout</button
				>
			{:else}
				<span class="text-muted text-xs"
					>The coach starts it — your numbers land here.</span
				>
			{/if}
		{/snippet}
	</EmptyState>
{/if}
