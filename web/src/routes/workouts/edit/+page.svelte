<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import {
		plannedZoneSeconds,
		ZONE_BG,
		ZONE_NAMES,
		zoneOf,
	} from '$lib/components/zones';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { formatClock } from '$lib/format';
	import { toasts } from '$lib/toast.svelte';
	import { GripVertical } from '@lucide/svelte';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import { byId, library } from '$lib/workout/library';
	import type {
		RampStep,
		SteadyStep,
		Workout,
		WorkoutStep,
	} from '$lib/workout/types';
	import { validateWorkout } from '$lib/workout/validate';

	const FTP = 265;
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

	function stepAt(path: number[]): WorkoutStep | undefined {
		let step: WorkoutStep | undefined = workout.steps[path[0]];
		for (const i of path.slice(1)) {
			if (step?.type !== 'repeat') return undefined;
			step = step.steps[i];
		}
		return step;
	}

	function siblingsOf(path: number[]): WorkoutStep[] {
		if (path.length === 1) return workout.steps;
		const parent = stepAt(path.slice(0, -1));
		return parent?.type === 'repeat' ? parent.steps : [];
	}

	const isSelected = (path: number[]) => selected?.join('.') === path.join('.');

	// The preview runs the real engine, so it cannot flatter the JSON.
	const segments = $derived(flatten(workout));
	const total = $derived(durationSeconds(workout));
	const check = $derived(validateWorkout(workout));
	const current = $derived(selected === null ? null : stepAt(selected));
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

	function stepSeconds(step: WorkoutStep): number {
		if (step.type === 'repeat') {
			return (
				step.times *
				step.steps.reduce((sum, inner) => sum + stepSeconds(inner), 0)
			);
		}
		return step.seconds;
	}

	function describe(step: WorkoutStep): string {
		if (step.type === 'repeat') return `${step.times} ×`;
		if (step.type === 'sprint') return 'all out';
		if (step.type === 'steady') {
			return step.watts !== undefined
				? `${step.watts} W`
				: `${Math.round((step.target ?? 0) * 100)}% FTP`;
		}
		return `${Math.round(step.from * 100)} → ${Math.round(step.to * 100)}% FTP`;
	}

	function zoneOfStep(step: WorkoutStep): number {
		if (step.type === 'repeat' || step.type === 'sprint') return 0;
		const fraction =
			step.type === 'steady' ? (step.target ?? 0) : (step.from + step.to) / 2;
		return zoneOf(fraction * FTP, FTP);
	}

	function add(type: 'steady' | 'ramp' | 'sprint' | 'repeat') {
		const step: WorkoutStep =
			type === 'steady'
				? { type: 'steady', seconds: 300, target: 0.75 }
				: type === 'ramp'
					? { type: 'ramp', seconds: 300, from: 0.5, to: 0.8 }
					: type === 'sprint'
						? { type: 'sprint', seconds: 15 }
						: {
								type: 'repeat',
								times: 3,
								steps: [
									{ type: 'steady', seconds: 300, target: 0.9 },
									{ type: 'steady', seconds: 180, target: 0.5 },
								],
							};
		workout.steps = [...workout.steps, step];
		selected = [workout.steps.length - 1];
	}

	function addInto(path: number[]) {
		const rep = stepAt(path);
		if (rep?.type !== 'repeat') return;
		// ponytail: steady only — over-unders are steady pairs; other types via top-level
		rep.steps.push({ type: 'steady', seconds: 300, target: 0.9 });
		selected = [...path, rep.steps.length - 1];
	}

	// Drag to reorder (#170's intuitiveness bar): native HTML5 drag, no
	// dependency. The arrow buttons stay — drag is mouse-only and the
	// keyboard path is part of the editor, not a fallback.
	let dragIndex = $state<number | null>(null);
	let dropIndex = $state<number | null>(null);
	function dropStep() {
		if (dragIndex === null || dropIndex === null || dragIndex === dropIndex) {
			dragIndex = dropIndex = null;
			return;
		}
		const next = [...workout.steps];
		const [moved] = next.splice(dragIndex, 1);
		next.splice(dropIndex > dragIndex ? dropIndex - 1 : dropIndex, 0, moved);
		workout.steps = next;
		selected = [dropIndex > dragIndex ? dropIndex - 1 : dropIndex];
		dragIndex = dropIndex = null;
	}

	function move(path: number[], by: number) {
		const arr = siblingsOf(path);
		const index = path[path.length - 1];
		const to = index + by;
		if (to < 0 || to >= arr.length) return;
		[arr[index], arr[to]] = [arr[to], arr[index]];
		selected = [...path.slice(0, -1), to];
	}

	function remove(path: number[]) {
		const arr = siblingsOf(path);
		arr.splice(path[path.length - 1], 1);
		selected = null;
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

<main class="mx-auto max-w-6xl px-6 py-8">
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
			selectedStep={selected?.[0] ?? null}
			onSelect={(i) => (selected = [i])}
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
			<h2 class="eyebrow">steps</h2>
			<ul class="mt-3 space-y-1.5">
				{#snippet stepRow(step: WorkoutStep, path: number[])}
					{@const i = path[0]}
					{@const top = path.length === 1}
					<li
						draggable={top}
						ondragstart={top
							? (e) => {
									dragIndex = i;
									e.dataTransfer?.setData('text/plain', String(i));
									if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
								}
							: undefined}
						ondragover={top
							? (e) => {
									e.preventDefault();
									const rect = e.currentTarget.getBoundingClientRect();
									dropIndex =
										e.clientY < rect.top + rect.height / 2 ? i : i + 1;
								}
							: undefined}
						ondrop={top
							? (e) => {
									e.preventDefault();
									dropStep();
								}
							: undefined}
						ondragend={top ? () => (dragIndex = dropIndex = null) : undefined}
						class="{top && dragIndex === i ? 'opacity-40' : ''} {top &&
						dropIndex === i
							? 'border-t-neon/70 border-t-2'
							: top && dropIndex === i + 1 && i === workout.steps.length - 1
								? 'border-b-neon/70 border-b-2'
								: ''} rounded-lg {top
							? 'cursor-grab active:cursor-grabbing'
							: ''}"
					>
						<button
							onclick={() => (selected = path)}
							class="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left {isSelected(
								path,
							)
								? 'bg-surface-raised border-ink/40'
								: 'border-muted/15 hover:border-muted/40'}"
						>
							{#if top}
								<GripVertical size={14} class="text-muted/50 -ml-1 shrink-0" />
							{/if}
							<span
								class="h-8 w-1.5 shrink-0 rounded-full {step.type === 'sprint'
									? 'bg-z7'
									: step.type === 'repeat'
										? 'bg-muted/40'
										: ZONE_BG[zoneOfStep(step)]}"
							></span>
							<span class="min-w-0 flex-1">
								<span class="block text-sm font-medium capitalize"
									>{step.type}</span
								>
								<span class="text-muted block text-xs">{describe(step)}</span>
							</span>
							<span class="text-muted shrink-0 font-mono text-xs tabular-nums"
								>{formatClock(stepSeconds(step))}</span
							>
						</button>
						{#if step.type === 'repeat'}
							<!-- The repeat's own steps, indented and just as editable (#255). -->
							<ul class="mt-1.5 mb-1 ml-7 space-y-1.5">
								{#each step.steps as inner, j (j)}
									{@render stepRow(inner, [...path, j])}
								{/each}
								<li>
									<button
										onclick={() => addInto(path)}
										class="btn btn-secondary btn-xs">+ step</button
									>
								</li>
							</ul>
						{/if}
					</li>
				{/snippet}
				{#each workout.steps as step, i (i)}
					{@render stepRow(step, [i])}
				{/each}
			</ul>

			<div class="mt-3 flex flex-wrap gap-2">
				{#each ['steady', 'ramp', 'repeat', 'sprint'] as type (type)}
					<button
						onclick={() => add(type as 'steady' | 'ramp' | 'sprint' | 'repeat')}
						class="btn btn-secondary btn-xs capitalize">+ {type}</button
					>
				{/each}
			</div>
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
								{ZONE_NAMES[zoneOfStep(current)]}
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

					<div class="border-ink/5 flex gap-2 border-t pt-3">
						<button
							onclick={() => move(selected!, -1)}
							class="btn btn-secondary btn-xs"
							aria-label="Move step up">↑</button
						>
						<button
							onclick={() => move(selected!, 1)}
							class="btn btn-secondary btn-xs"
							aria-label="Move step down">↓</button
						>
						<button
							onclick={() => remove(selected!)}
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
