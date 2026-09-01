<script lang="ts">
	// Column 3 when you are not standing in a room. These pages do not get
	// redesigned by ADR-0020 — they get RE-FRAMED: the horizontal top nav is
	// gone (it is column 2 now), so what they have to prove here is that their
	// content survives ~700 px instead of a full-width page.
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import RidingBars from './RidingBars.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { plannedZoneSeconds } from '$lib/components/zones';
	import type { Segment } from '$lib/workout/types';
	import { RAIL_ROOMS } from './shape';
	import {
		CalendarClock,
		ChevronDown,
		GripVertical,
		Plus,
		Gauge,
		Radio,
		Sparkles,
	} from '@lucide/svelte';

	let {
		screen,
		segments,
		total,
	}: { screen: string; segments: Segment[]; total: number } = $props();

	const zones = $derived(plannedZoneSeconds(segments, 265));

	const shelf = [
		{ name: 'Sweet Spot 2×20', min: 65, focus: 'sweet spot', suggested: true },
		{ name: 'VO₂ 5×3', min: 48, focus: 'vo₂ max' },
		{ name: 'Endurance 90', min: 90, focus: 'endurance' },
		{ name: 'Over-Unders 4×8', min: 58, focus: 'threshold' },
	];
	const steps = [
		{ label: 'Warm-up', detail: '10:00 · 45 → 70 %' },
		{ label: 'Repeat ×2', detail: 'two children', repeat: true },
		{ label: 'Steady', detail: '20:00 · 90 %', child: true },
		{ label: 'Steady', detail: '5:00 · 55 %', child: true },
		{ label: 'Cool-down', detail: '5:00 · 60 → 40 %' },
	];
</script>

{#if screen === 'home'}
	<div class="mx-auto w-full max-w-3xl px-5 py-6">
		<h2 class="font-display text-2xl font-bold tracking-tight">
			Evening, Jan.
		</h2>
		<p class="text-muted mt-1 text-sm">
			Thursday Sufferfest is riding right now — 12 minutes in.
		</p>
		<a href="#room-lounge" class="btn btn-accent btn-lg mt-4"
			><Radio size={15} /> Join the ride</a
		>

		<h3 class="eyebrow mt-8">around right now</h3>
		<ul class="mt-2 space-y-1.5">
			{#each RAIL_ROOMS.filter((r) => r.connected > 0) as room (room.slug)}
				<li class="panel flex items-center gap-3 px-4 py-2.5">
					<span class="text-base">{room.icon}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{room.name}</span>
						<span class="text-muted block truncate text-[11px]"
							>{room.riders.join(', ')}</span
						>
					</span>
					{#if room.session}
						<span class="text-watt flex shrink-0 items-center gap-1.5 text-xs">
							<RidingBars size={10} /> riding
						</span>
					{/if}
				</li>
			{/each}
		</ul>

		<h3 class="eyebrow mt-8">your week</h3>
		<div class="panel mt-2 grid grid-cols-3 gap-4 px-4 py-3">
			{#each [{ k: 'rides', v: '3' }, { k: 'in the saddle', v: '3 h 10' }, { k: 'work', v: '2 140 kJ' }] as stat (stat.k)}
				<div>
					<p class="eyebrow">{stat.k}</p>
					<p class="font-display text-2xl font-bold tabular-nums">{stat.v}</p>
				</div>
			{/each}
		</div>

		<!-- /sessions retires into this (ADR-0020): a cross-room list of what is
		     coming was never a destination of its own — it is the second half of
		     "what is happening", which is what Home is for. Per-room planning
		     stays in the room's own Sessions place. -->
		<div class="mt-8 flex items-center gap-3">
			<h3 class="eyebrow">what's next</h3>
			<button class="btn btn-ghost btn-xs ml-auto"
				><Plus size={12} /> Plan a session</button
			>
		</div>
		<ul class="mt-2 space-y-1.5">
			{#each [{ room: '🔥 Thursday Sufferfest', name: 'Sweet Spot 2×20', when: 'Thu 20:00', by: 'Nina' }, { room: '🌄 Sunday Long Ride', name: 'Endurance 90', when: 'Sun 09:00', by: 'You' }, { room: '🚴 mfw-5', name: 'VO₂ 5×3', when: 'Tue 18:30', by: 'Jonas' }] as entry (entry.name)}
				<li class="panel flex items-center gap-3 px-4 py-2.5">
					<CalendarClock size={15} class="text-muted shrink-0" />
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{entry.name}</span>
						<span class="text-muted block truncate text-[11px]"
							>{entry.when} · {entry.room} · planned by {entry.by}</span
						>
					</span>
					<button
						class="text-muted hover:text-ink shrink-0 text-[11px] underline"
						>move</button
					>
				</li>
			{/each}
		</ul>
		<button class="text-muted hover:text-ink mt-2 text-[11px] underline"
			>subscribe to your sessions</button
		>
	</div>
{:else if screen === 'rooms'}
	<div class="mx-auto w-full max-w-3xl px-5 py-6">
		<div class="mb-5 flex items-center gap-3">
			<h2 class="font-display text-2xl font-bold tracking-tight">Rooms</h2>
			<button class="btn btn-primary btn-xs ml-auto"
				><Plus size={13} /> Open a room</button
			>
		</div>
		<!-- Column 1 is the switcher; this page is the paperwork — who is in
		     them, who owns them, how to get someone else in. -->
		<ul class="space-y-2">
			{#each RAIL_ROOMS as room (room.slug)}
				<li class="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
					<span class="text-lg">{room.icon}</span>
					<div class="min-w-0 flex-1">
						<p class="font-display truncate text-base font-bold">{room.name}</p>
						<p class="text-muted mt-0.5 text-xs">
							{room.members} member{room.members === 1 ? '' : 's'}
							{#if room.connected}
								· <span class="text-z4">{room.connected} here now</span>
							{/if}
							{#if room.session}
								· <span class="text-watt glow-text">riding</span>
							{/if}
						</p>
					</div>
					<span class="flex shrink-0 gap-2">
						<button class="btn btn-secondary btn-xs">Invite</button>
						<a href="#room-lounge" class="btn btn-primary btn-xs">Open</a>
					</span>
				</li>
			{/each}
		</ul>
		<p class="text-muted/70 mt-3 text-[11px]">
			You own 2 of 3 rooms. A third is the cap.
		</p>

		<h3 class="eyebrow mt-8">join with a code</h3>
		<form class="mt-2 flex gap-2">
			<input class="input flex-1" placeholder="six characters" />
			<button class="btn btn-secondary">Join</button>
		</form>
	</div>
{:else if screen === 'sessions'}
	<div class="mx-auto w-full max-w-3xl px-5 py-6">
		<div class="mb-1 flex items-center gap-3">
			<h2 class="font-display text-2xl font-bold tracking-tight">Sessions</h2>
			<button class="btn btn-primary btn-xs ml-auto"
				><Plus size={13} /> Plan a session</button
			>
		</div>
		<!-- Same PLACE as the room's Sessions, with no room selected — which is
		     the whole argument for a place having a URL (ADR-0020). -->
		<p class="text-muted mb-5 text-xs">
			Every room you can run a session in, on one list.
		</p>
		<h3 class="eyebrow">coming up</h3>
		<ul class="mt-2 space-y-2">
			{#each [{ room: '🔥 Thursday Sufferfest', name: 'Sweet Spot 2×20', when: 'Thu 20:00', by: 'Nina' }, { room: '🌄 Sunday Long Ride', name: 'Endurance 90', when: 'Sun 09:00', by: 'You' }, { room: '🚴 mfw-5', name: 'VO₂ 5×3', when: 'Tue 18:30', by: 'Jonas' }] as entry (entry.name)}
				<li class="panel flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
					<div class="min-w-0 flex-1">
						<p class="eyebrow">{entry.room}</p>
						<p class="font-display truncate text-base font-bold">
							{entry.name}
						</p>
						<p class="text-muted mt-0.5 text-xs">
							{entry.when} · planned by {entry.by}
						</p>
					</div>
					<span class="flex shrink-0 gap-3">
						<button class="text-muted hover:text-ink text-[11px] underline"
							>move</button
						>
						<button class="text-muted hover:text-ink text-[11px] underline"
							>cancel</button
						>
					</span>
				</li>
			{/each}
		</ul>
	</div>
{:else if screen === 'workouts'}
	<div class="mx-auto w-full max-w-3xl px-5 py-6">
		<div class="mb-5 flex items-center gap-3">
			<h2 class="font-display text-2xl font-bold tracking-tight">Workouts</h2>
			<a href="#editor" class="btn btn-primary btn-xs ml-auto"
				><Plus size={13} /> New workout</a
			>
		</div>
		<h3 class="eyebrow">your workouts</h3>
		<ul class="mt-2 space-y-2">
			{#each shelf.slice(0, 2) as entry (entry.name)}
				<li class="panel px-4 py-3">
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<p class="font-display flex-1 truncate text-base font-bold">
							{entry.name}
						</p>
						{#if entry.suggested}
							<span
								class="border-neon/40 text-muted flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
								><Sparkles size={10} /> suggested for today</span
							>
						{/if}
						<span class="text-muted shrink-0 text-xs">{entry.min} min</span>
						<a href="#ride" class="btn btn-accent btn-xs shrink-0">Ride</a>
					</div>
					<div class="mt-2 h-14">
						<IntervalGraph
							{segments}
							{total}
							elapsed={0}
							ftp={265}
							trace={[]}
							compact
						/>
					</div>
				</li>
			{/each}
		</ul>
		<!-- /ramp retires here: a ramp test is a workout you start, not a page
		     you visit. It keeps its own screen because what it DOES is different
		     — it writes your FTP — but it is reached from the shelf. -->
		<h3 class="eyebrow mt-8">measure</h3>
		<ul class="mt-2">
			<li class="panel flex items-center gap-3 px-4 py-2.5">
				<Gauge size={15} class="text-muted shrink-0" />
				<span class="min-w-0 flex-1">
					<span class="block truncate text-sm font-medium">Ramp test</span>
					<span class="text-muted block truncate text-[11px]"
						>~20 min · sets your FTP, and suggests an LTHR</span
					>
				</span>
				<a href="#ramp" class="btn btn-accent btn-xs shrink-0">Start</a>
			</li>
		</ul>

		<h3 class="eyebrow mt-8">curated</h3>
		<ul class="mt-2 space-y-1.5">
			{#each shelf.slice(2) as entry (entry.name)}
				<li class="panel flex items-center gap-3 px-4 py-2.5">
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{entry.name}</span>
						<span class="eyebrow">{entry.focus}</span>
					</span>
					<span class="text-muted shrink-0 text-xs">{entry.min} min</span>
					<a href="#ride" class="btn btn-secondary btn-xs shrink-0">Ride</a>
				</li>
			{/each}
		</ul>
	</div>
{:else if screen === 'editor'}
	<!-- The tightest screen in the app: three panes that used to have the full
	     window. If ADR-0020's column budget breaks anything, it breaks here. -->
	<div class="flex h-full min-h-0 flex-col px-5 py-4">
		<div class="mb-3 flex shrink-0 items-center gap-3">
			<input
				class="input font-display flex-1 font-bold"
				value="Sweet Spot 2×20"
			/>
			<button class="btn btn-primary btn-xs">Save</button>
		</div>
		<div class="panel mb-3 h-28 shrink-0 p-2">
			<IntervalGraph
				{segments}
				{total}
				elapsed={0}
				ftp={265}
				trace={[]}
				selectedStep={1}
			/>
		</div>
		<div class="grid min-h-0 flex-1 grid-cols-[1fr_15rem] gap-3">
			<div class="min-h-0 overflow-y-auto">
				<h3 class="eyebrow mb-1.5">steps</h3>
				<ul class="space-y-1">
					{#each steps as step, i (step.label + i)}
						<li
							class="panel flex items-center gap-2 px-2.5 py-2 text-xs {step.child
								? 'ml-5'
								: ''} {i === 1 ? 'border-neon/50' : ''}"
						>
							<GripVertical size={13} class="text-muted/50 shrink-0" />
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium">{step.label}</span>
								<span class="text-muted block truncate text-[10px]"
									>{step.detail}</span
								>
							</span>
							{#if step.repeat}<ChevronDown size={13} class="text-muted" />{/if}
						</li>
					{/each}
				</ul>
			</div>
			<div class="min-h-0 overflow-y-auto">
				<h3 class="eyebrow mb-1.5">step</h3>
				<div class="panel space-y-3 p-3">
					{#each [{ l: 'duration', v: '20:00' }, { l: 'target (% FTP)', v: '90' }, { l: 'rpm from', v: '85' }, { l: 'rpm to', v: '95' }] as field (field.l)}
						<label class="block">
							<span class="eyebrow">{field.l}</span>
							<input class="input input-xs mt-0.5 w-full" value={field.v} />
						</label>
					{/each}
				</div>
				<div class="mt-3">
					<p class="eyebrow mb-1">time in zone</p>
					<ZoneBar seconds={zones} />
				</div>
			</div>
		</div>
	</div>
{/if}
