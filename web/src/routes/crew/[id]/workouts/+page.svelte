<script lang="ts">
	// The crew's Workouts (#2455, ADR-0058): what it has planned and what it
	// has ridden together, derived from its schedule and its last 90 days of
	// recaps. "Ride it again" puts a ridden workout back on the schedule in
	// one of the crew's voice channels; starting it is the channel's.
	import { invalidateAll } from '$app/navigation';
	import Banner from '$lib/components/Banner.svelte';
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import { planCrewSession } from '$lib/crew-schedule';
	import { riddenTogether, workoutByName } from '$lib/crew-workouts';
	import { formatWhen } from '$lib/format';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { customWorkouts } from '$lib/workout/custom.svelte';
	import { buildShelf } from '$lib/workout/shelf';
	import Repeat from '@lucide/svelte/icons/repeat';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const custom = customWorkouts();
	const ridden = $derived(riddenTogether(data.recaps));
	// Where a ridden workout's definition can come from: a plan still on the
	// schedule first — it is the crew's own copy — then the rider's shelf.
	const sources = $derived([
		...data.plans.map((p) => ({ name: p.workoutName, json: p.workoutJson })),
		...buildShelf(custom.all).map((entry) => ({
			name: entry.workout.name,
			json: JSON.stringify(entry.workout),
		})),
	]);

	// A plan or a cancellation elsewhere pings the lobby (#570): re-read.
	let heard = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === heard) return;
		heard = version;
		untrack(() => void invalidateAll());
	});

	// One plan form open at a time, under the row it plans.
	let planning = $state<string | null>(null);
	let when = $state('');
	let channel = $state('');
	let busy = $state(false);
	let refusal = $state<string | null>(null);

	function open(name: string) {
		planning = name;
		when = '';
		channel = data.voice[0]?.id ?? '';
		refusal = null;
	}

	async function plan(name: string, json: string) {
		if (!data.crew) return;
		busy = true;
		const res = await planCrewSession(data.crew.id, {
			workoutName: name,
			workoutJson: json,
			startsAt: new Date(when).toISOString(),
			channelId: channel,
		});
		busy = false;
		if (!res.ok) {
			refusal = res.error.message;
			return;
		}
		planning = null;
		toasts.push(`${name} is planned for ${formatWhen(res.data.startsAt)}.`);
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Workouts · {data.crew?.name ?? 'Crew'} · WattRoom</title>
</svelte:head>

<main class="page">
	{#if data.error && data.errorCode === 'not_found'}
		<Banner tone="error">
			{data.error}
			{#snippet action()}
				<a href="/home" class="btn-link text-xs">Home</a>
			{/snippet}
		</Banner>
	{:else if data.error || !data.crew}
		<Banner tone="error">
			{data.error ?? 'The crew could not be loaded.'}
			{#snippet action()}
				<button onclick={() => void invalidateAll()} class="btn-link text-xs"
					>Retry</button
				>
			{/snippet}
		</Banner>
	{:else}
		<h1 class="page-title mb-1">Workouts</h1>
		<p class="text-muted mb-6 text-xs">
			What {data.crew.name} has planned and ridden together.
		</p>

		{#if data.plans.length === 0 && ridden.length === 0}
			<!-- Teaches, never apologizes (ux.md): what this is, and the way to
			     the first one. -->
			<div class="panel panel-xl text-center">
				<p class="text-sm">
					The workouts your crew rides together gather here — every session it
					plans, and every one it finishes.
				</p>
				<a href="/workouts" class="btn btn-primary btn-lg mt-4"
					>Pick a workout to ride together</a
				>
			</div>
		{/if}

		{#if data.plans.length > 0}
			<h2 class="eyebrow mb-2">Planned</h2>
			<ul class="mb-8 space-y-2">
				{#each data.plans as p (p.id)}
					<li class="panel flex items-center gap-3">
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium"
								>{p.workoutName}</span
							>
							<span class="text-muted block truncate text-xs">
								{formatWhen(
									p.startsAt,
									true,
								)}{#if p.channelName}{` · ${p.channelName}`}{/if}
							</span>
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if ridden.length > 0}
			<h2 class="eyebrow mb-2">Ridden together</h2>
			<ul class="space-y-2">
				<!-- One row per workout: grouped by name, so the name is unique here. -->
				{#each ridden as { name, times, lastAt } (name)}
					{@const json = workoutByName(name, sources)}
					<li class="panel">
						<div class="flex items-center gap-3">
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium">{name}</span>
								<span class="text-muted block truncate text-xs">
									{times === 1 ? 'Once' : `${times} times`} · last
									{new Date(lastAt).toLocaleDateString()}
								</span>
							</span>
							<button
								onclick={() =>
									planning === name ? (planning = null) : open(name)}
								disabled={!json || data.voice.length === 0}
								aria-expanded={planning === name}
								class="btn btn-secondary shrink-0 disabled:opacity-40"
								><Repeat size={14} /> Ride it again</button
							>
						</div>
						{#if !json}
							<p class="text-muted mt-2 text-xs">
								Not on your shelf or the schedule — whoever coached it built it.
							</p>
						{:else if data.voice.length === 0}
							<p class="text-muted mt-2 text-xs">
								{data.crew.name} has no voice channel to ride it in yet.
							</p>
						{:else if planning === name}
							<div class="border-ink/5 mt-3 border-t pt-3">
								<div class="flex flex-wrap items-end gap-3">
									<div>
										<span class="eyebrow">when</span>
										<div class="mt-1"><WhenPicker bind:value={when} /></div>
									</div>
									<label class="block">
										<span class="eyebrow">where</span>
										<select bind:value={channel} class="input mt-1 block">
											{#each data.voice as v (v.id)}
												<option value={v.id}>{v.name}</option>
											{/each}
										</select>
									</label>
									<button
										onclick={() => void plan(name, json)}
										disabled={busy || !when}
										class="btn btn-primary btn-lg ml-auto shrink-0 disabled:opacity-40"
										>Plan it</button
									>
								</div>
								{#if refusal}
									<p class="text-danger mt-2 text-xs" role="alert">{refusal}</p>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>
