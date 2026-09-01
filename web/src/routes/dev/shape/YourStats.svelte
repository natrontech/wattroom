<script lang="ts">
	// The rest of column 3 outside a room. /profile is the interesting one:
	// ADR-0020 empties column 1 of the mixer, the voice gate and the theme
	// cycle, and this is where they land — desk settings on a desk surface.
	import Avatar from '$lib/components/Avatar.svelte';
	import FitnessChart from '$lib/components/FitnessChart.svelte';
	import FtpTrendChart from '$lib/components/FtpTrendChart.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import PowerCurveChart from '$lib/components/PowerCurveChart.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import { hrZoneRanges } from '$lib/components/zones';
	import type { Segment } from '$lib/workout/types';
	import type { RoomRider } from '$lib/room/view';
	import { formatClock } from '$lib/format';
	import { Bluetooth, Check, Zap } from '@lucide/svelte';

	let {
		screen,
		segments,
		total,
		elapsed,
		you,
	}: {
		screen: string;
		segments: Segment[];
		total: number;
		elapsed: number;
		you: RoomRider;
	} = $props();

	const rides = [
		{
			id: 'r1',
			name: 'Sweet Spot 2×20',
			when: 'yesterday',
			min: 65,
			kj: 940,
			exec: 0.92,
		},
		{
			id: 'r2',
			name: 'Endurance 90',
			when: '3 days ago',
			min: 90,
			kj: 1120,
			exec: 0.88,
		},
		{
			id: 'r3',
			name: 'VO₂ 5×3',
			when: 'last week',
			min: 48,
			kj: 610,
			exec: 0.79,
		},
	];

	// Fake but shaped like the real thing — the charts are the real components.
	const trend = Array.from({ length: 14 }, (_, i) => ({
		id: `t${i}`,
		date: `2026-0${i < 5 ? 8 : 9}-${String((i % 28) + 1).padStart(2, '0')}`,
		seconds: 3600,
		kj: 800 + i * 12,
		execution: 0.8 + (i % 5) * 0.03,
		ftp: 248 + i * 1.3,
		best20m: 262 + i * 1.4,
	}));
	const form = Array.from({ length: 60 }, (_, i) => ({
		date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
		fitness: 40 + i * 0.5 + Math.sin(i / 5) * 4,
		fatigue: 42 + Math.sin(i / 3) * 14,
		form: -2 + Math.cos(i / 4) * 9,
	}));
</script>

{#if screen === 'history'}
	<div class="mx-auto w-full max-w-3xl px-5 py-6">
		<h2 class="font-display mb-5 text-2xl font-bold tracking-tight">Rides</h2>
		<ul class="space-y-2">
			{#each rides as ride (ride.id)}
				<li class="panel px-4 py-3">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<p class="font-display flex-1 truncate text-base font-bold">
							{ride.name}
						</p>
						<span class="text-muted shrink-0 text-xs">{ride.when}</span>
					</div>
					<p class="text-muted mt-0.5 text-xs tabular-nums">
						{ride.min} min · {ride.kj} kJ · execution {Math.round(
							ride.exec * 100,
						)} %
					</p>
					<div class="mt-2 h-12">
						<IntervalGraph
							{segments}
							{total}
							elapsed={total}
							ftp={you.ftp}
							trace={you.trace}
							compact
						/>
					</div>
				</li>
			{/each}
		</ul>
	</div>
{:else if screen === 'progression'}
	<div class="mx-auto w-full max-w-3xl space-y-6 px-5 py-6">
		<h2 class="font-display text-2xl font-bold tracking-tight">Progression</h2>
		<!-- The charts are the shipped components, so the column budget is being
		     tested against the real thing rather than a rectangle. -->
		<div class="panel p-4">
			<h3 class="text-sm font-semibold">Best power by duration</h3>
			<div class="mt-3">
				<PowerCurveChart
					d30={{ best5s: 980, best1m: 520, best5m: 330, best20m: 278 }}
					d90={{ best5s: 1020, best1m: 545, best5m: 342, best20m: 285 }}
					all={{ best5s: 1105, best1m: 580, best5m: 356, best20m: 291 }}
				/>
			</div>
		</div>
		<div class="panel p-4">
			<h3 class="text-sm font-semibold">FTP over the last year</h3>
			<div class="mt-3"><FtpTrendChart rides={trend} height={200} /></div>
		</div>
		<div class="panel p-4">
			<h3 class="text-sm font-semibold">Training load</h3>
			<div class="mt-3"><FitnessChart series={form} /></div>
		</div>
	</div>
{:else if screen === 'profile'}
	<div class="mx-auto w-full max-w-2xl space-y-6 px-5 py-6">
		<div class="panel flex items-center gap-4 p-4">
			<Avatar name="You" size={56} xp={12400} />
			<div class="min-w-0 flex-1">
				<p class="font-display text-lg font-bold">Jan</p>
				<p class="eyebrow">level 12 · threshold</p>
				<div class="mt-1.5"><ProgressBar pct={62} /></div>
			</div>
		</div>

		<div class="panel grid gap-3 p-4 sm:grid-cols-3">
			{#each [{ l: 'FTP (W)', v: '265' }, { l: 'weight (kg)', v: '74' }, { l: 'LTHR (bpm)', v: '168' }] as field (field.l)}
				<label class="block">
					<span class="eyebrow">{field.l}</span>
					<input class="input mt-1 w-full tabular-nums" value={field.v} />
				</label>
			{/each}
		</div>

		<div class="panel p-4">
			<span class="eyebrow">your heart-rate zones</span>
			<ul class="mt-2 space-y-1">
				{#each hrZoneRanges(168) as zone (zone.zone)}
					<li class="flex items-baseline gap-3 text-xs">
						<span class="text-muted w-24 shrink-0"
							>Z{zone.zone} {zone.name}</span
						>
						<span class="tabular-nums"
							>{zone.low}{zone.high ? `–${zone.high}` : '+'} bpm</span
						>
					</li>
				{/each}
			</ul>
		</div>

		<!-- ADR-0020 moves these OFF column 1. They were three desk settings
		     living in a 208 px strip you also navigate rooms with. -->
		<div class="border-neon/40 bg-surface-raised rounded-lg border p-4">
			<span class="eyebrow">voice &amp; audio</span>
			<p class="text-muted mt-1 text-[11px]">
				Moved here from the rail (ADR-0020): device pickers, the voice gate and
				the per-rider mixer are things you set once at a desk, not mid-interval.
			</p>
			<div class="mt-3 space-y-3">
				{#each [{ l: 'microphone', v: 'Yeti Nano' }, { l: 'camera', v: 'FaceTime HD' }, { l: 'output', v: 'AirPods Pro' }] as device (device.l)}
					<label class="block">
						<span class="eyebrow">{device.l}</span>
						<select class="input input-xs mt-0.5 w-full"
							><option>{device.v}</option></select
						>
					</label>
				{/each}
				<div>
					<span class="eyebrow">voice gate</span>
					<input type="range" class="mt-1 w-full" value="35" />
				</div>
				<div>
					<span class="eyebrow">mixer</span>
					{#each ['Nina', 'Ruben', 'Sara'] as name (name)}
						<div class="mt-1 flex items-center gap-2">
							<span class="text-muted w-16 shrink-0 text-[11px]">{name}</span>
							<input type="range" class="min-w-0 flex-1" value="80" />
						</div>
					{/each}
				</div>
			</div>
		</div>

		<div class="panel p-4">
			<span class="eyebrow">theme</span>
			<div class="mt-2 flex flex-wrap gap-2">
				{#each ['Auto', 'Dark', 'Light'] as mode, i (mode)}
					<button
						class="rounded border px-3 py-1.5 text-xs {i === 1
							? 'border-neon text-ink'
							: 'border-muted/20 text-muted'}">{mode}</button
					>
				{/each}
			</div>
		</div>
	</div>
{:else if screen === 'pair'}
	<div class="mx-auto w-full max-w-2xl px-5 py-6">
		<h2 class="font-display text-2xl font-bold tracking-tight">Sensors</h2>
		<p class="text-muted mt-1 text-sm">
			Your trainer is the only one that matters. The rest are nice to have.
		</p>
		<ul class="mt-5 space-y-2">
			{#each [{ n: 'Smart trainer', d: 'Wahoo KICKR CORE', on: true, why: 'watts, cadence and the ERG target' }, { n: 'Heart rate', d: 'not paired', on: false, why: 'bpm and your HR zones — display only, never scored' }, { n: 'Cadence', d: 'not paired', on: false, why: 'probably nothing: your trainer already reports it' }] as sensor (sensor.n)}
				<li class="panel flex items-center gap-3 px-4 py-3">
					{#if sensor.on}
						<Zap size={16} class="text-z4 shrink-0" />
					{:else}
						<Bluetooth size={16} class="text-muted/50 shrink-0" />
					{/if}
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-medium">{sensor.n}</span>
						<span class="text-muted block text-[11px]">{sensor.why}</span>
					</span>
					{#if sensor.on}
						<span class="text-z4 shrink-0 text-xs">{sensor.d}</span>
					{:else}
						<button class="btn btn-secondary btn-xs shrink-0">Pair</button>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{:else if screen === 'ramp' || screen === 'ride'}
	<!-- Solo, but still a ride — so still the cave, and still the 3 m rules.
	     The shape does not change when the room empties: same columns, one
	     rider in them. -->
	<div class="flex h-full min-h-0 flex-col gap-3 px-5 py-4">
		<div class="flex shrink-0 items-baseline gap-4">
			<span class="font-display text-4xl font-bold tabular-nums"
				>{formatClock(elapsed)}</span
			>
			<span class="font-display ml-auto text-sm font-bold"
				>{screen === 'ramp' ? 'Ramp test' : 'Sweet Spot 2×20'}</span
			>
		</div>
		<div class="grid shrink-0 grid-cols-2 gap-3">
			<div class="panel px-4 py-3">
				<p class="eyebrow">watts</p>
				<p
					class="font-display text-watt glow-text-strong text-6xl font-bold tabular-nums"
				>
					{you.watts}
				</p>
			</div>
			<div class="panel px-4 py-3">
				<p class="eyebrow">{screen === 'ramp' ? 'step' : 'target'}</p>
				<p class="font-display text-6xl font-bold tabular-nums">
					{screen === 'ramp' ? 240 : you.target}
				</p>
			</div>
		</div>
		<div class="panel min-h-0 flex-1 p-3">
			<IntervalGraph
				{segments}
				{total}
				{elapsed}
				ftp={you.ftp}
				trace={you.trace}
			/>
		</div>
		<div class="flex shrink-0 gap-2">
			<button class="btn btn-secondary btn-lg flex-1">Pause</button>
			<button class="btn btn-danger btn-lg flex-1">End</button>
		</div>
	</div>
{:else if screen === 'whats-new'}
	<div class="mx-auto w-full max-w-2xl px-5 py-6">
		<h2 class="font-display text-2xl font-bold tracking-tight">What's new</h2>
		<div class="panel mt-5 p-4">
			<div class="flex items-baseline gap-3">
				<h3 class="font-display text-lg font-bold">2026.09.2</h3>
				<span class="eyebrow">2026-09-01</span>
			</div>
			<h4 class="eyebrow mt-4">Changed</h4>
			<ul class="text-ink/85 mt-1 space-y-1 text-sm">
				<li class="flex gap-2">
					<Check size={14} class="text-z4 mt-0.5 shrink-0" />
					The whole app now sits in one frame: your rooms on the left, the places
					inside them beside it. Switchable layouts are gone — each of them is a place
					you can link to now.
				</li>
			</ul>
		</div>
	</div>
{/if}
