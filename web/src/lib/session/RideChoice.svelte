<script lang="ts">
	/**
	 * The one way into a ride from a voice channel (#4616): with whom, then
	 * what. Every door in the channel opens it (the NowBar's Ride, a running
	 * session's line, a workout's Ride while you are in a call), pre-filled
	 * from where it was pressed. It decides; the session picker, the own ride
	 * beside a session (#2329) and the join do the rest, as before.
	 *
	 * A door with nothing to ask never opens it: outside a voice channel a
	 * workout's Ride starts at once (the rider's call, 2026-11-16).
	 */
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import Info from '@lucide/svelte/icons/info';
	import Mountain from '@lucide/svelte/icons/mountain';
	import Play from '@lucide/svelte/icons/play';
	import Radio from '@lucide/svelte/icons/radio';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';
	import Modal from '#lib/components/Modal.svelte';
	import type { ShelfEntry } from '#lib/workout/shelf.ts';
	import type { Workout } from '#lib/workout/types.ts';
	import { localDay, myPlan } from '#lib/workout/plan.svelte.ts';
	import { pickable, type RideWhat, type RideWho } from './ride-choice.ts';

	let {
		channelName,
		running,
		shelf,
		who: firstWho = null,
		pick: firstPick = null,
		onAlone,
		onJoin,
		onJoinOwn,
		onJoinFree,
		onStartBunch,
		onStartWorkout,
		onStartEach,
		onClose,
	}: {
		channelName: string;
		/** The session riding here, when one is: what and how many. */
		running: { workout: string; riders: number } | null;
		shelf: ShelfEntry[];
		who?: RideWho | null;
		/** A workout the door already chose (a card's Ride, today's plan). */
		pick?: string | null;
		/** Alone: a workout by id, or null for a free ride. */
		onAlone: (workoutId: string | null) => void;
		onJoin: () => void;
		onJoinOwn: (workout: Workout) => void;
		onJoinFree: () => void;
		onStartBunch: () => void;
		onStartWorkout: (workoutId: string | null) => void;
		onStartEach: () => void;
		onClose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let who = $state<RideWho | null>(
		firstWho === 'join' && !running ? null : firstWho,
	);
	// svelte-ignore state_referenced_locally
	let what = $state<RideWhat | null>(firstPick ? 'mine' : null);
	// svelte-ignore state_referenced_locally
	let pick = $state<string | null>(firstPick);

	const plan = myPlan();
	void plan.fresh();
	// Today's plan first, then your own, then what you rode lately: six at
	// most, and the one a door chose always among them.
	const choices = $derived(
		pickable(
			shelf,
			plan.on(localDay(new Date())).map((r) => r.workoutId),
			pick,
		),
	);
	const planned = $derived(
		new Set(plan.on(localDay(new Date())).map((r) => r.workoutId)),
	);

	const whats = $derived.by(() => {
		if (who === 'join')
			return [
				{
					id: 'session' as const,
					label: `Ride ${running?.workout ?? 'the session'} with them`,
					hint: 'One timeline, with the coach',
					icon: Radio,
				},
				{
					id: 'mine' as const,
					label: 'My own workout, in ERG',
					hint: 'From your shelf, today’s plan first',
					icon: CalendarCheck,
				},
				{
					id: 'free' as const,
					label: 'Free ride',
					hint: 'Your own watts, grade or road',
					icon: Mountain,
				},
			];
		if (who === 'start')
			return [
				{
					id: 'bunch' as const,
					label: 'One road, one bunch',
					hint: 'Everyone at the group’s mean % FTP: nobody drops, nobody rides away',
					icon: Users,
				},
				{
					id: 'mine' as const,
					label: 'A workout, everyone rides it',
					hint: 'One timeline, you coach',
					icon: CalendarCheck,
				},
				{
					id: 'free' as const,
					label: 'Each on their own',
					hint: 'Your own watts and weight: on a road you spread out',
					icon: Mountain,
				},
			];
		return [
			{
				id: 'mine' as const,
				label: 'A workout',
				hint: 'From your shelf, today’s plan first',
				icon: CalendarCheck,
			},
			{
				id: 'free' as const,
				label: 'Free ride',
				hint: 'Grade from a road, your gears',
				icon: Mountain,
			},
		];
	});

	// An answer the new question no longer offers is cleared, not kept.
	$effect(() => {
		if (what && !whats.some((w) => w.id === what)) what = null;
	});

	// The workout list is asked only where a workout is ridden by you alone
	// or beside a session; a session's workout is chosen in its own picker.
	// A door's own pick shows from the start, before with whom is answered.
	const listsWorkouts = $derived(what === 'mine' && who !== 'start');
	const ready = $derived(
		who !== null && what !== null && (!listsWorkouts || pick !== null),
	);
	const startLabel = $derived(
		who === 'join'
			? 'Join'
			: who === 'start'
				? what === 'free'
					? 'Start the session'
					: 'Choose it'
				: 'Ride',
	);

	function go() {
		if (!ready) return;
		const entry = choices.find((e) => e.id === pick);
		if (who === 'alone') return onAlone(what === 'mine' ? pick : null);
		if (who === 'join') {
			if (what === 'session') return onJoin();
			if (what === 'free') return onJoinFree();
			if (entry) return onJoinOwn(entry.workout);
			return;
		}
		if (what === 'bunch') return onStartBunch();
		if (what === 'free') return onStartEach();
		return onStartWorkout(pick);
	}

	const choice = (on: boolean) =>
		`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left min-h-14 ${
			on
				? 'border-neon bg-surface-raised ring-neon/50 ring-2'
				: 'border-ink/10 hover:bg-surface-raised'
		}`;
</script>

<Modal label="Ride" onclose={onClose} class="max-w-2xl">
	<p class="eyebrow">ride</p>
	{#if running}
		<p class="text-muted mt-1 text-xs">
			<span class="font-display">{running.riders}</span> riding {running.workout}
			in {channelName}
		</p>
	{/if}

	<div class="mt-4 grid gap-5 md:grid-cols-2">
		<div>
			<h2 class="text-sm font-semibold">With whom</h2>
			<div class="mt-2 flex flex-col gap-2">
				<button class={choice(who === 'alone')} onclick={() => (who = 'alone')}>
					<User size={20} class="shrink-0" />
					<span>
						<span class="block font-semibold">Alone</span>
						<span class="text-muted text-xs">Your own ride, saved to you</span>
					</span>
				</button>
				{#if running}
					<button class={choice(who === 'join')} onclick={() => (who = 'join')}>
						<Users size={20} class="shrink-0" />
						<span>
							<span class="block font-semibold">Join the session</span>
							<span class="text-muted text-xs"
								><span class="font-display">{running.riders}</span> riding in {channelName}</span
							>
						</span>
					</button>
				{:else}
					<button
						class={choice(who === 'start')}
						onclick={() => (who = 'start')}
					>
						<Radio size={20} class="shrink-0" />
						<span>
							<span class="block font-semibold">Start a session</span>
							<span class="text-muted text-xs"
								>{channelName} rides with you, you coach</span
							>
						</span>
					</button>
				{/if}
			</div>
		</div>

		<div class={who === null ? 'opacity-40' : ''}>
			<h2 class="text-sm font-semibold">What</h2>
			<div class="mt-2 flex flex-col gap-2">
				{#each whats as w (w.id)}
					<button
						class={choice(what === w.id)}
						disabled={who === null}
						onclick={() => (what = w.id)}
					>
						<w.icon size={20} class="shrink-0" />
						<span>
							<span class="block font-semibold">{w.label}</span>
							<span class="text-muted text-xs">{w.hint}</span>
						</span>
					</button>
				{/each}
			</div>
			{#if listsWorkouts}
				<div class="mt-3 flex flex-wrap gap-2" aria-label="workout">
					{#each choices as entry (entry.id)}
						<button
							onclick={() => (pick = entry.id)}
							aria-pressed={pick === entry.id}
							class="btn {pick === entry.id ? 'btn-primary' : 'btn-secondary'}"
						>
							{#if planned.has(entry.id)}<CalendarCheck size={14} />{/if}
							{entry.workout.name}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	{#if who === 'join' && (what === 'mine' || what === 'free')}
		<p
			class="border-ink/10 mt-4 flex gap-2 rounded-lg border px-4 py-3 text-sm"
		>
			<Info size={16} class="mt-0.5 shrink-0" />
			You stay in the session: its voice, its board, your numbers beside theirs. Your
			{what === 'mine' ? 'trainer follows your workout' : 'ride is your own'},
			so your distance is not theirs and you are not in the bunch.
		</p>
	{:else if who === 'start' && what === 'free'}
		<p
			class="border-ink/10 mt-4 flex gap-2 rounded-lg border px-4 py-3 text-sm"
		>
			<Info size={16} class="mt-0.5 shrink-0" />
			<span>
				Each on their own, everyone's own watts and weight move them, so on a
				road the channel spreads out. To stay together, pick
				<button class="btn-link" onclick={() => (what = 'bunch')}
					>One road, one bunch</button
				>.
			</span>
		</p>
	{/if}

	<div class="mt-5 flex items-center justify-end gap-3">
		<button onclick={onClose} class="btn btn-ghost btn-lg">Cancel</button>
		<button onclick={go} disabled={!ready} class="btn btn-primary btn-lg"
			><Play size={16} /> {startLabel}</button
		>
	</div>
</Modal>
