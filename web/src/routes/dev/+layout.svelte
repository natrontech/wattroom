<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	const screens = [
		{ href: '/dev/brand', label: 'Brand' },
		{ href: '/dev/styleguide', label: 'Styleguide' },
		{ href: '/dev/room', label: 'Room' },
	];
</script>

<div class="bg-surface min-h-screen text-white">
	<nav
		class="border-muted/15 bg-surface/90 sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b px-4 py-2 backdrop-blur"
	>
		<a
			href="/dev"
			class="text-muted mr-3 text-xs tracking-[0.2em] uppercase hover:text-white"
			>dev</a
		>
		{#each screens as screen (screen.href)}
			<a
				href={screen.href}
				class="rounded px-3 py-1.5 text-sm {page.url.pathname === screen.href
					? 'bg-surface-raised text-white'
					: 'text-muted hover:text-white'}">{screen.label}</a
			>
		{/each}
	</nav>
	{@render children()}
</div>
