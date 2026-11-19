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
	 *
	 * It asks only what nothing after it asks. Alone goes to the ride card,
	 * which holds workout or free ride, the road and the games; a workout is
	 * chosen in the full picker, never from a short list here.
	 */
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Info from '@lucide/svelte/icons/info';
	import Mountain from '@lucide/svelte/icons/mountain';
	import Play from '@lucide/svelte/icons/play';
	import Radio from '@lucide/svelte/icons/radio';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';
	import Modal from '#lib/components/Modal.svelte';
	import type { RideWhat, RideWho } from './ride-choice.ts';

	let {
		channelName,
		running,
		who: firstWho = null,
		pick = null,
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
		who?: RideWho | null;
		/** A workout the door already chose (a card's Ride, today's plan):
		 *  what the card or the picker after this opens on. */
		pick?: string | null;
		/** Alone: onto the ride card, on the door's workout when it chose one. */
		onAlone: (workoutId: string | null) => void;
		onJoin: () => void;
		/** Your own workout beside the session: the picker chooses it. */
		onJoinOwn: (workoutId: string | null) => void;
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
	let what = $state<RideWhat | null>(pick ? 'mine' : null);

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
					hint: 'Pick it next, from your whole shelf',
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
					hint: 'Pick it next, on a road or none. You coach',
					icon: CalendarCheck,
				},
				{
					id: 'free' as const,
					label: 'Each on their own',
					hint: 'Your own watts and weight: on a road you spread out',
					icon: Mountain,
				},
			];
		return [];
	});

	// An answer the new question no longer offers is cleared, not kept.
	$effect(() => {
		if (what && !whats.some((w) => w.id === what)) what = null;
	});

	// Alone asks nothing more here: the ride card is where it is set up,
	// workout or free ride and the road under it.
	const ready = $derived(who === 'alone' || (who !== null && what !== null));
	// Only a join and Each on their own ride at once; the rest go on to a
	// picker or the card, and the button says so.
	const now = $derived(
		(who === 'join' && what === 'session') ||
			(who === 'start' && what === 'free'),
	);
	const startLabel = $derived(
		who === 'join' && what === 'session'
			? 'Join'
			: who === 'start' && what === 'free'
				? 'Start the session'
				: 'Next',
	);

	function go() {
		if (!ready) return;
		if (who === 'alone') return onAlone(pick);
		if (who === 'join') {
			if (what === 'session') return onJoin();
			if (what === 'free') return onJoinFree();
			return onJoinOwn(pick);
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

		<div>
			<h2 class="text-sm font-semibold {who === null ? 'opacity-40' : ''}">
				What
			</h2>
			{#if who === null}
				<p class="text-muted mt-2 text-sm">Choose with whom first.</p>
			{:else if who === 'alone'}
				<!-- The ride card after this asks it, with the road: asking here
				     too made the rider answer twice. -->
				<div
					class="border-ink/10 mt-2 flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm"
				>
					<p class="flex gap-3">
						<CalendarCheck size={18} class="mt-0.5 shrink-0" />
						<span
							>{pick ? 'Your workout' : 'A workout'} or a free ride: you choose on
							the next screen.</span
						>
					</p>
					<p class="flex gap-3">
						<Mountain size={18} class="mt-0.5 shrink-0" />
						<span
							>Either rides on a road if you pick one. With a workout, ERG holds
							your targets and the road shows where you are.</span
						>
					</p>
				</div>
			{:else}
				<div class="mt-2 flex flex-col gap-2">
					{#each whats as w (w.id)}
						<button class={choice(what === w.id)} onclick={() => (what = w.id)}>
							<w.icon size={20} class="shrink-0" />
							<span>
								<span class="block font-semibold">{w.label}</span>
								<span class="text-muted text-xs">{w.hint}</span>
							</span>
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
		<button onclick={go} disabled={!ready} class="btn btn-primary btn-lg">
			{#if now}<Play size={16} />{/if}
			{startLabel}
			{#if !now}<ChevronRight size={16} />{/if}
		</button>
	</div>
</Modal>
