<script lang="ts">
	// Page links live up here, not in the rail: the rail's height belongs to
	// rooms and the people in them. Phones get MobileNav's tab bar instead.
	import { page } from '$app/state';
	import { activeHref, pages } from './pages';

	const active = $derived(activeHref(page.url.pathname));
</script>

<nav
	class="border-ink/5 bg-surface z-30 hidden shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-2 md:flex"
>
	{#each pages as entry (entry.href)}
		<a
			href={entry.href}
			class="shrink-0 rounded px-3 py-1.5 text-sm whitespace-nowrap {active ===
			entry.href
				? 'bg-surface-raised text-ink'
				: 'text-muted hover:text-ink'}"
			aria-current={active === entry.href ? 'page' : undefined}>{entry.label}</a
		>
	{/each}
</nav>
