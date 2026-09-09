<script lang="ts">
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import Banner from '$lib/components/Banner.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { applyEdit, type GraphEdit } from '$lib/components/graph-edit';
	import StepList from './StepList.svelte';
	import {
		plannedZoneSeconds,
		ZONE_NAMES,
		zoneOfStep,
	} from '$lib/components/zones';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { formatClock } from '$lib/format';
	import { toasts } from '$lib/toast.svelte';
	import { customWorkouts } from '$lib/workout/custom.svelte';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import { createHistory, type Snapshot } from '$lib/workout/history.svelte';
	import { guardLeaving } from '$lib/ride/leave-guard.svelte';
	import { LIMITS } from '$lib/workout/validate';
	import { isTyping } from '$lib/keys';
	import {
		duplicate,
		move,
		removeAndSelect,
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
	const custom = customWorkouts();

	// ?from= copies a library workout as a starting point; ?w= edits a saved
	// one — the shelf lives on the account now, so ?w= hydrates when it lands.
	// State, not a constant: it is the PUT target, and it has to be cleared the
	// moment the sheet stops being that workout — a hydration miss or a loaded
	// copy used to keep it, so Save overwrote the saved workout with a fresh
	// sheet (audit 2026-09-09).
	const requestedId = page.url.searchParams.get('w');
	let editingId = $state(requestedId);
	const fromId = page.url.searchParams.get('from') ?? '';
	const source = requestedId ? undefined : byId(fromId)?.workout;

	let workout = $state<Workout>(
		source
			? { ...structuredClone(source), name: `${source.name} (copy)` }
			: {
					name: 'New workout',
					author: 'you',
					steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
				},
	);
	let hydrated = $state(!requestedId);
	// Twenty minutes of shaping used to leave without a word (#1711): Cancel
	// is a link and the sidebar is one tap away. The guard /ride and /ramp
	// share; a save stands it down before the navigation it triggers.
	let saved = $state(false);
	guardLeaving(() => history.canUndo && !saved, {
		title: 'Leave without saving?',
		body: 'The changes to this workout are not saved. Leave, and they are gone.',
		action: 'Leave',
		cancel: 'Stay',
	});
	$effect(() => {
		if (hydrated || !custom.loaded) return;
		// A shelf that could not be read is said below with a Retry, and Save
		// stays off: a sheet the shelf could not read must not be saved over
		// it. Not folded into `status`, which had no Retry (audit 2026-09-09).
		if (custom.error) return;
		const saved = editingId ? custom.byId(editingId)?.workout : undefined;
		if (saved) {
			workout = $state.snapshot(saved) as Workout;
			history.reset({ workout: $state.snapshot(workout) as Workout, selected });
		} else {
			status = 'That saved workout was not found — this starts fresh.';
			editingId = null;
		}
		hydrated = true;
	});
	// Selection is a path into the step tree: [i] top-level, [i, j] inside a
	// repeat — that's what makes repeat children editable in the same inspector.
	let selected = $state<number[] | null>([0]);
	let status = $state<string | null>(
		!requestedId && fromId && !source
			? 'That workout link didn’t match anything — this starts fresh.'
			: null,
	);

	// Undo/redo (#1005). One effect over the whole sheet, so every surface that
	// mutates it — the list, the inspector, a drag, #1006's graph — is covered
	// without any of them knowing history exists. $state.snapshot reads every
	// property, which is exactly the subscription this needs.
	// untracked: the seed is deliberately the sheet as it is right now — the
	// starting point undo walks back to, not a value that follows edits.
	const history = untrack(() =>
		createHistory({ workout: $state.snapshot(workout) as Workout, selected }),
	);
	$effect(() => {
		const sheet = $state.snapshot(workout) as Workout;
		// untracked: moving the selection is not an edit, and record() writes
		// state this effect must not then re-read.
		untrack(() => history.record({ workout: sheet, selected }));
	});

	function apply(entry: Snapshot | null) {
		if (!entry) return;
		workout = entry.workout;
		selected = entry.selected;
	}

	function keys(event: KeyboardEvent) {
		if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z')
			return;
		// In a field the browser's own undo is the one the rider means.
		if (isTyping(event)) return;
		event.preventDefault();
		apply(event.shiftKey ? history.redo() : history.undo());
	}

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
		return seconds !== null &&
			seconds >= LIMITS.minSeconds &&
			seconds <= LIMITS.maxSeconds
			? seconds
			: null;
	}

	// Loading replaces the sheet with a copy — the library stays pristine and a
	// saved custom never edits in place from here (that is ?w=). Undo over
	// confirm (errors.md): the click runs, the toast is the way back.
	function load(next: Workout, asCopy: boolean) {
		workout = structuredClone($state.snapshot(next) as Workout);
		if (asCopy) {
			workout.name = `${next.name} (copy)`;
			// A copy is a new workout: it saves beside the one you opened, never
			// over it. Reloading the one you opened keeps editing it.
			editingId = null;
		}
		selected = null;
		// The toast keeps its place — a load's effect is off-screen, in the
		// library column — but it undoes through the same stack ⌘Z does, so the
		// two can never disagree about what "back" means.
		toasts.push(`Loaded “${workout.name}” — this replaced your sheet.`, {
			undo: () => apply(history.undo()),
		});
	}

	// A refused save is its own slot with its own tone: it shared `status`
	// with two unrelated notices and read as a warning (#1392).
	let saveError = $state<string | null>(null);
	async function save() {
		const result = await custom.save(
			$state.snapshot(workout) as Workout,
			editingId ?? undefined,
		);
		if (result.error) {
			saveError = result.error;
			return;
		}
		saveError = null;
		saved = true;
		// The toast is the confirmation and the way to ride it; nothing read
		// the ?saved= the page used to carry.
		toasts.push(`Saved “${workout.name}” — ride it.`, {
			href: `/ride?w=${result.id}`,
		});
		void goto('/workouts');
	}

	const samePath = (a: number[] | null, b: number[] | undefined) =>
		!!a && !!b && a.length === b.length && a.every((n, i) => n === b[i]);
</script>

<svelte:head
	><title>{workout.name || 'New workout'} · Workouts · WattRoom</title
	></svelte:head
>

<svelte:window onkeydown={keys} />

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
			<!-- ⌘Z has a face (#1392): the two verbs the whole sheet answers to. -->
			<button
				onclick={() => apply(history.undo())}
				disabled={!history.canUndo}
				class="btn btn-secondary btn-xs"
				title="Undo (⌘Z)">Undo</button
			>
			<button
				onclick={() => apply(history.redo())}
				disabled={!history.canRedo}
				class="btn btn-secondary btn-xs"
				title="Redo (⇧⌘Z)">Redo</button
			>
			<a href="/workouts" class="text-muted hover:text-ink text-sm">Cancel</a>
			<button
				onclick={save}
				disabled={!check.ok || !hydrated}
				class="btn btn-primary">Save</button
			>
		</div>
	</header>

	<!-- Validation is inline and constant: a rider should never press Save to find out. -->
	{#if saveError}
		<div class="mt-3">
			<Banner tone="error">
				{saveError}
				{#snippet action()}
					<button onclick={save} class="btn-link text-xs">Try again</button>
				{/snippet}
			</Banner>
		</div>
	{:else if !check.ok}
		<div class="mt-3">
			<Banner tone="error">
				{check.error}
				{#snippet action()}
					{#if check.path && !samePath(selected, check.path)}
						<!-- The field can be three blocks below on a phone: one tap
						     selects the step, and the inspector says it again there. -->
						<button
							onclick={() =>
								(selected = check.ok ? null : (check.path ?? null))}
							class="btn-link text-xs">Show the step</button
						>
					{/if}
				{/snippet}
			</Banner>
		</div>
	{:else if !hydrated && custom.error}
		<div class="mt-3">
			<Banner tone="error">
				{custom.error} Saving waits until it loads.
				{#snippet action()}
					<button onclick={() => custom.retry()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
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
			editable
			onEdit={(edit: GraphEdit) => applyEdit(workout, edit, FTP)}
		/>
		<div class="border-ink/5 border-t px-4 py-3">
			<ZoneBar seconds={zones} legend />
		</div>
	</div>

	<!-- Source order is the phone's order (ux.md): the steps, then the step,
	     then the library — a rider used to scroll past thirty rows to reach
	     their own steps. On a desk the columns take their places by hand. -->
	<div class="mt-4 grid gap-4 lg:grid-cols-[200px_1fr_280px]">
		<section class="lg:col-start-2 lg:row-start-1">
			<StepList {workout} bind:selected ftp={FTP} />
		</section>

		<aside class="lg:col-start-3 lg:row-start-1">
			<h2 class="eyebrow">step</h2>
			{@render inspector()}
		</aside>

		<aside class="lg:col-start-1 lg:row-start-1">
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
	</div>
</main>

{#snippet inspector()}
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
						max={LIMITS.maxFraction * 100}
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
				<!-- Cadence and HR bands (#66, #67): display-only, optional,
						     and filled on three of the library's 27 workouts — folded
						     unless the step carries one (ux.md's 95 % rule; #1392).
						     Empty input = no bound on that side. -->
				<details
					open={current.cadenceLow !== undefined ||
						current.cadenceHigh !== undefined ||
						current.hrLow !== undefined ||
						current.hrHigh !== undefined}
				>
					<summary class="eyebrow cursor-pointer"
						>cadence and heart-rate bands</summary
					>
					<p class="text-muted mt-1 mb-2 text-[11px]">
						Shown on the dashboard, never scored. The rpm floor stays above 50:
						that is where the spiral guard trips.
					</p>
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
				</details>
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
					Its steps sit indented under it in the list — click one to edit it.
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
					A sprint has no ERG target — the trainer switches to slope mode for
					the window and the watts are yours.
				</p>
			{/if}

			{#if !check.ok && samePath(selected, check.path)}
				<p class="text-danger text-[11px]">{check.error}</p>
			{/if}

			<!-- Every verb the step's right-click menu holds, visible: a menu
					     is a shortcut, never the only way (ux.md). -->
			<div class="border-ink/5 flex flex-wrap gap-2 border-t pt-3">
				<button
					onclick={() => (selected = move(workout, selected!, -1) ?? selected)}
					class="btn btn-secondary btn-xs"
					aria-label="Move step up">↑</button
				>
				<button
					onclick={() => (selected = move(workout, selected!, 1) ?? selected)}
					class="btn btn-secondary btn-xs"
					aria-label="Move step down">↓</button
				>
				<button
					onclick={() => (selected = duplicate(workout, selected!) ?? selected)}
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
					onclick={() => (selected = removeAndSelect(workout, selected!))}
					class="btn btn-danger btn-xs ml-auto">Delete</button
				>
			</div>
		</div>
	{:else}
		<p
			class="text-muted border-muted/10 mt-3 rounded-lg border border-dashed p-4 text-xs"
		>
			Pick a step to edit it. The graph above redraws as you type — it runs the
			same engine the ride does.
		</p>
	{/if}
{/snippet}
