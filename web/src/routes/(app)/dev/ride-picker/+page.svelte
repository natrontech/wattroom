<script lang="ts">
	/**
	 * #4616's mock: one picker as the only way into a ride, joining included.
	 * Two questions, with whom and what, each a column of big targets. Every
	 * door opens it pre-filled, and the left rail switches between doors so
	 * the states can be argued side by side. Nothing here starts a ride.
	 */
	import Bike from '@lucide/svelte/icons/bike';
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import Info from '@lucide/svelte/icons/info';
	import Mountain from '@lucide/svelte/icons/mountain';
	import Play from '@lucide/svelte/icons/play';
	import Radio from '@lucide/svelte/icons/radio';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';

	type Who = 'alone' | 'join' | 'start';
	type What = 'session' | 'mine' | 'free';

	// Made-up data: a voice channel with a session running, a shelf, a plan.
	const running = {
		workout: '3×8 @ 130–135 W',
		coach: 'Sandra',
		riders: 4,
		minute: 12,
	};
	const today = 'Easy spin 45 min';
	const shelf = [today, 'Sweet spot 2×20', 'Openers 30 min'];
	const roads = ['Valley loop', 'Lake round'];

	const doors: {
		id: string;
		label: string;
		where: string;
		who: Who | null;
		what: What | null;
		pick?: string;
		inChannel: boolean;
		sessionRuns: boolean;
	}[] = [
		{
			id: 'nowbar',
			label: 'NowBar · Ride',
			where: 'In a voice channel, a session running',
			who: null,
			what: null,
			inChannel: true,
			sessionRuns: true,
		},
		{
			id: 'sidebar',
			label: 'Sidebar · session line',
			where: 'The running session under its channel',
			who: 'join',
			what: null,
			inChannel: true,
			sessionRuns: true,
		},
		{
			id: 'today',
			label: "Home · Today's ride",
			where: 'Planned for today (#4615)',
			who: 'alone',
			what: 'mine',
			pick: today,
			inChannel: false,
			sessionRuns: false,
		},
		{
			id: 'today-channel',
			label: "Home · Today's ride, crew riding",
			where: 'Planned for today, and your channel has a session',
			who: null,
			what: 'mine',
			pick: today,
			inChannel: true,
			sessionRuns: true,
		},
		{
			id: 'card',
			label: 'Workouts · a card’s Ride',
			where: 'A shelf workout, no channel',
			who: 'alone',
			what: 'mine',
			pick: 'Sweet spot 2×20',
			inChannel: false,
			sessionRuns: false,
		},
		{
			id: 'channel-empty',
			label: 'NowBar · Ride, nobody riding',
			where: 'In a voice channel, no session',
			who: null,
			what: null,
			inChannel: true,
			sessionRuns: false,
		},
	];

	let doorId = $state('nowbar');
	const door = $derived(doors.find((d) => d.id === doorId) ?? doors[0]);
	let who = $state<Who | null>(null);
	let what = $state<What | null>(null);
	let pick = $state<string | null>(null);

	// A door pre-fills the picker; switching doors starts it again.
	$effect(() => {
		who = door.who;
		what = door.what;
		pick = door.pick ?? null;
	});

	// "The session's workout" is only an answer when joining one.
	const whats = $derived(
		(who === 'join'
			? (['session', 'mine', 'free'] as What[])
			: (['mine', 'free'] as What[])
		).map((id) => ({
			id,
			label:
				id === 'session'
					? `Ride ${running.workout} with them`
					: id === 'mine'
						? 'My own workout, in ERG'
						: 'Free ride on a road',
			hint:
				id === 'session'
					? `One timeline, ${running.coach} coaches`
					: id === 'mine'
						? 'From your shelf, today’s plan first'
						: 'Grade from the road, your gears',
			icon: id === 'session' ? Radio : id === 'mine' ? CalendarCheck : Mountain,
		})),
	);
	$effect(() => {
		if (what === 'session' && who !== 'join') what = null;
	});

	// One press when the door already answered both questions.
	const ready = $derived(
		who !== null && what !== null && (what === 'session' || pick !== null),
	);
	const startLabel = $derived(
		who === 'join'
			? 'Join the session'
			: who === 'start'
				? 'Start the session'
				: 'Start riding',
	);
	const trade = $derived(who === 'join' && what !== 'session');

	const choice = (on: boolean) =>
		`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left min-h-14 ${
			on
				? 'border-neon bg-surface-raised ring-neon/50 ring-2'
				: 'border-frame hover:bg-surface-raised'
		}`;
</script>

<svelte:head><title>Ride picker mock · WattRoom</title></svelte:head>

<main class="mx-auto flex max-w-6xl flex-col gap-6 p-6 lg:flex-row">
	<!-- The doors: where a rider pressed, which pre-fills the picker. -->
	<nav class="flex shrink-0 flex-col gap-1 lg:w-64" aria-label="doors">
		<p class="eyebrow">#4616 · pressed from</p>
		{#each doors as d (d.id)}
			<button
				onclick={() => (doorId = d.id)}
				class="rounded-md px-3 py-2 text-left text-sm {doorId === d.id
					? 'bg-surface-raised font-semibold'
					: 'hover:bg-surface-raised'}"
			>
				{d.label}
				<span class="text-muted block text-[11px] font-normal">{d.where}</span>
			</button>
		{/each}
		<p class="text-muted mt-4 text-[11px] leading-relaxed">
			Every door opens this one picker. A door that already answers both
			questions (a card's Ride, alone) still starts in one press: the picker
			shows its answers and the Start button is lit.
		</p>
	</nav>

	<!-- The picker, as the sheet it would be. -->
	<section class="panel-lg min-w-0 flex-1" aria-label="ride picker">
		<p class="eyebrow">ride</p>
		{#if door.inChannel && door.sessionRuns}
			<p class="text-muted mt-1 text-xs">
				<Bike size={12} class="inline" />
				{running.riders} riding {running.workout} in Dienstag · minute {running.minute}
			</p>
		{/if}

		<div class="mt-5 grid gap-6 md:grid-cols-2">
			<div>
				<h2 class="text-sm font-semibold">1 · With whom</h2>
				<div class="mt-2 flex flex-col gap-2">
					<button
						class={choice(who === 'alone')}
						onclick={() => (who = 'alone')}
					>
						<User size={20} />
						<span>
							<span class="block font-semibold">Alone</span>
							<span class="text-muted text-xs">Nobody sees your numbers</span>
						</span>
					</button>
					{#if door.inChannel && door.sessionRuns}
						<button
							class={choice(who === 'join')}
							onclick={() => (who = 'join')}
						>
							<Users size={20} />
							<span>
								<span class="block font-semibold">Join Dienstag’s session</span>
								<span class="text-muted text-xs"
									>{running.riders} riding · {running.coach} coaches</span
								>
							</span>
						</button>
					{:else if door.inChannel}
						<button
							class={choice(who === 'start')}
							onclick={() => (who = 'start')}
						>
							<Radio size={20} />
							<span>
								<span class="block font-semibold"
									>Start a session in Dienstag</span
								>
								<span class="text-muted text-xs"
									>The channel rides with you, you coach</span
								>
							</span>
						</button>
					{/if}
				</div>
			</div>

			<div class={who === null ? 'opacity-40' : ''}>
				<h2 class="text-sm font-semibold">2 · What</h2>
				<div class="mt-2 flex flex-col gap-2">
					{#each whats as w (w.id)}
						<button
							class={choice(what === w.id)}
							disabled={who === null}
							onclick={() => (what = w.id)}
						>
							<w.icon size={20} />
							<span>
								<span class="block font-semibold">{w.label}</span>
								<span class="text-muted text-xs">{w.hint}</span>
							</span>
						</button>
					{/each}
				</div>

				{#if what === 'mine' || what === 'free'}
					<!-- The list the answer opens: big rows, no typing. -->
					<div class="mt-3 flex flex-wrap gap-2">
						{#each what === 'mine' ? shelf : roads as name (name)}
							<button
								onclick={() => (pick = name)}
								class="btn {pick === name ? 'btn-primary' : 'btn-secondary'}"
							>
								{#if name === today && what === 'mine'}<CalendarCheck
										size={14}
									/>{/if}
								{name}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		{#if trade}
			<!-- The trade, said once and plainly (#4616). -->
			<div
				class="border-frame mt-5 flex gap-2 rounded-lg border px-4 py-3 text-sm"
			>
				<Info size={16} class="mt-0.5 shrink-0" />
				<p>
					You stay in the session: its voice, its board, your numbers beside
					theirs. Your {what === 'mine'
						? 'trainer follows your workout'
						: 'road is your own'}, so your distance is not theirs and you are
					not in the bunch.
				</p>
			</div>
		{/if}

		<div class="mt-6 flex items-center justify-end gap-3">
			<button class="btn btn-ghost btn-lg">Cancel</button>
			<button class="btn btn-primary btn-lg" disabled={!ready}
				><Play size={16} /> {startLabel}</button
			>
		</div>
	</section>
</main>
