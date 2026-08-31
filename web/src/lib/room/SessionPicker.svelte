<script lang="ts">
	// "What are we doing tonight" (#115, redesigned on #181 feedback): workouts
	// and games are explicit tabs — no guessing which one you're starting — and
	// a workout answers the questions a coach actually has before committing the
	// room to it: how long, which zones, any cadence/HR bands.
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import { ZONE_BG, plannedZoneSeconds } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import type { Workout } from '$lib/workout/types';

	interface ShelfEntry {
		id: string;
		yours: boolean;
		focus?: string;
		summary?: string;
		workout: Workout;
	}

	let {
		shelf,
		ftp,
		busy = false,
		gameRunning = false,
		onStart,
		onPlan,
		onStartGame,
		onClose,
	}: {
		shelf: ShelfEntry[];
		ftp: number;
		busy?: boolean;
		gameRunning?: boolean;
		onStart: (workout: Workout) => void;
		onPlan: (name: string, json: string, startsAtIso: string) => void;
		onStartGame: (id: string) => void;
		onClose: () => void;
	} = $props();

	let tab = $state<'workouts' | 'games'>('workouts');
	// Initial selection only — picked falls back to shelf[0] if the shelf
	// re-sorts under it (recency loads async).
	// svelte-ignore state_referenced_locally
	let pickedId = $state(shelf[0]?.id ?? '');
	const picked = $derived(
		shelf.find((entry) => entry.id === pickedId) ?? shelf[0],
	);
	const segments = $derived(picked ? flatten(picked.workout) : []);
	const total = $derived(picked ? durationSeconds(picked.workout) : 0);

	// Zone breakdown: where the time actually goes, in the graph's colours.
	const zoneChips = $derived(
		plannedZoneSeconds(segments, ftp)
			.map((seconds, zone) => ({ zone, seconds }))
			.filter((entry) => entry.zone > 0 && entry.seconds > 0)
			.map((entry) => ({
				zone: entry.zone,
				minutes: Math.max(1, Math.round(entry.seconds / 60)),
			})),
	);

	// Cadence/HR bands (#66/#67) — the picker is where they were invisible.
	const bandChips = $derived.by(() => {
		const chips = new Set<string>();
		const phrase = (low: number | undefined, high: number | undefined) =>
			low !== undefined && high !== undefined
				? `${low}–${high}`
				: high !== undefined
					? `under ${high}`
					: `over ${low}`;
		for (const seg of segments) {
			if (seg.cadenceLow !== undefined || seg.cadenceHigh !== undefined)
				chips.add(`${phrase(seg.cadenceLow, seg.cadenceHigh)} rpm`);
			if (seg.hrLow !== undefined || seg.hrHigh !== undefined)
				chips.add(`${phrase(seg.hrLow, seg.hrHigh)} bpm`);
		}
		return [...chips];
	});

	let planAt = $state(defaultPlanAt());
	function defaultPlanAt(): string {
		const t = new Date(Date.now() + 60 * 60 * 1000);
		t.setMinutes(0, 0, 0);
		t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
		return t.toISOString().slice(0, 16); // datetime-local format
	}

	// One line each, straight from docs/SPEC.md's parameter table.
	const GAMES = [
		{
			id: 'backyard-ramp',
			label: 'Backyard Ramp',
			blurb:
				'Survive the ramp — every 3-min round adds 5 % FTP. Last rider standing.',
		},
		{
			id: 'collective-ramp',
			label: 'Collective Ramp',
			blurb: 'The same ramp, held by the room average — you survive together.',
		},
		{
			id: 'floor-is-lava',
			label: 'Floor is Lava',
			blurb:
				'Stay in the called zone. More than 5 s outside burns a life; three lives.',
		},
		{
			id: 'watt-golf',
			label: 'Watt Golf',
			blurb:
				'Hit the called watts with the meter hidden — lowest deviation wins the hole.',
		},
		{
			id: 'sprint-roulette',
			label: 'Sprint Roulette',
			blurb:
				'A klaxon, 3 s warning, then 10–15 s flat out. Best 5 s w/kg takes it.',
		},
		{
			id: 'points-race',
			label: 'Points Race',
			blurb:
				'Sprint points, execution points, zone-streak points — most points wins.',
		},
		{
			id: 'team-relay',
			label: 'Team Relay',
			blurb:
				'One rider on front at 110 % FTP, the rest sit in — rotate, rack up distance.',
		},
	];
</script>

<button
	class="bg-paper/50 fixed inset-0 z-40"
	aria-label="Close session setup"
	onclick={onClose}
></button>
<div
	class="border-muted/15 bg-surface fixed inset-x-4 top-[6dvh] bottom-[6dvh] z-50 flex flex-col overflow-hidden rounded-xl border md:right-auto md:left-1/2 md:w-[46rem] md:-translate-x-1/2"
>
	<header class="border-ink/5 flex items-center gap-4 border-b px-5 py-3.5">
		<h2 class="font-display text-lg font-bold">Tonight's session</h2>
		<div class="border-muted/20 flex gap-1 rounded border p-0.5">
			<button
				onclick={() => (tab = 'workouts')}
				class="rounded px-3 py-1 text-xs {tab === 'workouts'
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}">Workouts</button
			>
			<button
				onclick={() => (tab = 'games')}
				class="rounded px-3 py-1 text-xs {tab === 'games'
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}">Games</button
			>
		</div>
		<button onclick={onClose} class="text-muted hover:text-ink ml-auto text-sm"
			>Close</button
		>
	</header>

	{#if tab === 'workouts'}
		<div class="flex min-h-0 flex-1">
			<ul class="border-ink/5 w-56 shrink-0 overflow-y-auto border-r p-2">
				{#each shelf as entry (entry.id)}
					<li>
						<button
							onclick={() => (pickedId = entry.id)}
							class="w-full rounded px-3 py-2.5 text-left {picked?.id ===
							entry.id
								? 'bg-surface-raised text-ink'
								: 'text-muted hover:text-ink'}"
						>
							<span class="block truncate text-sm font-medium"
								>{entry.workout.name}</span
							>
							<span class="block font-mono text-[11px] tabular-nums"
								>{formatClock(durationSeconds(entry.workout))}
								<span class="text-muted/70 font-sans"
									>· {entry.yours ? 'yours' : entry.focus}</span
								></span
							>
						</button>
					</li>
				{/each}
			</ul>

			<div class="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
				{#if picked}
					<p class="font-display font-bold">{picked.workout.name}</p>
					<p class="text-muted mt-1 text-xs">{picked.summary ?? ''}</p>
					<div class="panel mt-3 overflow-hidden">
						<IntervalGraph {segments} {total} elapsed={0} {ftp} trace={[]} />
					</div>

					<!-- How long, which zones, which bands — before you commit a room. -->
					<div
						class="text-muted mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]"
					>
						<span class="font-mono tabular-nums">{formatClock(total)}</span>
						{#each zoneChips as chip (chip.zone)}
							<span class="flex items-center gap-1 font-mono tabular-nums">
								<span class="h-2 w-2 rounded-full {ZONE_BG[chip.zone]}"
								></span>Z{chip.zone}
								{chip.minutes}m
							</span>
						{/each}
						{#each bandChips as chip (chip)}
							<span
								class="border-muted/25 rounded-full border px-2 py-0.5 font-mono tabular-nums"
								>{chip}</span
							>
						{/each}
					</div>

					<div class="mt-4 flex flex-wrap items-center gap-2">
						<button
							onclick={() => onStart(picked.workout)}
							class="btn btn-primary">Start {picked.workout.name}</button
						>
					</div>
					<div class="mt-3 flex flex-wrap items-center gap-2">
						<span class="text-muted text-xs">or plan it:</span>
						<WhenPicker bind:value={planAt} />
						<button
							onclick={() =>
								onPlan(
									picked.workout.name,
									JSON.stringify(picked.workout),
									new Date(planAt).toISOString(),
								)}
							disabled={busy || !planAt}
							class="btn btn-secondary disabled:opacity-40">Plan</button
						>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto p-4">
			{#if gameRunning}
				<p class="text-muted mb-3 text-xs">
					A game is already running — end it before starting another.
				</p>
			{/if}
			<div class="grid gap-2 sm:grid-cols-2">
				{#each GAMES as game (game.id)}
					<div
						class="border-muted/15 flex flex-col rounded-lg border px-4 py-3"
					>
						<p class="font-display text-sm font-bold">{game.label}</p>
						<p class="text-muted mt-1 flex-1 text-xs leading-relaxed">
							{game.blurb}
						</p>
						<button
							onclick={() => onStartGame(game.id)}
							disabled={gameRunning}
							class="btn btn-secondary btn-xs mt-3 self-start disabled:opacity-40"
							>Start game</button
						>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
