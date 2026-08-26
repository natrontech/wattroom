<script lang="ts">
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import type {
		RampStep,
		SteadyStep,
		Workout,
		WorkoutStep,
	} from '$lib/workout/types';
	import IntervalGraph from '../room/IntervalGraph.svelte';
	import {
		formatClock,
		ZONE_BG,
		ZONE_NAMES,
		zoneOf,
	} from '../room/mockRoom.svelte';
	import { library } from './library';

	const FTP = 265;

	let workout = $state<Workout>(structuredClone(library[0]));
	let selected = $state<number | null>(1);

	// The preview runs the real engine, so the graph cannot flatter the JSON.
	const segments = $derived(flatten(workout));
	const total = $derived(durationSeconds(workout));

	function load(next: Workout) {
		workout = structuredClone(next);
		selected = null;
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

	function remove(index: number) {
		workout.steps = workout.steps.filter((_, i) => i !== index);
		selected = null;
	}

	function move(index: number, by: number) {
		const to = index + by;
		if (to < 0 || to >= workout.steps.length) return;
		const next = [...workout.steps];
		[next[index], next[to]] = [next[to], next[index]];
		workout.steps = next;
		selected = to;
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
		selected = workout.steps.length - 1;
	}

	const current = $derived(selected === null ? null : workout.steps[selected]);
</script>

<main class="mx-auto max-w-6xl px-6 py-8">
	<header class="flex flex-wrap items-center gap-4">
		<input
			bind:value={workout.name}
			class="font-display border-muted/20 focus:border-muted/60 hover:border-muted/20 rounded border border-transparent bg-transparent text-2xl font-bold tracking-tight outline-none"
			aria-label="Workout name"
		/>
		<span class="text-muted font-mono text-xs tabular-nums">
			{formatClock(total)} · {segments.length} blocks
		</span>
		<button
			class="ml-auto rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
			>Save</button
		>
	</header>

	<!-- Preview first: the graph is what a rider recognises, not the step list. -->
	<div
		class="border-muted/15 bg-surface-raised mt-5 overflow-hidden rounded-lg border"
	>
		<IntervalGraph {segments} {total} elapsed={0} ftp={FTP} trace={[]} />
	</div>

	<div class="mt-4 grid gap-4 lg:grid-cols-[200px_1fr_280px]">
		<!-- Library -->
		<aside>
			<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">library</h2>
			<ul class="mt-3 space-y-1">
				{#each library as entry (entry.name)}
					<li>
						<button
							onclick={() => load(entry)}
							class="w-full rounded px-2.5 py-2 text-left text-sm {workout.name ===
							entry.name
								? 'bg-surface-raised text-white'
								: 'text-muted hover:text-white'}"
						>
							{entry.name}
							<span
								class="text-muted/60 block font-mono text-[10px] tabular-nums"
								>{formatClock(durationSeconds(entry))}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		</aside>

		<!-- Steps -->
		<section>
			<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">steps</h2>
			<ul class="mt-3 space-y-1.5">
				{#each workout.steps as step, i (i)}
					<li>
						<button
							onclick={() => (selected = i)}
							class="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left {selected ===
							i
								? 'bg-surface-raised border-white/40'
								: 'border-muted/15 hover:border-muted/40'}"
						>
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
					</li>
				{/each}
			</ul>

			<div class="mt-3 flex flex-wrap gap-2">
				{#each ['steady', 'ramp', 'repeat', 'sprint'] as type (type)}
					<button
						onclick={() => add(type as 'steady' | 'ramp' | 'sprint' | 'repeat')}
						class="border-muted/25 hover:border-muted/60 rounded border px-3 py-1.5 text-xs capitalize"
						>+ {type}</button
					>
				{/each}
			</div>
		</section>

		<!-- Inspector -->
		<aside>
			<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">step</h2>
			{#if current}
				<div
					class="border-muted/15 bg-surface-raised mt-3 space-y-4 rounded-lg border p-4"
				>
					{#if current.type !== 'repeat'}
						<label class="block">
							<span class="text-muted text-[10px] tracking-wider uppercase"
								>duration (s)</span
							>
							<input
								type="number"
								min="5"
								step="5"
								bind:value={current.seconds}
								class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
							/>
						</label>
					{/if}

					{#if current.type === 'steady'}
						<label class="block">
							<span class="text-muted text-[10px] tracking-wider uppercase"
								>target (% FTP)</span
							>
							<input
								type="number"
								min="30"
								max="200"
								value={Math.round((current.target ?? 0) * 100)}
								oninput={(event) =>
									((current as SteadyStep).target =
										Number(event.currentTarget.value) / 100)}
								class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
							/>
							<span class="text-muted mt-1 block text-[11px]">
								{Math.round((current.target ?? 0) * FTP)} W at {FTP} FTP ·
								{ZONE_NAMES[zoneOfStep(current)]}
							</span>
						</label>
					{:else if current.type === 'repeat'}
						<label class="block">
							<span class="text-muted text-[10px] tracking-wider uppercase"
								>repeats</span
							>
							<input
								type="number"
								min="1"
								max="30"
								bind:value={current.times}
								class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
							/>
						</label>
						<ul class="text-muted space-y-1 text-xs">
							{#each current.steps as inner, j (j)}
								<li class="flex justify-between gap-2">
									<span class="capitalize">{inner.type}</span>
									<span class="font-mono tabular-nums">{describe(inner)}</span>
								</li>
							{/each}
						</ul>
					{:else if current.type !== 'sprint'}
						<div class="grid grid-cols-2 gap-3">
							{#each [{ key: 'from', label: 'from' }, { key: 'to', label: 'to' }] as field (field.key)}
								<label class="block">
									<span class="text-muted text-[10px] tracking-wider uppercase"
										>{field.label} (%)</span
									>
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
										class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
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

					<div class="flex gap-2 border-t border-white/5 pt-3">
						<button
							onclick={() => move(selected!, -1)}
							class="border-muted/25 hover:border-muted/60 rounded border px-3 py-1.5 text-xs"
							>↑</button
						>
						<button
							onclick={() => move(selected!, 1)}
							class="border-muted/25 hover:border-muted/60 rounded border px-3 py-1.5 text-xs"
							>↓</button
						>
						<button
							onclick={() => remove(selected!)}
							class="border-z6/40 text-z6 hover:bg-z6/10 ml-auto rounded border px-3 py-1.5 text-xs"
							>Delete</button
						>
					</div>
				</div>
			{:else}
				<p
					class="text-muted border-muted/10 mt-3 rounded-lg border border-dashed p-4 text-xs"
				>
					Pick a step to edit it. Changes redraw the graph above straight away —
					it runs the same engine the ride does.
				</p>
			{/if}
		</aside>
	</div>
</main>
