<script lang="ts">
	/**
	 * Which colours the ride card or poster goes out in (#4098). It opens on
	 * the rider's own appearance; a swatch redraws the preview, and the pick
	 * is this download's only — Settings → Appearance stays as it is.
	 *
	 * The preview is the file: Download saves the picture already drawn, so a
	 * phone's share sheet gets the fresh tap it needs (share.ts).
	 */
	import { ImageDown } from '@lucide/svelte';
	import Banner from '#lib/components/Banner.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import { tokenDeclarations, type ThemeFamily } from '#lib/palette.ts';
	import { palette } from '#lib/palette.svelte.ts';
	import { fetchRideCard } from '#lib/ride/card.ts';
	import { shareFile } from '#lib/share.ts';
	import { THEMES, themeFor } from '#lib/themes.ts';

	let {
		rideId,
		label,
		onclose,
	}: { rideId: string; label: string; onclose: () => void } = $props();

	const identities = [...new Set(THEMES.map((t) => t.identity))];
	const families: [ThemeFamily, string][] = [
		['dark', 'Dark'],
		['light', 'Day'],
	];

	let identity = $state(palette.choice.identity);
	let family = $state<ThemeFamily>(palette.family);
	const theme = $derived(themeFor(identity, family));

	let card = $state<{ url: string; blob: Blob; filename?: string } | null>(
		null,
	);
	let error = $state<string | null>(null);
	let attempt = $state(0);

	$effect(() => {
		const pick = { identity: theme.identity, family: theme.family };
		void attempt;
		let live = true;
		let url: string | undefined;
		card = null;
		error = null;
		void fetchRideCard(rideId, pick).then((res) => {
			if (!live) return;
			if (!res.ok) {
				error = res.error.message;
				return;
			}
			url = URL.createObjectURL(res.data.blob);
			card = { url, ...res.data };
		});
		return () => {
			live = false;
			if (url) URL.revokeObjectURL(url);
		};
	});

	async function download() {
		if (!card) return;
		await shareFile(card.blob, card.filename ?? `wattroom-ride-${rideId}.png`);
		onclose();
	}
</script>

<Modal {label} {onclose}>
	<h2 class="font-display text-lg leading-tight font-bold">{label}</h2>

	<div
		class="bg-surface-raised mt-4 aspect-square w-full overflow-hidden rounded-lg"
		aria-busy={!card && !error}
	>
		{#if card}
			<img
				src={card.url}
				alt="Your ride, drawn in {theme.name}"
				class="size-full"
			/>
		{:else if error}
			<div class="flex size-full items-center p-4">
				<Banner>
					{error}
					{#snippet action()}
						<button onclick={() => attempt++} class="btn btn-secondary"
							>Try again</button
						>
					{/snippet}
				</Banner>
			</div>
		{:else}
			<Skeleton class="size-full" />
		{/if}
	</div>

	<div
		class="mt-4 grid items-center gap-2"
		style:grid-template-columns="auto repeat({identities.length}, minmax(0,
		1fr))"
		role="group"
		aria-label="Colours for this download"
	>
		{#each families as [f, name] (f)}
			<span class="eyebrow pr-1">{name}</span>
			{#each identities as id (id)}
				{@const swatch = themeFor(id, f)}
				{@const picked = swatch.id === theme.id}
				<button
					type="button"
					title={swatch.name}
					aria-label={swatch.name}
					aria-pressed={picked}
					style={tokenDeclarations(swatch)}
					onclick={() => {
						identity = id;
						family = f;
					}}
					class="bg-surface relative h-11 overflow-hidden rounded {picked
						? 'border-ink border-2'
						: 'border-ink/10 hover:border-ink/40 border'}"
				>
					<span class="bg-surface-raised absolute inset-x-1 top-1 h-4 rounded"
					></span>
					<span
						class="bg-neon absolute inset-x-2 top-2 h-1 rounded-full opacity-80"
					></span>
					<span class="bg-watt absolute inset-x-2 bottom-2 h-1.5 rounded-full"
					></span>
				</button>
			{/each}
		{/each}
	</div>
	<p class="text-muted mt-2 text-xs">
		{theme.name}, for this download only. Your app keeps its own colours.
	</p>

	<div class="mt-4 flex justify-end gap-2">
		<button onclick={onclose} class="btn btn-ghost">Cancel</button>
		<button
			onclick={() => void download()}
			disabled={!card}
			data-testid="download-card-file"
			class="btn btn-primary"
		>
			<ImageDown size={14} /> Download
		</button>
	</div>
</Modal>
