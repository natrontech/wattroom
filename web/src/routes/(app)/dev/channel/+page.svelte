<script lang="ts">
	import { play, playCountdown, playCountdownTick } from '$lib/sound/cues';
	import CheerLayer from './CheerLayer.svelte';
	import ZoneDot from '$lib/components/ZoneDot.svelte';
	import ExecutionMeter from '$lib/session/ExecutionMeter.svelte';
	import FaultBanner from '$lib/channel/FaultBanner.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import IntervalStrip from '$lib/session/IntervalStrip.svelte';
	import PlayerTile from '../PlayerTile.svelte';
	import RiderTile from '$lib/channel/RiderTile.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import SprintMoment from '$lib/session/SprintMoment.svelte';
	import SidePanel from '$lib/channel/SidePanel.svelte';
	import Stage from '$lib/channel/Stage.svelte';
	import TvMode from '$lib/session/TvMode.svelte';
	import {
		createMockChannel,
		formatClock,
		type MockRider,
		CHANNEL_NAME,
		type TileMetric,
		workout,
		zoneOf,
		type Phase,
	} from './mockChannel.svelte';

	const channel = createMockChannel();
	$effect(() => {
		void channel.start();
		return channel.stop;
	});

	const you = $derived(channel.riders.find((r) => r.you)!);
	const zone = $derived(zoneOf(you.watts, you.ftp));
	const speaking = $derived(channel.riders.find((r) => r.speaking));
	const live = $derived(channel.phase === 'live');

	let tv = $state(false);
	let stagePick = $state('screen:ada');
	// Joining a real voice channel waits on the WS handshake and LiveKit tracks; show that.
	let joining = $state(false);

	// Cues follow state rather than clicks, which is the point: you are not watching.
	// Plain object, not $state: this is only read inside the effect that writes it,
	// and $state there makes the effect invalidate itself.
	let heard: {
		phase: typeof channel.phase;
		sprint: typeof channel.sprint;
		sprintLeft: number;
		block?: number;
	} = {
		phase: channel.phase,
		sprint: channel.sprint,
		sprintLeft: channel.sprintLeft,
		block: channel.block?.index,
	};
	$effect(() => {
		if (channel.phase !== heard.phase) {
			if (channel.phase === 'countdown') playCountdown();
			heard.phase = channel.phase;
		}
		if (channel.sprint !== heard.sprint) {
			if (channel.sprint === 'armed') play('klaxon');
			if (channel.sprint === 'active') play('go');
			if (channel.sprint === 'podium') play('fanfare');
			heard.sprint = channel.sprint;
		} else if (
			channel.sprint === 'armed' &&
			channel.sprintLeft !== heard.sprintLeft &&
			channel.sprintLeft > 0 &&
			channel.sprintLeft <= 2
		) {
			playCountdownTick(channel.sprintLeft);
		}
		heard.sprintLeft = channel.sprintLeft;
		const index = channel.block?.index;
		if (
			index !== undefined &&
			heard.block !== undefined &&
			index !== heard.block
		) {
			play('block');
		}
		heard.block = index;
	});

	// One view, focus instead of layouts (#181 feedback): the Metrics/Video/Media
	// tabs are gone — tapping a tile spotlights that rider, tapping again lets go.
	let focusId = $state<string | null>(null);
	const focused = $derived(
		channel.riders.find((rider) => rider.id === focusId),
	);
	const others = $derived(
		channel.riders.filter((rider) => rider.id !== focusId),
	);

	// All three, always (#181 feedback) — the tile filters zeros itself.
	const tileMetrics: TileMetric[] = ['hr', 'cadence', 'wkg'];

	const phases: { id: Phase; label: string }[] = [
		{ id: 'lounge', label: 'Lounge' },
		{ id: 'countdown', label: 'Countdown' },
		{ id: 'live', label: 'Live' },
	];

	const readouts = $derived([
		{ label: 'rpm', value: String(you.cadence) },
		{ label: 'bpm', value: String(you.hr) },
		{ label: 'w/kg', value: (you.watts / you.kg).toFixed(1) },
		{ label: 'exec', value: `${Math.round((you.execution ?? 0) * 100)}%` },
	]);
</script>

{#if tv}
	<div class="relative h-full">
		<button
			onclick={() => (tv = false)}
			class="border-muted/30 text-muted hover:text-ink absolute bottom-4 left-4 z-10 rounded border px-3 py-1.5 text-xs"
			>Exit TV mode</button
		>
		<TvMode
			riders={channel.riders}
			segments={channel.segments}
			total={channel.total}
			elapsed={channel.elapsed}
			block={channel.block}
		/>
	</div>
{:else}
	<div class="flex h-full">
		<main
			class="relative flex min-w-0 flex-1 flex-col overflow-hidden px-5 py-4"
		>
			<CheerLayer cheers={channel.cheers} />
			<header class="flex flex-wrap items-center gap-x-5 gap-y-2 pb-4">
				<div>
					<h1 class="font-display text-lg leading-tight font-bold">
						{CHANNEL_NAME}
					</h1>
					<p class="text-muted text-xs">
						{channel.riders.length} riders ·
						{#if channel.phase === 'lounge'}
							{speaking ? `${speaking.name} is talking` : 'idle'}
						{:else}
							{workout.name}
						{/if}
					</p>
				</div>

				<!-- Dev-only: the real transition is the coach's start button. -->
				<div class="border-muted/20 ml-auto flex gap-1 rounded border p-0.5">
					{#each phases as option (option.id)}
						<button
							onclick={() => channel.setPhase(option.id)}
							class="rounded px-2.5 py-1 text-xs {channel.phase === option.id
								? 'bg-surface-raised text-ink'
								: 'text-muted hover:text-ink'}">{option.label}</button
						>
					{/each}
				</div>
				<div class="border-muted/20 flex gap-1 rounded border p-0.5">
					<button
						onclick={() => channel.breakTrainer(true)}
						class="text-muted hover:text-ink rounded px-2 py-1 text-xs"
						>Drop trainer</button
					>
					<button
						onclick={() => channel.triggerSpiral()}
						class="text-muted hover:text-ink rounded px-2 py-1 text-xs"
						>Spiral</button
					>
					<button class="text-muted hover:text-ink rounded px-2 py-1 text-xs"
						>Late join</button
					>
					<button
						onclick={() => channel.nudgeHeadphones()}
						class="text-muted hover:text-ink rounded px-2 py-1 text-xs"
						>Nudge</button
					>
					<button
						onclick={() => (
							play('cheer'),
							channel.cheer('flame', 'Ana (spectating)')
						)}
						class="text-muted hover:text-ink rounded px-2 py-1 text-xs"
						>Cheer</button
					>
					<button
						onclick={() => (joining = !joining)}
						class="text-muted hover:text-ink rounded px-2 py-1 text-xs"
						>Joining</button
					>
					<button
						onclick={() => channel.armSprint()}
						class="text-muted hover:text-ink rounded px-2 py-1 text-xs"
						>Arm sprint</button
					>
					<button
						onclick={() => channel.breakChannel(false)}
						class="text-muted hover:text-ink rounded px-2 py-1 text-xs"
						>Drop channel</button
					>
				</div>
				<button
					onclick={() => (tv = true)}
					class="border-muted/20 text-muted hover:text-ink rounded border px-2.5 py-1 text-xs"
					>TV mode</button
				>

				{#if live}
					<div class="border-muted/20 flex gap-1 rounded border p-0.5">
						<button
							onclick={() => channel.pauseSession()}
							class="rounded px-2.5 py-1 text-xs {channel.sessionPaused
								? 'bg-surface-raised text-ink'
								: 'text-muted hover:text-ink'}"
							>{channel.sessionPaused ? 'Resume' : 'Pause'}</button
						>
						<button
							onclick={() => channel.endSession()}
							class="text-danger rounded px-2.5 py-1 text-xs">End</button
						>
					</div>
					<div class="text-right">
						<div
							class="font-display text-2xl leading-none font-bold tabular-nums"
						>
							{formatClock(channel.elapsed)}
						</div>
						<div class="eyebrow">elapsed</div>
					</div>
				{/if}
			</header>

			{#if channel.headphoneNudge}
				<div
					class="border-muted/20 bg-surface-raised mb-3 flex items-center gap-3 rounded-lg border px-4 py-2.5"
				>
					<p class="text-xs">
						Music is playing and your mic is open — headphones will stop
						everyone in voice hearing it back.
					</p>
					<button
						onclick={() => channel.dismissNudge()}
						class="text-muted hover:text-ink ml-auto shrink-0 text-xs"
						>Got it</button
					>
				</div>
			{/if}

			{#if channel.sessionPaused}
				<div
					class="border-z5/40 bg-z5/10 mb-3 flex items-center gap-3 rounded-lg border px-4 py-2.5"
				>
					<span class="bg-z5 h-2 w-2 shrink-0 animate-pulse rounded-full"
					></span>
					<p class="text-xs">
						<span class="font-medium">Nina paused the session.</span>
						<span class="text-muted"
							>Targets are released — spin easy until she resumes.</span
						>
					</p>
				</div>
			{/if}

			{#if channel.spiralGuard}
				<!-- Spiral guard has to announce itself, or it reads as the trainer breaking. -->
				<div
					class="border-neon/40 bg-surface-raised mb-3 flex items-center gap-3 rounded-lg border px-4 py-2.5"
				>
					<p class="text-xs">
						<span class="font-medium">Spiral guard.</span>
						<span class="text-muted"
							>Your cadence collapsed under the target, so it's released until
							you spin back up — this is deliberate, not a dropout.</span
						>
					</p>
				</div>
			{/if}

			{#if channel.fault}
				<div class="mb-3">
					<FaultBanner
						fault={channel.fault}
						bufferedSeconds={channel.bufferedSeconds}
						onRecover={() => channel.recover()}
					/>
				</div>
			{/if}

			<!-- The stage (#280) with a fake picture: a real screenshare needs two
			     machines and a display-capture prompt, so this is the only place
			     the pick/zoom/pan/resize chrome can be eyeballed. -->
			<Stage
				sources={[
					{ key: 'screen:ada', kind: 'screen', label: "Ada's screen" },
					{ key: 'screen:you', kind: 'screen', label: 'Your screen' },
					{ key: 'cam:ada', kind: 'cam', label: 'Ada' },
				]}
				activeKey={stagePick}
				trackKey={stagePick}
				onPick={(key) => (stagePick = key)}
				attach={(node) => {
					node.replaceChildren();
					const board = document.createElement('div');
					board.style.cssText =
						'width:100%;height:100%;display:grid;place-items:center;font:600 28px system-ui;color:#fff;background:repeating-linear-gradient(45deg,#1c1030,#1c1030 24px,#2a1750 24px,#2a1750 48px)';
					board.textContent = stagePick;
					node.appendChild(board);
				}}
			/>

			<!-- Rider tiles: camera and metrics fused, ONE grid (#181 feedback) —
			     tap a tile to spotlight that rider, tap again to let go. -->
			{#snippet tile(rider: MockRider)}
				<RiderTile {rider} phase={channel.phase} metrics={tileMetrics} />
			{/snippet}
			{#if joining}
				<div class="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{#each { length: 6 } as _, i (i)}
						<Skeleton class="aspect-video w-full" />
					{/each}
				</div>
			{:else if focused}
				<button
					onclick={() => (focusId = null)}
					class="block w-full max-w-3xl text-left"
					title="tap to unfocus"
				>
					{@render tile(focused)}
				</button>
				{#if others.length > 0}
					<div
						class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6"
					>
						{#each others as rider (rider.id)}
							<button
								onclick={() => (focusId = rider.id)}
								class="block text-left"
								title="focus {rider.name}"
							>
								{@render tile(rider)}
							</button>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{#each channel.riders as rider (rider.id)}
						<button
							onclick={() => (focusId = rider.id)}
							class="block text-left"
							title="focus {rider.name}"
						>
							{@render tile(rider)}
						</button>
					{/each}
				</div>
			{/if}

			{#if channel.phase === 'countdown'}
				<div
					class="border-neon/40 bg-surface-raised mt-3 flex items-center justify-center gap-4 rounded-lg border py-6"
				>
					<span
						class="text-watt glow-text-strong font-display text-5xl leading-none font-bold tabular-nums"
						>{channel.countdown}</span
					>
					<div>
						<p class="font-display font-bold">{workout.name}</p>
						<p class="text-muted text-xs">
							Nina is starting the session — get pedalling
						</p>
					</div>
				</div>
			{:else if live}
				<div class="mt-3 flex items-center justify-end gap-5">
					{#each readouts as readout (readout.label)}
						<div class="text-right">
							<span
								class="font-display text-lg leading-none font-semibold tabular-nums"
								>{readout.value}</span
							>
							<span class="eyebrow ml-1">{readout.label}</span>
						</div>
					{/each}
					<div class="text-right">
						<span
							class="font-display text-ink inline-flex items-center gap-1 text-lg leading-none font-semibold"
							><ZoneDot {zone} />Z{zone}</span
						>
						<span class="eyebrow ml-1">zone</span>
					</div>
				</div>

				{#if channel.sprint !== 'idle'}
					<div class="mt-2">
						<!-- The real component over the mock's clock (#1593): the
						     second design that stood here drifted from it. -->
						<SprintMoment
							myWatts={channel.riders.find((r) => r.you)?.watts ?? 0}
							sprint={{
								startsAtMs:
									channel.sprint === 'armed'
										? Date.now() + channel.sprintLeft * 1000
										: Date.now() - 1_000,
								endsAtMs:
									channel.sprint === 'active'
										? Date.now() + channel.sprintLeft * 1000
										: channel.sprint === 'podium'
											? Date.now() - 1_000
											: Date.now() + 15_000 + channel.sprintLeft * 1000,
								results:
									channel.sprint === 'podium'
										? channel.podium.map((p) => ({
												riderId: p.name,
												name: p.name,
												wkg: p.wkg,
												watts: p.watts,
											}))
										: undefined,
							}}
						/>
					</div>
				{:else}
					<div class="mt-2">
						<IntervalStrip
							block={channel.block}
							bias={channel.bias}
							onBias={(step) => channel.nudgeBias(step)}
						/>
					</div>
				{/if}
				<div class="mt-2 grid gap-2 lg:grid-cols-[1fr_260px]">
					<div class="overflow-hidden rounded-lg">
						<IntervalGraph
							segments={channel.segments}
							total={channel.total}
							elapsed={channel.elapsed}
							ftp={you.ftp}
							trace={you.trace}
						/>
					</div>
					<ExecutionMeter riders={channel.riders} />
				</div>
			{:else}
				<div class="mt-3 flex flex-wrap items-center gap-3">
					<button
						class="bg-ink text-paper hover:bg-ink/90 rounded px-4 py-2 text-sm font-medium"
						>Start {workout.name}</button
					>
					<button
						class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
						>Change workout</button
					>
				</div>
			{/if}
		</main>

		<!-- Media lives in the panel now — the main area is riders and the ride. -->
		<SidePanel {live}>
			{#snippet player()}
				<PlayerTile />
			{/snippet}
		</SidePanel>
	</div>
{/if}
