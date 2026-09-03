<!--
	Theme editor (#402). The gallery at /dev/themes proved three of the four
	identities were never actually designed — solved for a contrast gate, never
	looked at. This is where that design pass happens: the same deriveTheme()
	pipeline, driven by controls instead of a code edit + reload, against the
	same mock room the gallery uses.

	Two input layers, same as ThemeSpec itself: three hues derive every token,
	and any token except the zone ramp (shared across themes by design,
	ADR-0023 §4) can be painted over directly — the exact escape hatch Outrun
	already ships with, here as a colour picker instead of a hand-typed hex.

	Nothing here is saved. When a palette earns its slot, its numbers get
	copied into the SPECS array in $lib/themes.ts by hand — that file is the
	one place a theme becomes real.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { deriveTheme, type ThemeSpec } from '$lib/palette';
	import { specById } from '$lib/themes';
	import { toasts } from '$lib/toast.svelte';
	import { createRoom, medals, rooms } from '../room/mockRoom.svelte';
	import ThemePanel from '../themes/ThemePanel.svelte';
	import EditorControls, {
		OVERRIDABLE_TOKENS,
		type EditorState,
	} from './EditorControls.svelte';

	const room = createRoom();
	onMount(() => {
		void room.start();
		room.setPhase('live');
		return room.stop;
	});
	const medal = medals[0];

	function stateFromSpec(id: string, fallbackName: string): EditorState {
		const spec = specById(id);
		const overrides: EditorState['overrides'] = {};
		for (const token of OVERRIDABLE_TOKENS) {
			const exact = spec?.exact?.[token];
			if (exact) overrides[token] = exact;
		}
		return {
			name: spec?.name ?? fallbackName,
			wattHue: spec?.wattHue ?? 0,
			neonHue: spec?.neonHue ?? 0,
			surfaceHue: spec?.surfaceHue ?? 0,
			useWattLc: spec?.wattLc !== undefined,
			wattL: spec?.wattLc?.l ?? 0.7,
			wattC: spec?.wattLc?.c ?? 0.2,
			overrides,
		};
	}

	const PRESETS: { label: string; dark: string; white: string }[] = [
		{ label: 'Outrun', dark: 'outrun', white: 'outrun-day' },
		{ label: 'Tron', dark: 'tron-ice', white: 'tron-day' },
		{ label: 'Miami', dark: 'miami-nights', white: 'miami-day' },
		{ label: 'Laser', dark: 'laser-yellow', white: 'laser-day' },
	];

	let dark = $state(stateFromSpec('tron-ice', 'Draft'));
	let white = $state(stateFromSpec('tron-day', 'Draft Day'));

	function loadPreset(preset: (typeof PRESETS)[number]) {
		dark = stateFromSpec(preset.dark, preset.label);
		white = stateFromSpec(preset.white, `${preset.label} Day`);
	}

	function themeFrom(
		state: EditorState,
		family: ThemeSpec['family'],
	): ReturnType<typeof deriveTheme> {
		return deriveTheme({
			id: `draft-${family}`,
			identity: 'draft',
			name: state.name,
			note: `data ${Math.round(state.wattHue)}° · chrome ${Math.round(
				state.neonHue,
			)}° · surface ${Math.round(state.surfaceHue)}°`,
			family,
			wattHue: state.wattHue,
			neonHue: state.neonHue,
			surfaceHue: state.surfaceHue,
			wattLc: state.useWattLc ? { l: state.wattL, c: state.wattC } : undefined,
			exact: state.overrides,
		});
	}

	const darkTheme = $derived(themeFrom(dark, 'dark'));
	const whiteTheme = $derived(themeFrom(white, 'white'));

	function exportCode(state: EditorState, family: ThemeSpec['family']): string {
		const lc = state.useWattLc
			? `\n\t\twattLc: { l: ${state.wattL.toFixed(2)}, c: ${state.wattC.toFixed(3)} },`
			: '';
		const overridden = OVERRIDABLE_TOKENS.filter((t) => state.overrides[t]);
		const exact = overridden.length
			? `\n\t\texact: {\n${overridden
					.map((t) => `\t\t\t'${t}': '${state.overrides[t]}',`)
					.join('\n')}\n\t\t},`
			: '';
		return `{
		id: '…',
		identity: '…',
		name: '${state.name}',
		note: '…',
		family: '${family}',
		wattHue: ${Math.round(state.wattHue)},
		neonHue: ${Math.round(state.neonHue)},
		surfaceHue: ${Math.round(state.surfaceHue)},${lc}${exact}
	},`;
	}

	let copied = $state<'dark' | 'white' | null>(null);
	async function copy(state: EditorState, family: ThemeSpec['family']) {
		try {
			await navigator.clipboard.writeText(exportCode(state, family));
			copied = family;
			setTimeout(() => (copied = null), 1500);
		} catch {
			toasts.push('Copy needs clipboard permission', { tone: 'error' });
		}
	}
</script>

<main class="px-6 py-10">
	<header class="max-w-3xl">
		<h1 class="font-display text-3xl font-bold tracking-tight">Theme Editor</h1>
		<p class="text-muted mt-2 text-sm leading-relaxed">
			Drag a hue to rotate everything at once, or paint over any single token
			directly — both feed the same <code class="text-ink">deriveTheme()</code> pipeline
			the shipped catalogue uses, so contrast fitting, chroma floors and the zone
			ramp stay exactly as gated. Only the zone ramp (Z1–Z7) is off-limits here: it's
			shared across every theme by design (ADR-0023 §4), not a per-theme choice.
		</p>
	</header>

	<div class="mt-6 flex flex-wrap items-center gap-2">
		<span class="eyebrow">start from</span>
		{#each PRESETS as preset (preset.label)}
			<button
				type="button"
				class="btn btn-secondary btn-xs"
				onclick={() => loadPreset(preset)}>{preset.label}</button
			>
		{/each}
	</div>

	<div class="mt-8 grid gap-10 xl:grid-cols-2">
		<section>
			<h2 class="eyebrow">cave · dark</h2>
			<div class="mt-3 grid gap-4 lg:grid-cols-[15rem_1fr]">
				<EditorControls bind:state={dark} tokens={darkTheme.tokens} />
				<ThemePanel
					theme={darkTheme}
					surface="cave"
					riders={room.riders}
					segments={room.segments}
					total={room.total}
					elapsed={room.elapsed}
					{rooms}
					{medal}
				/>
			</div>
			<div class="mt-3">
				<pre
					class="bg-surface-raised border-edge overflow-x-auto rounded-lg border p-3 text-[11px] leading-relaxed">{exportCode(
						dark,
						'dark',
					)}</pre>
				<button
					type="button"
					class="btn btn-ghost btn-xs mt-2"
					onclick={() => copy(dark, 'dark')}
				>
					{copied === 'dark' ? 'copied' : 'copy'}
				</button>
			</div>
		</section>

		<section>
			<h2 class="eyebrow">desk · white</h2>
			<div class="mt-3 grid gap-4 lg:grid-cols-[15rem_1fr]">
				<EditorControls bind:state={white} tokens={whiteTheme.tokens} />
				<ThemePanel
					theme={whiteTheme}
					surface="desk"
					riders={room.riders}
					segments={room.segments}
					total={room.total}
					elapsed={room.elapsed}
					{rooms}
					{medal}
				/>
			</div>
			<div class="mt-3">
				<pre
					class="bg-surface-raised border-edge overflow-x-auto rounded-lg border p-3 text-[11px] leading-relaxed">{exportCode(
						white,
						'white',
					)}</pre>
				<button
					type="button"
					class="btn btn-ghost btn-xs mt-2"
					onclick={() => copy(white, 'white')}
				>
					{copied === 'white' ? 'copied' : 'copy'}
				</button>
			</div>
		</section>
	</div>
</main>
