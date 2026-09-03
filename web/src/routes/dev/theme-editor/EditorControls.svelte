<!--
	One family's controls (#402). Three hues plus an optional watt lightness/
	chroma escape hatch are what deriveTheme() takes as input — and every token
	it produces except the zone ramp (shared across themes by design, ADR-0023
	§4) can be painted over directly. A picker shows the resolved value whether
	it came from a hue or an override, so there is one number on screen, not two
	disagreeing ones.
-->
<script lang="ts" module>
	import type { Tokens } from '$lib/palette';

	/** Every themed token except the zone ramp — that stays generated. */
	export const OVERRIDABLE_TOKENS = [
		'surface',
		'surface-raised',
		'muted',
		'watt',
		'neon',
		'ink',
		'paper',
		'danger',
	] as const satisfies readonly (keyof Tokens)[];

	export type OverridableToken = (typeof OVERRIDABLE_TOKENS)[number];

	const TOKEN_LABEL: Record<OverridableToken, string> = {
		surface: 'surface',
		'surface-raised': 'surface, raised',
		muted: 'muted text',
		watt: 'watt · live data',
		neon: 'neon · chrome',
		ink: 'ink · body text',
		paper: 'paper',
		danger: 'danger',
	};

	export interface EditorState {
		name: string;
		wattHue: number;
		neonHue: number;
		surfaceHue: number;
		useWattLc: boolean;
		wattL: number;
		wattC: number;
		/** Wins over derivation for whichever tokens are set (mirrors ThemeSpec.exact). */
		overrides: Partial<Record<OverridableToken, string>>;
	}
</script>

<script lang="ts">
	let { state = $bindable(), tokens }: { state: EditorState; tokens: Tokens } =
		$props();

	const hues: { key: 'wattHue' | 'neonHue' | 'surfaceHue'; label: string }[] = [
		{ key: 'wattHue', label: 'watt hue · live data' },
		{ key: 'neonHue', label: 'neon hue · chrome' },
		{ key: 'surfaceHue', label: 'surface hue' },
	];

	function setOverride(token: OverridableToken, hex: string) {
		state.overrides = { ...state.overrides, [token]: hex };
	}

	function clearOverride(token: OverridableToken) {
		const { [token]: _dropped, ...rest } = state.overrides;
		state.overrides = rest;
	}
</script>

<div class="space-y-3">
	<label class="block">
		<span class="eyebrow">name</span>
		<input class="input mt-1 w-full" bind:value={state.name} />
	</label>

	<div>
		<span class="eyebrow">derive from hue</span>
		<p class="text-muted/70 mt-1 text-[11px] leading-snug">
			Rotates every token that has no direct override below.
		</p>
		<div class="mt-2 space-y-3">
			{#each hues as hue (hue.key)}
				<label class="block">
					<span class="text-muted text-xs">
						{hue.label} · {Math.round(state[hue.key])}°
					</span>
					<input
						type="range"
						min="0"
						max="359"
						class="mt-1 w-full"
						bind:value={state[hue.key]}
					/>
				</label>
			{/each}
		</div>

		<label class="mt-3 flex items-center gap-2 text-xs">
			<input type="checkbox" bind:checked={state.useWattLc} />
			<span class="text-muted">
				override watt lightness/chroma — needed when a hue can't hold the
				family's default at that lightness (yellow, green)
			</span>
		</label>

		{#if state.useWattLc}
			<label class="mt-2 block">
				<span class="text-muted text-xs">
					watt lightness · {state.wattL.toFixed(2)}
				</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					class="mt-1 w-full"
					bind:value={state.wattL}
				/>
			</label>
			<label class="mt-2 block">
				<span class="text-muted text-xs">
					watt chroma · {state.wattC.toFixed(3)}
				</span>
				<input
					type="range"
					min="0"
					max="0.4"
					step="0.005"
					class="mt-1 w-full"
					bind:value={state.wattC}
				/>
			</label>
		{/if}
	</div>

	<div>
		<span class="eyebrow">every colour</span>
		<p class="text-muted/70 mt-1 text-[11px] leading-snug">
			Paints over the derived value for that one token. The zone ramp (Z1–Z7) is
			shared across every theme by design and isn't editable here.
		</p>
		<div class="mt-2 space-y-1.5">
			{#each OVERRIDABLE_TOKENS as token (token)}
				<div class="flex items-center gap-2">
					<input
						type="color"
						value={tokens[token]}
						oninput={(e) => setOverride(token, e.currentTarget.value)}
						class="border-edge h-7 w-9 shrink-0 cursor-pointer rounded border bg-transparent p-0"
						aria-label={TOKEN_LABEL[token]}
					/>
					<span class="min-w-0 flex-1 truncate text-xs">
						{TOKEN_LABEL[token]}
					</span>
					<span class="text-muted font-mono text-[10px]">{tokens[token]}</span>
					{#if state.overrides[token]}
						<button
							type="button"
							class="text-muted hover:text-ink shrink-0 text-[10px] underline"
							onclick={() => clearOverride(token)}>reset</button
						>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
