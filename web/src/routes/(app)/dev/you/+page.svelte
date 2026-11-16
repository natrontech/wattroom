<script lang="ts">
	/**
	 * #4617's mock: where a rider's own things live. Three sidebars side by
	 * side, today's first, each with the path to six things riders asked
	 * after (profile, crews, medals, garage, routes, plan). Pick a thing and
	 * every column lights the rows on its way there, with the number of
	 * presses. Nothing here navigates.
	 */
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import History from '@lucide/svelte/icons/history';
	import House from '@lucide/svelte/icons/house';
	import Medal from '@lucide/svelte/icons/medal';
	import Music from '@lucide/svelte/icons/music';
	import Route from '@lucide/svelte/icons/route';
	import Settings from '@lucide/svelte/icons/settings';
	import Shirt from '@lucide/svelte/icons/shirt';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';
	import Shield from '@lucide/svelte/icons/shield';
	import type { Component } from 'svelte';

	type Thing = 'profile' | 'crews' | 'medals' | 'garage' | 'routes' | 'plan';
	const things: { id: Thing; label: string }[] = [
		{ id: 'profile', label: 'My rider page' },
		{ id: 'crews', label: 'My crews' },
		{ id: 'medals', label: 'Medals & trophies' },
		{ id: 'garage', label: 'Garage (kit)' },
		{ id: 'routes', label: 'Routes' },
		{ id: 'plan', label: 'My plan' },
	];

	type Row = {
		label: string;
		icon: Component<{ size?: number }>;
		/** The things this row leads to, and how many presses from the sidebar. */
		to?: Partial<Record<Thing, number>>;
		indent?: boolean;
		note?: string;
	};
	type Group = { title?: string; rows: Row[] };
	type Variant = {
		id: string;
		name: string;
		pitch: string;
		groups: Group[];
		/** Things this layout leaves out of the sidebar, and where they are. */
		hidden?: Partial<Record<Thing, string>>;
	};

	const variants: Variant[] = [
		{
			id: 'today',
			name: 'A · Today',
			pitch:
				'Rows are activities. You, your medals and settings sit behind the avatar; the garage only opens mid-ride.',
			groups: [
				{
					rows: [
						{ label: 'Home', icon: House, to: { crews: 2 } },
						{
							label: 'Workouts',
							icon: ChartColumn,
							to: { routes: 2, plan: 1 },
						},
						{ label: 'Rides', icon: History },
						{ label: 'Music', icon: Music },
						{ label: 'Friends', icon: Users },
					],
				},
				{
					title: 'crew switcher',
					rows: [{ label: 'Dienstag', icon: Shield, to: { crews: 1 } }],
				},
				{
					title: 'avatar menu',
					rows: [
						{
							label: 'Your rider page',
							icon: User,
							to: { profile: 2, medals: 2 },
						},
						{ label: 'Settings', icon: Settings },
					],
				},
			],
			hidden: { garage: 'Only inside a ride or the lounge' },
		},
		{
			id: 'you-group',
			name: 'B · A “You” group',
			pitch:
				'Keep the activity rows; add a You group above them holding everything that is yours.',
			groups: [
				{
					title: 'you',
					rows: [
						{ label: 'Rider page', icon: User, to: { profile: 1 } },
						{ label: 'Plan', icon: CalendarCheck, to: { plan: 1 } },
						{ label: 'Medals', icon: Medal, to: { medals: 1 } },
						{ label: 'Garage', icon: Shirt, to: { garage: 1 } },
						{ label: 'Crews', icon: Shield, to: { crews: 1 } },
					],
				},
				{
					title: 'ride',
					rows: [
						{ label: 'Home', icon: House },
						{ label: 'Workouts', icon: ChartColumn },
						{ label: 'Routes', icon: Route, to: { routes: 1 } },
						{ label: 'Rides', icon: History },
						{ label: 'Music', icon: Music },
						{ label: 'Friends', icon: Users },
					],
				},
			],
		},
		{
			id: 'three',
			name: 'C · Mine / Ride / Together',
			pitch:
				'Three groups by the question a rider has: what is mine, what do I ride, who do I ride with.',
			groups: [
				{ rows: [{ label: 'Home', icon: House }] },
				{
					title: 'mine',
					rows: [
						{
							label: 'Me',
							icon: User,
							to: { profile: 1, medals: 2 },
							note: 'page, medals, rides',
						},
						{ label: 'Garage', icon: Shirt, to: { garage: 1 } },
					],
				},
				{
					title: 'ride',
					rows: [
						{ label: 'Plan', icon: CalendarCheck, to: { plan: 1 } },
						{ label: 'Workouts', icon: ChartColumn },
						{ label: 'Routes', icon: Route, to: { routes: 1 } },
						{ label: 'Music', icon: Music },
					],
				},
				{
					title: 'together',
					rows: [
						{ label: 'Crews', icon: Shield, to: { crews: 1 } },
						{ label: 'Friends', icon: Users },
					],
				},
			],
		},
	];

	let thing = $state<Thing>('garage');
	const presses = (v: Variant) => {
		const counts = v.groups
			.flatMap((g) => g.rows)
			.map((r) => r.to?.[thing])
			.filter((n): n is number => n !== undefined);
		return counts.length ? Math.min(...counts) : null;
	};
</script>

<svelte:head><title>You mock · WattRoom</title></svelte:head>

<main class="mx-auto max-w-6xl p-6">
	<p class="eyebrow">#4617 · where your things live</p>
	<div class="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="find">
		{#each things as t (t.id)}
			<button
				role="radio"
				aria-checked={thing === t.id}
				onclick={() => (thing = t.id)}
				class="btn {thing === t.id ? 'btn-primary' : 'btn-secondary'}"
				>{t.label}</button
			>
		{/each}
	</div>

	<div class="mt-6 grid gap-6 md:grid-cols-3">
		{#each variants as v (v.id)}
			{@const n = presses(v)}
			<section class="panel flex flex-col gap-3" aria-label={v.name}>
				<div class="flex items-baseline justify-between gap-2">
					<h2 class="font-semibold">{v.name}</h2>
					<span class="text-muted text-xs">
						{#if n !== null}
							<span class="font-display text-ink text-lg">{n}</span>
							{n === 1 ? 'press' : 'presses'}
						{:else}
							not in the sidebar
						{/if}
					</span>
				</div>
				<p class="text-muted text-xs">{v.pitch}</p>
				<nav class="bg-surface border-frame rounded-lg border p-2">
					{#each v.groups as g, gi (gi)}
						{#if g.title}
							<p class="eyebrow mt-2 px-2 text-[10px]">{g.title}</p>
						{/if}
						<ul>
							{#each g.rows as r (r.label)}
								{@const lit = r.to?.[thing] !== undefined}
								<li
									class="flex items-center gap-2 rounded px-2 py-1.5 text-sm {lit
										? 'bg-surface-raised ring-neon/60 font-semibold ring-1'
										: ''}"
								>
									<r.icon size={14} />
									{r.label}
									{#if r.note}<span class="text-muted ml-auto text-[10px]"
											>{r.note}</span
										>{/if}
								</li>
							{/each}
						</ul>
					{/each}
				</nav>
				{#if v.hidden?.[thing]}
					<p class="text-muted text-xs">{v.hidden[thing]}</p>
				{/if}
			</section>
		{/each}
	</div>

	<p class="text-muted mt-6 max-w-2xl text-xs leading-relaxed">
		Rows only; icons and words are placeholders for the argument. B keeps every
		row a rider already knows and adds one group; C reorders the whole column by
		question. Either way the avatar menu shrinks to status, sign out and
		devices. Routes leave Workouts' tabs to become a row, and the garage gets a
		page between rides.
	</p>
</main>
