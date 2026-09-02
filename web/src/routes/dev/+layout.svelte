<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	const screens = [
		{ href: '/dev/brand', label: 'Brand' },
		{ href: '/dev/styleguide', label: 'Styleguide' },
		{ href: '/dev/components', label: 'Components' },
		{ href: '/dev/account', label: 'Account' },
		{ href: '/dev/rooms', label: 'Rooms' },
		{ href: '/dev/settings', label: 'Settings' },
		{ href: '/dev/pairing', label: 'Pairing' },
		{ href: '/dev/hardware', label: 'Hardware' },
		{ href: '/dev/editor', label: 'Editor' },
		{ href: '/dev/ramp', label: 'Ramp' },
		{ href: '/dev/modes', label: 'Modes' },
		{ href: '/dev/sound', label: 'Sound' },
		{ href: '/dev/room', label: 'Room' },
		{ href: '/dev/panel', label: 'Panel' },
		{ href: '/dev/spectator', label: 'Spectator' },
		{ href: '/dev/summary', label: 'Summary' },
		{ href: '/dev/medal', label: 'Medals' },
	];
</script>

<div class="cave bg-surface text-ink flex h-screen flex-col">
	<nav
		class="border-muted/15 bg-surface/90 z-10 flex shrink-0 flex-wrap items-center gap-1 border-b px-4 py-2 backdrop-blur"
	>
		<a
			href="/dev"
			class="text-muted hover:text-ink mr-3 text-xs tracking-[0.2em] uppercase"
			>dev</a
		>
		{#each screens as screen (screen.href)}
			<a
				href={screen.href}
				class="rounded px-3 py-1.5 text-sm {page.url.pathname === screen.href
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}">{screen.label}</a
			>
		{/each}
	</nav>
	<div class="min-h-0 flex-1 overflow-y-auto">
		{@render children()}
	</div>
</div>
