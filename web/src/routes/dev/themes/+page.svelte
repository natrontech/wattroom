<!--
	The theme gallery (#399). Three of the four identities were derived to
	clear a contrast gate and nobody has ever looked at them: the gate says
	legible, only a person can say "yes, that is Tron Ice". This page is where
	that person looks.

	One mock room drives every panel, so the eight themes are always showing
	the same watts at the same second — a difference between two panels is a
	difference between two palettes and nothing else.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { createRoom, medals, rooms } from '../room/mockRoom.svelte';
	import { GALLERY_ROWS } from './gallery';
	import ThemePanel from './ThemePanel.svelte';

	const room = createRoom();
	onMount(() => {
		void room.start();
		room.setPhase('live');
		return room.stop;
	});

	/**
	 * The room is more often on a laptop at arm's length than on a desk
	 * monitor, and a palette that only survives at 1600 px has not survived.
	 * A width, not a media query: the judging pass has to be able to flip
	 * between the two without resizing the window it is taking notes in.
	 */
	let narrow = $state(false);
	const widths = [
		{ narrow: false, label: 'Wide', hint: 'both families side by side' },
		{
			narrow: true,
			label: 'Laptop',
			hint: 'one panel at 520 px — the room with a people column beside it',
		},
	];

	// One medal for every panel: the comparison is between palettes, and four
	// different medals would put four different colours in the way of it.
	const medal = medals[0];
</script>

<main class="px-6 py-10">
	<header class="max-w-3xl">
		<h1 class="font-display text-3xl font-bold tracking-tight">Themes</h1>
		<p class="text-muted mt-2 text-sm leading-relaxed">
			Every theme the catalogue defines, painted with its own tokens against the
			surfaces that carry colour — the rail around a live tile, the whole ramp
			at once, TV numerals at size, and the medal that leaves the app. Same
			surfaces, same order, same ride, in every panel.
		</p>
		<p class="text-muted mt-2 text-sm leading-relaxed">
			Left column is the <strong class="text-ink">cave</strong>: the dark half
			of an identity, which is what a ride renders whatever the scheme says.
			Right is the <strong class="text-ink">desk</strong> — the white half, for the
			rooms list, the editor and the history under a light scheme. The numbers at
			the foot of each panel are the build contract's, so the page says both "legible"
			and "any good".
		</p>
	</header>

	<div class="mt-6 flex flex-wrap items-center gap-4">
		<div class="border-muted/25 inline-flex rounded border p-0.5">
			{#each widths as width (width.label)}
				<button
					type="button"
					onclick={() => (narrow = width.narrow)}
					aria-pressed={narrow === width.narrow}
					class="rounded px-3 py-1.5 text-sm {narrow === width.narrow
						? 'bg-surface-raised text-ink'
						: 'text-muted hover:text-ink'}"
					title={width.hint}>{width.label}</button
				>
			{/each}
		</div>
		<nav class="text-muted flex flex-wrap items-center gap-x-3 text-xs">
			{#each GALLERY_ROWS as row (row.identity)}
				<a href="#{row.identity}" class="hover:text-ink">{row.identity}</a>
			{/each}
		</nav>
	</div>

	<div class="mt-8 space-y-12 {narrow ? 'max-w-[520px]' : ''}">
		{#each GALLERY_ROWS as row (row.identity)}
			<section id={row.identity} class="scroll-mt-16">
				<h2 class="eyebrow">{row.identity}</h2>
				<div
					class="mt-3 grid items-start gap-6 {narrow ? '' : 'xl:grid-cols-2'}"
				>
					{#each row.panels as panel (panel.theme.id)}
						<ThemePanel
							theme={panel.theme}
							surface={panel.surface}
							riders={room.riders}
							segments={room.segments}
							total={room.total}
							elapsed={room.elapsed}
							{rooms}
							{medal}
							{narrow}
						/>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</main>
