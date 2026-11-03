<script lang="ts">
	/**
	 * A page's sections as a row of links atop its content: one address each,
	 * the current one lit. The sidebar gains no sub-rows; a place with
	 * sections draws them here (Settings, Workouts · Routes). Wraps on a
	 * phone; never scrolls sideways.
	 */
	let {
		tabs,
		current,
		label,
	}: {
		tabs: { href: string; label: string }[];
		/** The href of the section you are on. */
		current: string | undefined;
		/** What the row is, for a screen reader: "settings sections". */
		label: string;
	} = $props();
</script>

<nav class="flex flex-wrap gap-1" aria-label={label}>
	{#each tabs as s (s.href)}
		<a
			href={s.href}
			aria-current={current === s.href ? 'page' : undefined}
			class="rounded px-3 py-1.5 text-sm {current === s.href
				? 'bg-ink/10 text-ink font-medium'
				: 'text-muted hover:bg-ink/5 hover:text-ink'}">{s.label}</a
		>
	{/each}
</nav>
