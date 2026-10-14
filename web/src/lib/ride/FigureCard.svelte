<script lang="ts">
	// The one ask before a rider's first road (ADR-0073, #3342): build, height
	// and a skin tone, previewed, and as easy to skip as to save. Either answer
	// sets figure_asked_at, so this never returns on any device. The preview is
	// a still figure: it has no motion to hold under reduced motion.
	import { account, type FigureBuild } from '$lib/account.svelte';
	import { MaxFigureHeightCm, MinFigureHeightCm } from '$lib/protocol';
	import { toasts } from '$lib/toast.svelte';
	import {
		BUILDS,
		metres,
		NEUTRAL_BUILD,
		NEUTRAL_HEIGHT_CM,
		NEUTRAL_SKIN_VAR,
		SKIN_VARS,
	} from './figure-choice';

	let { onDone }: { onDone: () => void } = $props();

	let build = $state<FigureBuild>(NEUTRAL_BUILD);
	let heightCm = $state(NEUTRAL_HEIGHT_CM);
	let skin = $state<number | null>(null);
	let busy = $state(false);

	const WIDTH = { slim: 0.82, athletic: 1, strong: 1.22 } as const;
	const w = $derived(WIDTH[build]);
	const scale = $derived(heightCm / MaxFigureHeightCm);
	const tone = $derived(skin === null ? NEUTRAL_SKIN_VAR : SKIN_VARS[skin]);

	async function answer(choice: Parameters<typeof account.setFigure>[0]) {
		busy = true;
		const refusal = await account.setFigure(choice);
		busy = false;
		if (refusal) toasts.push(refusal.message, { tone: 'error' });
		else onDone();
	}
</script>

<section
	class="panel panel-xl mx-auto w-full max-w-xl"
	data-testid="figure-card"
>
	<h2 class="font-display text-lg font-bold">Your rider</h2>
	<p class="text-muted mt-2 text-sm">
		The figure other riders see on the road. Pick a build, height and skin tone,
		or skip and ride the default.
	</p>

	<div class="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-end">
		<svg
			viewBox="0 0 100 220"
			class="h-56 w-28 shrink-0"
			role="img"
			aria-label="Preview, {build}, {metres(heightCm)}"
		>
			<g
				transform="translate(50 220) scale({scale}) translate(-50 -220)"
				data-testid="figure-preview"
			>
				<circle cx="50" cy="24" r="14" fill={tone} />
				<rect
					x={50 - 17 * w}
					y="42"
					width={34 * w}
					height="66"
					rx="12"
					class="fill-neon"
				/>
				<rect
					x={50 - 17 * w - 9}
					y="44"
					width="9"
					height="56"
					rx="4.5"
					fill={tone}
				/>
				<rect
					x={50 + 17 * w}
					y="44"
					width="9"
					height="56"
					rx="4.5"
					fill={tone}
				/>
				<rect
					x={50 - 15 * w}
					y="104"
					width={13 * w}
					height="116"
					rx="6"
					fill={tone}
				/>
				<rect
					x={50 + 2 * w}
					y="104"
					width={13 * w}
					height="116"
					rx="6"
					fill={tone}
				/>
			</g>
		</svg>

		<div class="flex w-full flex-col gap-4">
			<fieldset>
				<legend class="text-muted mb-2 text-xs">Build</legend>
				<div class="grid grid-cols-3 gap-2">
					{#each BUILDS as b (b)}
						<button
							type="button"
							aria-pressed={build === b}
							onclick={() => (build = b)}
							class="btn btn-lg capitalize {build === b
								? 'btn-primary'
								: 'btn-secondary'}">{b}</button
						>
					{/each}
				</div>
			</fieldset>

			<label class="block">
				<span class="text-muted mb-2 flex justify-between text-xs"
					>Height <span class="text-ink">{metres(heightCm)}</span></span
				>
				<input
					type="range"
					min={MinFigureHeightCm}
					max={MaxFigureHeightCm}
					step="1"
					bind:value={heightCm}
					class="h-11 w-full"
				/>
			</label>

			<fieldset>
				<legend class="text-muted mb-2 text-xs">Skin tone</legend>
				<div class="grid grid-cols-8 gap-2">
					{#each SKIN_VARS as colour, i (i)}
						<button
							type="button"
							aria-pressed={skin === i}
							aria-label="Skin tone {i + 1} of {SKIN_VARS.length}"
							onclick={() => (skin = i)}
							style:background={colour}
							class="border-muted/30 aspect-square min-h-6 rounded-full border {skin ===
							i
								? 'ring-neon ring-2 ring-offset-2'
								: ''}"
						></button>
					{/each}
				</div>
			</fieldset>
		</div>
	</div>

	<div class="mt-5 grid grid-cols-2 gap-2">
		<button
			type="button"
			disabled={busy}
			onclick={() => answer({})}
			class="btn btn-secondary btn-lg">Skip</button
		>
		<button
			type="button"
			disabled={busy}
			onclick={() => answer({ build, heightCm, skin })}
			class="btn btn-primary btn-lg">Save</button
		>
	</div>
</section>
