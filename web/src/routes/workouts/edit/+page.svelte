<script lang="ts">
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import StepList from './StepList.svelte';
	import {
		plannedZoneSeconds,
		ZONE_NAMES,
		zoneOfStep,
	} from '$lib/components/zones';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { formatClock } from '$lib/format';
	import { toasts } from '$lib/toast.svelte';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import {
		duplicate,
		move,
		remove,
		stepAt,
		wrapInRepeat,
	} from '$lib/workout/tree';
	import { byId, library } from '$lib/workout/library';
	import type { RampStep, SteadyStep, Workout } from '$lib/workout/types';
	import { validateWorkout } from '$lib/workout/validate';

	// The rider steers by this preview — it is the workout they are about to
	// ride — so it scales to their own FTP; 265 only covers the flicker
	// before `me` lands (#1003).
	const FTP = $derived(account.me?.ftpWatts || 265);
	const custom = createCustomStore();

	// ?from= copies a library workout as a starting point; ?w= edits a saved
	// one — the shelf lives on the account now, so ?w= hydrates when it lands.
	const editingId = page.url.searchParams.get('w');
	const fromId = page.url.searchParams.get('from') ?? '';
	const source = editingId ? undefined : byId(fromId)?.workout;

	let workout = $state<Workout>(
		source
			? { ...structuredClone(source), name: `${source.name} (copy)` }
			: {
					name: 'New workout',
					author: 'you',
					steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
				},
	);
	let hydrated = $state(!editingId);
	$effect(() => {
		if (hydrated || !custom.loaded) return;
		const saved = editingId ? custom.byId(editingId)?.workout : undefined;
		if (saved) workout = $state.snapshot(saved) as Workout;
		else status = 'That saved workout was not found — this starts fresh.';
		hydrated = true;
	});
	// Selection is a path into the step tree: [i] top-level, [i, j] inside a
	// repeat — that's what makes repeat children editable in the same inspector.
	let selected = $state<number[] | null>([0]);
	let status = $state<string | null>(
		!editingId && fromId && !source
			? 'That workout link didn’t match anything — this starts fresh.'
			: null,
	);

	// The preview runs the real engine, so it cannot flatter the JSON.
	const segments = $derived(flatten(workout));
	const total = $derived(durationSeconds(workout));
	const check = $derived(validateWorkout(workout));
	const current = $derived(
		selected === null ? null : stepAt(workout, selected),
	);
	const zones = $derived(plannedZoneSeconds(segments, FTP));

	// Riders think in minutes (#126): "8:30" or a bare "10" (minutes) — raw
	// seconds were a dev unit that leaked into the UI.
	function parseDuration(raw: string): number | null {
		const text = raw.trim();
		const clock = /^(\d+):([0-5]\d)$/.exec(text);
		const seconds = clock
			? Number(clock[1]) * 60 + Number(clock[2])
			: /^\d+$/.test(text)
				? Number(text) * 60
				: null;
		return seconds !== null && seconds >= 5 && seconds <= 24 * 60 * 60
			? seconds
			: null;
	}

	// Loading replaces the sheet with a copy — the library stays pristine and a
	// saved custom never edits in place from here (that is ?w=). Undo over
	// confirm (errors.md): the click runs, the toast is the way back.
	function load(next: Workout, asCopy: boolean) {
		const prev = $state.snapshot(workout) as Workout;
		const prevSelected = selected;
		workout = structuredClone($state.snapshot(next) as Workout);
		if (asCopy) workout.name = `${next.name} (copy)`;
		selected = null;
		toasts.push(`Loaded “${workout.name}” — this replaced your sheet.`, {
			undo: () => {
				workout = prev;
				selected = prevSelected;
			},
		});
	}

	async function save() {
		const result = await custom.save(
			$state.snapshot(workout) as Workout,
			editingId ?? undefined,
		);
		if (result.error) {
			status = result.error;
			return;
		}
		void goto(`/workouts?saved=${result.id}`);
	}
</script>

<main class="page">
	<header class="flex flex-wrap items-center gap-4">
		<!-- A visible border: an input that looks like a title never gets renamed. -->
		<input
			bind:value={workout.name}
			aria-label="Workout name"
			class="font-display border-muted/25 focus:border-muted/60 rounded border bg-transparent px-2 py-0.5 text-2xl font-bold tracking-tight outline-none"
		/>
		<span class="text-muted font-mono text-xs tabular-nums">
			{formatClock(total)} · {segments.length} blocks
		</span>
		<div class="ml-auto flex items-center gap-3">
			<a href="/workouts" class="text-muted hover:text-ink text-sm">Cancel</a>
			<button onclick={save} disabled={!check.ok} class="btn btn-primary"
				>Save</button
			>
		</div>
	</header>

	<!-- Validation is inline and constant: a rider should never press Save to find out. -->
	{#if !check.ok}
		<div class="mt-3">
			<Banner tone="error">{check.error}</Banner>
		</div>
	{:else if status}
		<div class="mt-3">
			<Banner tone="warn">{status}</Banner>
		</div>
	{/if}

	<div class="panel mt-4 overflow-hidden">
		<IntervalGraph
			{segments}
			{total}
			elapsed={0}
			ftp={FTP}
			trace={[]}
			selectedPath={selected}
			onSelect={(path) => (selected = path)}
		/>
		<div class="border-ink/5 border-t px-4 py-3">
			<ZoneBar seconds={zones} legend />
		</div>
	</div>

	<div class="mt-4 grid gap-4 lg:grid-cols-[200px_1fr_280px]">
		<aside>
			<h2 class="eyebrow">library</h2>
			<ul class="mt-3 space-y-1">
				{#each custom.all as entry (entry.id)}
					<li>
						<button
							onclick={() => load(entry.workout, entry.id !== editingId)}
							class="w-full rounded px-2.5 py-2 text-left text-sm {workout.name ===
							entry.workout.name
								? 'bg-surface-raised text-ink'
								: 'text-muted hover:text-ink'}"
						>
							{entry.workout.name}
							<span
								class="text-muted/60 block font-mono text-[10px] tabular-nums"
								>{formatClock(durationSeconds(entry.workout))} · yours</span
							>
						</button>
					</li>
				{/each}
				{#each library as entry (entry.id)}
					<li>
						<button
							onclick={() => load(entry.workout, true)}
							class="w-full rounded px-2.5 py-2 text-left text-sm {workout.name ===
							entry.workout.name
								? 'bg-surface-raised text-ink'
								: 'text-muted hover:text-ink'}"
						>
							{entry.workout.name}
							<span
								class="text-muted/60 block font-mono text-[10px] tabular-nums"
								>{formatClock(durationSeconds(entry.workout))}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		</aside>

		<section>
			<StepList {workout} bind:selected ftp={FTP} />
		</section>

		<aside>
			<h2 class="eyebrow">step</h2>
			{#if current}
				<div class="panel mt-3 space-y-4 p-4">
					{#if current.type !== 'repeat'}
						<label class="block">
							<span class="eyebrow">duration</span>
							<input
								value={formatClock(current.seconds)}
								onchange={(event) => {
									const parsed = parseDuration(event.currentTarget.value);
									if (parsed !== null) current.seconds = parsed;
									event.currentTarget.value = formatClock(current.seconds);
								}}
								class="input mt-1 w-full font-mono tabular-nums"
							/>
							<span class="text-muted mt-1 block text-[10px]"
								>m:ss — a bare number is minutes</span
							>
						</label>
					{/if}

					{#if current.type === 'steady'}
						<label class="block">
							<span class="eyebrow">target (% FTP)</span>
							<input
								type="number"
								min="20"
								max="200"
								value={Math.round((current.target ?? 0) * 100)}
								oninput={(event) =>
									((current as SteadyStep).target =
										Number(event.currentTarget.value) / 100)}
								class="input mt-1 w-full font-mono tabular-nums"
							/>
							<span class="text-muted mt-1 block text-[11px]">
								{Math.round((current.target ?? 0) * FTP)} W at {FTP} FTP ·
								{ZONE_NAMES[zoneOfStep(current, FTP)]}
							</span>
						</label>
						<!-- Cadence band (#66): display-only, and optional — most steps
						     leave it blank. Empty input = no bound on that side. -->
						<div class="grid grid-cols-2 gap-3">
							<label class="block">
								<span class="eyebrow">rpm from</span>
								<input
									type="number"
									min="51"
									max="150"
									placeholder="–"
									value={current.cadenceLow ?? ''}
									oninput={(event) =>
										((current as SteadyStep).cadenceLow =
											event.currentTarget.value === ''
												? undefined
												: Number(event.currentTarget.value))}
									class="input mt-1 w-full font-mono tabular-nums"
								/>
							</label>
							<label class="block">
								<span class="eyebrow">rpm to</span>
								<input
									type="number"
									min="30"
									max="150"
									placeholder="–"
									value={current.cadenceHigh ?? ''}
									oninput={(event) =>
										((current as SteadyStep).cadenceHigh =
											event.currentTarget.value === ''
												? undefined
												: Number(event.currentTarget.value))}
									class="input mt-1 w-full font-mono tabular-nums"
								/>
							</label>
						</div>
						<div class="grid grid-cols-2 gap-3">
							<label class="block">
								<span class="eyebrow">bpm from</span>
								<input
									type="number"
									min="60"
									max="220"
									placeholder="–"
									value={current.hrLow ?? ''}
									oninput={(event) =>
										((current as SteadyStep).hrLow =
											event.currentTarget.value === ''
												? undefined
												: Number(event.currentTarget.value))}
									class="input mt-1 w-full font-mono tabular-nums"
								/>
							</label>
							<label class="block">
								<span class="eyebrow">bpm to</span>
								<input
									type="number"
									min="60"
									max="220"
									placeholder="–"
									value={current.hrHigh ?? ''}
									oninput={(event) =>
										((current as SteadyStep).hrHigh =
											event.currentTarget.value === ''
												? undefined
												: Number(event.currentTarget.value))}
									class="input mt-1 w-full font-mono tabular-nums"
								/>
							</label>
						</div>
					{:else if current.type === 'repeat'}
						<label class="block">
							<span class="eyebrow">repeats</span>
							<input
								type="number"
								min="1"
								max="50"
								bind:value={current.times}
								class="input mt-1 w-full font-mono tabular-nums"
							/>
						</label>
						<p class="text-muted text-[11px]">
							Its steps sit indented under it in the list — click one to edit
							it.
						</p>
					{:else if current.type !== 'sprint'}
						<div class="grid grid-cols-2 gap-3">
							{#each [{ key: 'from', label: 'from' }, { key: 'to', label: 'to' }] as field (field.key)}
								<label class="block">
									<span class="eyebrow">{field.label} (%)</span>
									<input
										type="number"
										min="20"
										max="200"
										value={Math.round(
											(current as RampStep)[field.key as 'from' | 'to'] * 100,
										)}
										oninput={(event) =>
											((current as RampStep)[field.key as 'from' | 'to'] =
												Number(event.currentTarget.value) / 100)}
										class="input mt-1 w-full font-mono tabular-nums"
									/>
								</label>
							{/each}
						</div>
					{:else}
						<p class="text-muted text-xs">
							A sprint has no ERG target — the trainer switches to slope mode
							for the window and the watts are yours.
						</p>
					{/if}

					<!-- Every verb the step's right-click menu holds, visible: a menu
					     is a shortcut, never the only way (ux.md). -->
					<div class="border-ink/5 flex flex-wrap gap-2 border-t pt-3">
						<button
							onclick={() =>
								(selected = move(workout, selected!, -1) ?? selected)}
							class="btn btn-secondary btn-xs"
							aria-label="Move step up">↑</button
						>
						<button
							onclick={() =>
								(selected = move(workout, selected!, 1) ?? selected)}
							class="btn btn-secondary btn-xs"
							aria-label="Move step down">↓</button
						>
						<button
							onclick={() =>
								(selected = duplicate(workout, selected!) ?? selected)}
							class="btn btn-secondary btn-xs">Duplicate</button
						>
						{#if current.type !== 'repeat'}
							<button
								onclick={() =>
									(selected = wrapInRepeat(workout, selected!) ?? selected)}
								class="btn btn-secondary btn-xs">Wrap in a repeat</button
							>
						{/if}
						<button
							onclick={() => {
								remove(workout, selected!);
								selected = null;
							}}
							class="btn btn-danger btn-xs ml-auto">Delete</button
						>
					</div>
				</div>
			{:else}
				<p
					class="text-muted border-muted/10 mt-3 rounded-lg border border-dashed p-4 text-xs"
				>
					Pick a step to edit it. The graph above redraws as you type — it runs
					the same engine the ride does.
				</p>
			{/if}
		</aside>
	</div>
</main>
