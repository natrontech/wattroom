<script lang="ts">
	// The crew's Workouts (#2455, ADR-0058): what it has planned and what it
	// has ridden together, derived from its schedule and its last 90 days of
	// recaps. "Ride it again" puts a ridden workout back on the schedule in
	// one of the crew's voice channels; starting it is the channel's.
	import { invalidateAll } from '$app/navigation';
	import { navigating } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import { account } from '$lib/account.svelte';
	import { planCrewSession, planPath } from '$lib/crew-schedule';
	import {
		riddenTogether,
		riddenTotals,
		workoutByName,
	} from '$lib/crew-workouts';
	import { formatDuration, formatWhen } from '$lib/format';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { customWorkouts } from '$lib/workout/custom.svelte';
	import { buildShelf } from '$lib/workout/shelf';
	import Repeat from '@lucide/svelte/icons/repeat';
	import RiddenCard from './RiddenCard.svelte';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const custom = customWorkouts();
	const ridden = $derived(riddenTogether(data.recaps, account.me?.id));
	const totals = $derived(riddenTotals(ridden));
	const ftp = $derived(account.me?.ftpWatts ?? 200);
	// Where a ridden workout's definition can come from: a plan still on the
	// schedule first — it is the crew's own copy — then the rider's shelf.
	const sources = $derived([
		...data.plans.map((p) => ({ name: p.workoutName, json: p.workoutJson })),
		...buildShelf(custom.all).map((entry) => ({
			name: entry.workout.name,
			json: JSON.stringify(entry.workout),
		})),
	]);

	// A plan or a cancellation elsewhere pings the lobby (#570): re-read —
	// unless the rider is already on their way out. SvelteKit hands an
	// invalidation the navigation token, so a ping during a click's load
	// cancelled the click and kept the rider here (#2591).
	let heard = untrack(() => presence.version);
	$effect(() => {
		const version = presence.version;
		if (version === heard) return;
		heard = version;
		if (untrack(() => navigating.to)) return;
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
			What {data.crew.name} has planned and ridden together in the last 90 days.
		</p>

		{#if ridden.length > 0}
			<!-- The crew's sums and your own turnout (ADR-0036), over what the
			     recaps keep: 90 days (docs/SPEC.md). -->
			<div class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="panel">
					<p class="eyebrow">sessions</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{totals.sessions}
					</p>
					<p class="text-muted text-[11px]">ridden together</p>
				</div>
				<div class="panel">
					<p class="eyebrow">workouts</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{totals.workouts}
					</p>
					<p class="text-muted text-[11px]">
						{totals.workouts === 1 ? 'one on repeat' : 'different ones'}
					</p>
				</div>
				<div class="panel">
					<p class="eyebrow">together</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{formatDuration(totals.seconds)}
					</p>
					<p class="text-muted text-[11px]">on the shared timeline</p>
				</div>
				<div class="panel">
					<p class="eyebrow">you rode</p>
					<p class="font-display text-2xl font-bold tabular-nums">
						{totals.yours}<span class="text-muted ml-1 text-sm"
							>of {totals.sessions}</span
						>
					</p>
					<p class="text-muted text-[11px]">sessions</p>
				</div>
			</div>
		{/if}

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
						<!-- To its row on the Schedule, where it is answered (#2608). -->
						<a
							href={data.crew ? planPath(data.crew.id, p.id) : undefined}
							class="min-w-0 flex-1 hover:underline"
						>
							<span class="block truncate text-sm font-medium"
								>{p.workoutName}</span
							>
							<span class="text-muted block truncate text-xs">
								{formatWhen(
									p.startsAt,
									true,
								)}{#if p.channelName}{` · ${p.channelName}`}{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		{#if ridden.length > 0}
			<h2 class="eyebrow mb-2">Ridden together</h2>
			<ul class="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
				<!-- Keyed by its newest session: a session belongs to one workout, so
				     it is unique here, and a name is nobody's key (rider-keys.test). -->
				{#each ridden as workout (workout.recaps[0].id)}
					{@const json = workoutByName(workout.name, sources)}
					<RiddenCard {workout} {json} {ftp}>
						{#snippet actions()}
							<button
								onclick={() =>
									planning === workout.name
										? (planning = null)
										: open(workout.name)}
								disabled={!json || data.voice.length === 0}
								aria-expanded={planning === workout.name}
								class="btn btn-secondary btn-xs disabled:opacity-40"
								><Repeat size={13} /> Ride it again</button
							>
							{#if json && data.voice.length === 0}
								<p class="text-muted basis-full text-xs">
									{data.crew?.name} has no voice channel to ride it in yet.
								</p>
							{:else if json && planning === workout.name}
								<div class="border-ink/5 basis-full border-t pt-3">
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
											onclick={() => void plan(workout.name, json)}
											disabled={busy || !when}
											class="btn btn-primary btn-lg ml-auto shrink-0 disabled:opacity-40"
											>Plan it</button
										>
									</div>
									{#if refusal}
										<p class="text-danger mt-2 text-xs" role="alert">
											{refusal}
										</p>
									{/if}
								</div>
							{/if}
						{/snippet}
					</RiddenCard>
				{/each}
			</ul>
		{/if}
	{/if}
</main>
