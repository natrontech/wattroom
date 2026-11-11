<script lang="ts">
	// Your look in the lounge (look.ts): parts and colours, with yourself
	// on the sofa as you change them. Saved, it reaches every voice channel
	// you stand in on the next tick.
	import Modal from '#lib/components/Modal.svelte';
	import Banner from '#lib/components/Banner.svelte';
	import Dices from '@lucide/svelte/icons/dices';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { account } from '#lib/account.svelte.ts';
	import { palette } from '#lib/palette.svelte.ts';
	import { toasts } from '#lib/toast.svelte.ts';
	import {
		HAIRS,
		LOUNGE,
		SKINS,
		applyLoungeTheme,
	} from '#lib/lounge/palette.ts';
	import {
		BADGES,
		BEARDS,
		CLOTHES,
		GLASSES,
		HAIR_NAMES,
		PETS,
		TOPS,
		encodeLook,
		lookOf,
		seededLook,
		shuffledLook,
		type Look,
		type Part,
	} from '#lib/lounge/look.ts';
	import { dress } from '#lib/lounge/figures.ts';
	import { drawFigure } from '#lib/lounge/draw-people.ts';

	let { onclose }: { onclose: () => void } = $props();

	const id = $derived(account.me?.id ?? '');
	let look = $state<Look>(lookOf(account.me?.id ?? '', account.me?.loungeLook));
	let saving = $state(false);
	let error = $state('');

	const HAIR_COLOUR_NAMES = [
		'Dark brown',
		'Black',
		'Blond',
		'Red',
		'Brown',
		'Grey',
		'White',
		'Pink',
		'Violet',
		'Blue',
		'Green',
	];
	const figure = $derived(
		dress({ id, name: '', loungeLook: encodeLook(look) }),
	);

	/** The preview: you on a stretch of sofa, six times the room's size. */
	const W = 36;
	const H = 40;
	// An attachment re-runs when what it reads changes: each pick redraws.
	function preview(canvas: HTMLCanvasElement) {
		applyLoungeTheme(palette.active);
		const g = canvas.getContext('2d')!;
		g.clearRect(0, 0, W, H);
		g.fillStyle = LOUNGE.wall;
		g.fillRect(0, 0, W, H);
		g.fillStyle = LOUNGE.sofa;
		g.fillRect(2, 18, W - 4, 12);
		g.fillStyle = LOUNGE.sofaLight;
		g.fillRect(2, 28, W - 4, 2);
		g.fillStyle = LOUNGE.floor;
		g.fillRect(0, 34, W, H - 34);
		drawFigure(g, figure, W / 2, 28);
	}

	const set = (part: Part, n: number) => (look = { ...look, [part]: n });

	async function save() {
		saving = true;
		error = '';
		const failed = await account.setLoungeLook(encodeLook(look));
		saving = false;
		if (failed) {
			error = failed.message;
			return;
		}
		toasts.push('Your new look is on in the lounge.');
		onclose();
	}
</script>

{#snippet swatches(
	part: Part,
	colours: readonly { name: string; hex: string }[],
	none?: string,
)}
	<div class="flex flex-wrap gap-1.5">
		{#if none}
			<button
				type="button"
				onclick={() => set(part, 0)}
				aria-pressed={look[part] === 0}
				class="btn btn-xs {look[part] === 0 ? 'btn-primary' : 'btn-secondary'}"
				>{none}</button
			>
		{/if}
		{#each colours as c, i (c.name)}
			{@const n = none ? i + 1 : i}
			<button
				type="button"
				onclick={() => set(part, n)}
				aria-pressed={look[part] === n}
				aria-label={c.name}
				title={c.name}
				class="size-8 rounded-full border-2 {look[part] === n
					? 'border-ink'
					: 'border-muted/30'}"
				style:background={c.hex}
			></button>
		{/each}
	</div>
{/snippet}

{#snippet choices(part: Part, names: readonly string[])}
	<div class="flex flex-wrap gap-1.5">
		{#each names as name, n (name)}
			<button
				type="button"
				onclick={() => set(part, n)}
				aria-pressed={look[part] === n}
				class="btn btn-xs {look[part] === n ? 'btn-primary' : 'btn-secondary'}"
				>{name}</button
			>
		{/each}
	</div>
{/snippet}

<Modal label="Your look in the lounge" {onclose} class="max-w-3xl">
	<h2 class="font-display text-lg font-bold">Your look in the lounge</h2>
	<p class="text-muted mt-1 text-sm">
		Everyone in your voice channels sees it in the lounge.
	</p>
	<div class="mt-4 flex flex-col gap-6 sm:flex-row">
		<div
			class="flex shrink-0 flex-col items-center gap-3 sm:sticky sm:top-0 sm:self-start"
		>
			<canvas
				{@attach preview}
				width={W}
				height={H}
				aria-label="You on the sofa, as you look now"
				class="border-muted/30 rounded border [image-rendering:pixelated]"
				style:width="{W * 6}px"
				style:height="{H * 6}px"
			></canvas>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={() => (look = shuffledLook())}
					class="btn btn-secondary btn-xs"><Dices size={14} /> Shuffle</button
				>
				<button
					type="button"
					onclick={() => (look = seededLook(id))}
					class="btn btn-ghost btn-xs"
					><RotateCcw size={14} /> Start over</button
				>
			</div>
			{#if error}
				<div class="w-full max-w-56"><Banner tone="error">{error}</Banner></div>
			{/if}
			<div class="flex gap-2">
				<button type="button" onclick={onclose} class="btn btn-ghost"
					>Cancel</button
				>
				<button
					type="button"
					onclick={() => void save()}
					disabled={saving || !id}
					class="btn btn-primary">{saving ? 'Saving…' : 'Save'}</button
				>
			</div>
		</div>
		<div class="grid min-w-0 flex-1 gap-3 text-sm">
			<section>
				<h3 class="eyebrow mb-1.5">Skin</h3>
				{@render swatches(
					'skin',
					SKINS.map((hex, i) => ({
						name: `Skin tone ${i + 1} of ${SKINS.length}`,
						hex,
					})),
				)}
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Hair</h3>
				{@render choices('hair', HAIR_NAMES)}
				<div class="mt-1.5">
					{@render swatches(
						'hairColour',
						HAIRS.map((hex, i) => ({ name: HAIR_COLOUR_NAMES[i], hex })),
					)}
				</div>
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Top</h3>
				<div class="flex flex-wrap items-center gap-1.5">
					{@render choices('top', TOPS)}
					<button
						type="button"
						onclick={() => set('stripes', look.stripes ? 0 : 1)}
						aria-pressed={look.stripes === 1}
						class="btn btn-xs {look.stripes ? 'btn-primary' : 'btn-secondary'}"
						>Stripes</button
					>
				</div>
				<div class="mt-1.5">
					{@render swatches('topColour', CLOTHES, 'Road jersey')}
				</div>
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Trousers</h3>
				{@render swatches('trousers', CLOTHES, 'Plain')}
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Shoes</h3>
				{@render swatches('shoes', CLOTHES, 'Dark')}
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Socks</h3>
				{@render swatches('socks', CLOTHES, 'None')}
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Glasses</h3>
				{@render choices('glasses', GLASSES)}
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Beard</h3>
				{@render choices('beard', BEARDS)}
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Badge</h3>
				{@render choices('badge', BADGES)}
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Pet</h3>
				{@render choices('pet', PETS)}
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Cap</h3>
				{@render swatches('cap', CLOTHES, 'None')}
			</section>
			<section>
				<h3 class="eyebrow mb-1.5">Scarf</h3>
				{@render swatches('scarf', CLOTHES, 'None')}
			</section>
		</div>
	</div>
</Modal>
