<script lang="ts">
	// "What are we doing tonight" (#115, redesigned on #181 feedback): workouts
	// and games are explicit tabs — no guessing which one you're starting — and
	// a workout answers the questions a coach actually has before committing the
	// room to it: how long, which zones, any cadence/HR bands.
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import { nextHourInput } from '$lib/components/when';
	import { ZONE_BG, plannedZoneSeconds } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import {
		fetchProgression,
		suggestedFocuses,
		type Suggestion,
	} from '$lib/progression';
	import Select from '$lib/components/Select.svelte';
	import { countModal } from '$lib/modals.svelte';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import type { ShelfEntry } from '$lib/workout/shelf';
	import type { Workout } from '$lib/workout/types';

	let {
		shelf,
		ftp,
		intent = 'start',
		busy = false,
		gameRunning = false,
		rooms = [],
		onStart,
		onPlan,
		onStartGame,
		onClose,
	}: {
		shelf: ShelfEntry[];
		ftp: number;
		/** Which question opened it: ride now, or put it on the calendar. The
		 *  old single modal answered both at once, in two stacked sections
		 *  under the preview — which is how riders stopped finding either. */
		intent?: 'start' | 'plan';
		busy?: boolean;
		gameRunning?: boolean;
		/** Rooms this plan could land in (#359) — the cross-room surface passes
		 *  them and gets a chooser; inside a room there is nothing to choose. */
		rooms?: { value: string; label: string }[];
		/** Absent when this picker only plans: no room to start anything in. */
		onStart?: (workout: Workout) => void;
		onPlan: (
			name: string,
			json: string,
			startsAtIso: string,
			roomSlug: string,
		) => void;
		/** Absent hides the Games tab — games are a room's, not a calendar's. */
		onStartGame?: (id: string) => void;
		onClose: () => void;
	} = $props();

	let tab = $state<'workouts' | 'games'>('workouts');
	// svelte-ignore state_referenced_locally
	let mode = $state<'start' | 'plan'>(onStart ? intent : 'plan');
	const title = $derived(
		mode === 'start' ? 'Start a session' : 'Plan a session',
	);

	// Find it by name or by what it trains — a shelf of 27 is a list, not a
	// menu (#115 feedback).
	let query = $state('');
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return shelf;
		return shelf.filter(
			(e) =>
				e.workout.name.toLowerCase().includes(q) ||
				(e.focus ?? '').toLowerCase().includes(q),
		);
	});
	// Grouped the way a rider thinks: what I rode lately, what today calls
	// for, what I built, then the library. A flat list of 27 sorted by a
	// recency number nobody can see reads as random.
	const groups = $derived.by(() => {
		const recent = shown.filter((e) => e.recent);
		const today = shown.filter(
			(e) => !e.recent && e.focus && suggested.includes(e.focus),
		);
		const yours = shown.filter(
			(e) => !e.recent && e.yours && !today.includes(e),
		);
		const rest = shown.filter(
			(e) => !recent.includes(e) && !today.includes(e) && !yours.includes(e),
		);
		return [
			{ label: 'recently ridden', entries: recent },
			{ label: 'suggested today', entries: today },
			{ label: 'yours', entries: yours },
			{ label: 'library', entries: rest },
		].filter((g) => g.entries.length > 0);
	});
	// svelte-ignore state_referenced_locally
	let roomSlug = $state(rooms[0]?.value ?? '');
	$effect(() => {
		if (!rooms.some((room) => room.value === roomSlug))
			roomSlug = rooms[0]?.value ?? '';
	});

	// SPEC's "suggested for today" marks matching shelf entries (#222) —
	// a hint with its why; the recency ordering and every pick stay the rider's.
	let suggestion = $state<Suggestion | null>(null);
	void fetchProgression().then((r) => {
		if (r.ok) suggestion = r.data?.load?.suggestion ?? null;
	});
	const suggested = $derived<string[]>(suggestedFocuses(suggestion));
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

	let planAt = $state(nextHourInput());

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
	{@attach countModal}
	class="border-muted/15 bg-surface fixed inset-x-4 top-[6dvh] z-50 flex flex-col overflow-hidden rounded-xl border md:right-auto md:left-1/2 md:w-[46rem] md:-translate-x-1/2"
	style="bottom: calc(6dvh + var(--pane-jukebox-dock-h, 0px))"
>
	<header class="border-ink/5 flex items-center gap-4 border-b px-5 py-3.5">
		<h2 class="font-display text-lg font-bold">{title}</h2>
		{#if mode === 'start' && onStartGame}
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
		{/if}
		<button onclick={onClose} class="text-muted hover:text-ink ml-auto text-sm"
			>Close</button
		>
	</header>

	{#if tab === 'workouts' || mode === 'plan'}
		<div class="flex min-h-0 flex-1">
			<div class="border-ink/5 flex w-60 shrink-0 flex-col border-r">
				<div class="p-2">
					<!-- Focused on open: the fastest way through 27 workouts is to
					     start typing, and nobody should have to click into the box
					     first. -->
					<input
						{@attach (node) => node.focus()}
						bind:value={query}
						placeholder="Find a workout…"
						class="input input-xs w-full"
						aria-label="find a workout"
					/>
				</div>
				<ul class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
					{#each groups as group (group.label)}
						<li class="eyebrow px-3 pt-3 pb-1">{group.label}</li>
						{#each group.entries as entry (entry.id)}
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
											>· {entry.focus ?? (entry.yours ? 'yours' : '')}</span
										></span
									>
								</button>
							</li>
						{/each}
					{:else}
						<li class="text-muted px-3 py-4 text-xs">
							Nothing matches — try a zone name, like "threshold".
						</li>
					{/each}
				</ul>
			</div>

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

					<!-- ONE primary action, for the question that opened the picker.
					     The other intent is a link, not a second section: two equal
					     panels under the preview is what made this feel weird. -->
					<div class="border-ink/5 mt-auto border-t pt-4">
						{#if mode === 'start' && onStart}
							<div class="flex flex-wrap items-center gap-3">
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium">
										Everyone in the lounge rides it with you.
									</p>
									<p class="text-muted mt-0.5 text-xs">
										A 10 s countdown, then the shared timeline starts.
									</p>
								</div>
								<button
									onclick={() => onStart(picked.workout)}
									disabled={busy}
									class="btn btn-accent btn-lg shrink-0"
									>Start {picked.workout.name}</button
								>
							</div>
							<button
								onclick={() => (mode = 'plan')}
								class="text-muted hover:text-ink mt-3 text-xs underline"
								>Plan it for later instead</button
							>
						{:else}
							<div class="flex flex-wrap items-end gap-3">
								{#if rooms.length > 0}
									<div class="min-w-40 flex-1">
										<span class="eyebrow">room</span>
										<div class="mt-1">
											<Select
												options={rooms}
												bind:value={roomSlug}
												label="Room"
											/>
										</div>
									</div>
								{/if}
								<div>
									<span class="eyebrow">when</span>
									<div class="mt-1"><WhenPicker bind:value={planAt} /></div>
								</div>
								<button
									onclick={() =>
										onPlan(
											picked.workout.name,
											JSON.stringify(picked.workout),
											new Date(planAt).toISOString(),
											roomSlug,
										)}
									disabled={busy || !planAt || (rooms.length > 0 && !roomSlug)}
									class="btn btn-primary btn-lg ml-auto shrink-0 disabled:opacity-40"
									>Plan it</button
								>
							</div>
							<p class="text-muted mt-2 text-xs">
								The room hears about it, and it lands in every subscribed
								calendar.
							</p>
							{#if onStart}
								<button
									onclick={() => (mode = 'start')}
									class="text-muted hover:text-ink mt-3 text-xs underline"
									>Start it now instead</button
								>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{:else if onStartGame}
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
