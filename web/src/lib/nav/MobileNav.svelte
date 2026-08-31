<script lang="ts">
	// Below md the rail is hidden, and without this bar a phone has no way to
	// navigate at all. Five primary tabs, thumb-sized (ux.md); Ramp test and
	// Sensors stay reachable in context (home, ride, profile).
	import { page } from '$app/state';
	import { railPresence } from '$lib/nav/presence.svelte';
	import { leaveRoom, roomConnection } from '$lib/room/connection.svelte';
	import {
		ChartColumn,
		History,
		House,
		LogOut,
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
	{#if roomConnection.current}
		{@const slug = roomConnection.current.slug}
		{@const room = railPresence.rooms.find((r) => r.slug === slug)}
		<!-- The phone's answer to "am I in a room?" (#251) — the rail's
		     connection strip, thumb-sized. Tap the name to return, one
		     button to leave. -->
		<div class="border-ink/10 flex items-center gap-2 border-b px-4 py-2">
			<span class="bg-z4 h-2 w-2 shrink-0 animate-pulse rounded-full"></span>
			<a href={`/r/${slug}`} class="min-w-0 flex-1 truncate text-xs font-medium"
				>{room?.icon ? `${room.icon} ` : ''}{room?.name ?? slug}</a
			>
			<button
				onclick={leaveRoom}
				class="text-muted hover:text-ink shrink-0 rounded p-2"
				title="leave the room"
				aria-label="leave the room"><LogOut size={16} /></button
			>
		</div>
	{/if}
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
