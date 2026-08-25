<script lang="ts">
	import '@fontsource-variable/space-grotesk';
	import '@fontsource/barlow/400.css';
	import '@fontsource/barlow/600.css';
	import '@fontsource/barlow-condensed/600.css';
	import '@fontsource/barlow-condensed/700.css';
	import '@fontsource/chakra-petch/500.css';
	import '@fontsource/chakra-petch/700.css';
	import '@fontsource/orbitron/500.css';
	import '@fontsource/orbitron/700.css';
	import { page } from '$app/state';
	import { palettes, active } from './palettes.svelte';

	let { children } = $props();

	const screens = [
		{ href: '/dev/brand', label: 'Brand' },
		{ href: '/dev/styleguide', label: 'Styleguide' },
	];

	const styleVars = $derived(
		Object.entries(active.palette.vars)
			.map(([key, value]) => `${key}: ${value}`)
			.join('; '),
	);
</script>

<div class="bg-surface min-h-screen text-white" style={styleVars}>
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

		<span class="border-muted/20 mx-3 h-5 border-l"></span>
		<span class="text-muted mr-1 text-xs tracking-[0.2em] uppercase"
			>palette</span
		>
		{#each palettes as option (option.name)}
			<button
				type="button"
				onclick={() => (active.palette = option)}
				title={option.note}
				class="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm {option.name ===
				active.palette.name
					? 'bg-surface-raised text-white'
					: 'text-muted hover:text-white'}"
			>
				<span
					class="h-3 w-3 rounded-full"
					style="background: {option.vars[
						'--color-watt'
					]}; box-shadow: 0 0 6px {option.vars['--color-watt']}"
				></span>
				{option.name}
			</button>
		{/each}
	</nav>
	{@render children()}
</div>
