<!--
	Theme editor (#402). The gallery at /dev/themes proved three of the four
	identities were never actually designed — solved for a contrast gate, never
	looked at. This is where that design pass happens: the same deriveTheme()
	pipeline, driven by sliders instead of a code edit + reload, against the
	same mock room the gallery uses.

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
	import EditorControls, { type EditorState } from './EditorControls.svelte';

	const room = createRoom();
	onMount(() => {
		void room.start();
		room.setPhase('live');
		return room.stop;
	});
	const medal = medals[0];

	function stateFromSpec(id: string, fallbackName: string): EditorState {
		const spec = specById(id);
		return {
			name: spec?.name ?? fallbackName,
			wattHue: spec?.wattHue ?? 0,
			neonHue: spec?.neonHue ?? 0,
			surfaceHue: spec?.surfaceHue ?? 0,
			useWattLc: spec?.wattLc !== undefined,
			wattL: spec?.wattLc?.l ?? 0.7,
			wattC: spec?.wattLc?.c ?? 0.2,
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
		});
	}

	const darkTheme = $derived(themeFrom(dark, 'dark'));
	const whiteTheme = $derived(themeFrom(white, 'white'));

	function exportCode(state: EditorState, family: ThemeSpec['family']): string {
		const lc = state.useWattLc
			? `\n\t\twattLc: { l: ${state.wattL.toFixed(2)}, c: ${state.wattC.toFixed(3)} },`
			: '';
		return `{
		id: '…',
		identity: '…',
		name: '${state.name}',
		note: '…',
		family: '${family}',
		wattHue: ${Math.round(state.wattHue)},
		neonHue: ${Math.round(state.neonHue)},
		surfaceHue: ${Math.round(state.surfaceHue)},${lc}
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
			Three hues and an optional watt override are the entire input a theme
			takes — everything else (contrast fitting, the zone ramp, chroma floors)
			is <code class="text-ink">deriveTheme()</code>, unchanged. Drag a slider
			and the whole mock room repaints, live, the same panel
			<a href="/dev/themes" class="text-ink underline">/dev/themes</a> renders for
			the shipped catalogue.
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
				<EditorControls bind:state={dark} />
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
				<EditorControls bind:state={white} />
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
