<script lang="ts">
	// MOCK (#449): a rider's page — what a profile shows, to whom. Static data,
	// judged by looking (ADR-0020's method) before an ADR fixes the rules.
	import Avatar from '$lib/components/Avatar.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import {
		Award,
		Bike,
		CalendarClock,
		Eye,
		Flame,
		Lock,
		MessageSquare,
		Radio,
		Trophy,
		UserPlus,
		Users,
	} from '@lucide/svelte';

	const rider = {
		name: 'David Kneubühler',
		level: 14,
		xp: 32_410,
		toNext: 2_190,
		pct: 78,
		since: 'March 2026',
		room: 'Schwitzchaste',
		riding: true,
		friend: false,
	};
	const stats = [
		{ label: 'rides', value: '212', hint: 'since March' },
		{ label: 'this month', value: '14', hint: '9 h 40 · 6 810 kJ' },
		{ label: 'streak', value: '11', unit: 'wks', hint: 'a session every week' },
		{ label: 'medals', value: '23', hint: '7 gold' },
	];
	const shelf = [
		{ icon: Trophy, label: 'Sufferfest Survivor', when: 'Thu' },
		{ icon: Flame, label: 'Hot End', when: 'Aug 28' },
		{ icon: Award, label: 'Gold · Thursday Sufferfest', when: 'Aug 21' },
		{ icon: Bike, label: '200 rides', when: 'Aug 12' },
	];
	const feed = [
		{
			title: 'Sweet Spot 3×12',
			room: 'Schwitzchaste',
			when: '2 days ago',
			line: '48 min · 612 kJ · 96% on target',
			medal: 'silver',
			zones: [0, 6, 14, 20, 8, 0, 0],
		},
		{
			title: 'Ramp test',
			room: 'solo',
			when: '6 days ago',
			line: '21 min · new FTP',
			zones: [4, 4, 4, 4, 3, 2, 1],
		},
		{
			title: 'VO₂ 5×3',
			room: 'Thursday Sufferfest',
			when: 'Aug 28',
			line: '49 min · 588 kJ · gold',
			medal: 'gold',
			zones: [2, 8, 12, 6, 15, 6, 0],
		},
	];
	const shared = ['Schwitzchaste', 'Thursday Sufferfest'];
</script>

<main class="page">
	<p class="eyebrow">mock · social profiles (#449)</p>

	<header class="panel mt-2 flex flex-wrap items-center gap-5 p-6">
		<Avatar name={rider.name} xp={rider.xp} size={72} />
		<div class="min-w-0 flex-1">
			<h1 class="font-display text-2xl font-bold">{rider.name}</h1>
			<p class="text-muted mt-0.5 flex items-center gap-2 text-sm">
				{#if rider.riding}
					<RidingBars size={11} /> riding in {rider.room}
				{:else}
					in {rider.room}
				{/if}
				<span class="text-muted/50">·</span> riding here since {rider.since}
			</p>
			<div class="mt-3 flex items-center gap-3">
				<span class="font-display text-lg font-bold tabular-nums"
					>level {rider.level}</span
				>
				<div class="w-40"><ProgressBar pct={rider.pct} /></div>
				<span class="text-muted text-[11px] tabular-nums"
					>{rider.toNext.toLocaleString()} XP to {rider.level + 1}</span
				>
			</div>
		</div>
		<div class="flex shrink-0 flex-col gap-2">
			{#if rider.friend}
				<a href="/messages/dm/x" class="btn btn-secondary"
					><MessageSquare size={15} /> Message</a
				>
			{:else}
				<button class="btn btn-primary"
					><UserPlus size={15} /> Add friend</button
				>
			{/if}
			{#if rider.riding}
				<a href="/r/x" class="btn btn-accent"><Radio size={15} /> Join them</a>
			{/if}
		</div>
	</header>

	<div class="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
		<div class="min-w-0 space-y-8">
			<section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{#each stats as s (s.label)}
					<div class="panel px-4 py-3">
						<p class="eyebrow">{s.label}</p>
						<p class="font-display text-2xl font-bold tabular-nums">
							{s.value}{#if s.unit}<span class="text-muted ml-1 text-sm"
									>{s.unit}</span
								>{/if}
						</p>
						<p class="text-muted text-[11px]">{s.hint}</p>
					</div>
				{/each}
			</section>

			<section>
				<div class="flex items-baseline gap-3">
					<h2
						class="text-muted text-xs font-semibold tracking-widest uppercase"
					>
						Activity
					</h2>
					<span class="text-muted/70 flex items-center gap-1 text-[11px]"
						><Eye size={11} /> rides David chose to share</span
					>
				</div>
				<ul class="mt-3 space-y-2">
					{#each feed as ride (ride.title + ride.when)}
						<li class="panel px-5 py-4">
							<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
								<span class="font-display font-bold">{ride.title}</span>
								<span class="text-muted text-xs">{ride.room} · {ride.when}</span
								>
								{#if ride.medal}
									<span
										class="ml-auto flex items-center gap-1 text-[11px] {ride.medal ===
										'gold'
											? 'text-z5'
											: 'text-muted'}"><Award size={12} /> {ride.medal}</span
									>
								{/if}
							</div>
							<p class="text-muted mt-1 text-xs">{ride.line}</p>
							<div class="mt-2">
								<ZoneBar seconds={ride.zones.map((m) => m * 60)} />
							</div>
						</li>
					{/each}
				</ul>
			</section>
		</div>

		<aside class="min-w-0 space-y-8">
			<section>
				<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
					Trophy shelf
				</h2>
				<ul class="mt-3 grid grid-cols-2 gap-2">
					{#each shelf as item (item.label)}
						<li class="panel flex items-center gap-2.5 px-3 py-2.5">
							<item.icon size={18} class="text-neon shrink-0" />
							<span class="min-w-0">
								<span class="block truncate text-xs font-medium"
									>{item.label}</span
								>
								<span class="text-muted block text-[10px]">{item.when}</span>
							</span>
						</li>
					{/each}
				</ul>
				<a
					href="/dev/trophies"
					class="text-muted hover:text-ink mt-2 inline-block text-xs underline"
					>All 23 medals and 9 achievements →</a
				>
			</section>

			<section>
				<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
					Rooms in common
				</h2>
				<ul class="mt-3 space-y-1.5">
					{#each shared as room (room)}
						<li class="panel flex items-center gap-2 px-3 py-2 text-sm">
							<Users size={14} class="text-muted" />
							{room}
						</li>
					{/each}
				</ul>
			</section>

			<section class="border-muted/15 rounded-lg border p-4">
				<h2 class="flex items-center gap-1.5 text-xs font-semibold">
					<Lock size={12} /> What a profile shows
				</h2>
				<ul class="text-muted mt-2 space-y-1 text-[11px] leading-relaxed">
					<li>
						<strong class="text-ink">Everyone:</strong> name, level, medals from rooms
						you share, which room they are in.
					</li>
					<li>
						<strong class="text-ink">Friends:</strong> the rides they chose to share,
						the monthly totals.
					</li>
					<li>
						<strong class="text-ink">Never:</strong> live watts, heart rate, weight,
						FTP — room-scoped, as today.
					</li>
				</ul>
				<p class="text-muted/70 mt-2 flex items-center gap-1 text-[10px]">
					<CalendarClock size={10} /> A proposal for the ADR, not a rule yet.
				</p>
			</section>
		</aside>
	</div>
</main>
