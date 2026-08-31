<script lang="ts">
	// Below md the rail is hidden, and without this bar a phone has no way to
	// navigate at all. Five primary tabs, thumb-sized (ux.md); Ramp test and
	// Sensors stay reachable in context (home, ride, profile).
	import { page } from '$app/state';
	import {
		ChartColumn,
		History,
		House,
		UserRound,
		Users,
	} from '@lucide/svelte';

	const tabs = [
		{ href: '/home', label: 'Home', icon: House },
		{ href: '/rooms', label: 'Rooms', icon: Users },
		{ href: '/workouts', label: 'Workouts', icon: ChartColumn },
		{ href: '/history', label: 'Rides', icon: History },
		{ href: '/profile', label: 'Profile', icon: UserRound },
	];

	// A room page (/r/…) belongs to the Rooms tab.
	const active = $derived(
		tabs.find((t) =>
			t.href === '/rooms'
				? page.url.pathname.startsWith('/rooms') ||
					page.url.pathname.startsWith('/r/')
				: page.url.pathname.startsWith(t.href),
		)?.href,
	);
</script>

<nav
	class="border-ink/10 bg-surface fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
>
	<div class="grid grid-cols-5">
		{#each tabs as t (t.href)}
			<a
				href={t.href}
				class="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium {active ===
				t.href
					? 'text-neon'
					: 'text-muted'}"
				aria-current={active === t.href ? 'page' : undefined}
			>
				<t.icon size={20} />
				{t.label}
			</a>
		{/each}
	</div>
</nav>
