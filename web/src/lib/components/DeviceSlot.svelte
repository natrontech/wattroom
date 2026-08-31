<script module lang="ts">
	export type SlotState =
		'idle' | 'requesting' | 'connecting' | 'connected' | 'failed';

	export interface Slot {
		id: string;
		label: string;
		/** what the rider loses without it — capability gating needs a reason, not a shrug */
		need: string;
		required: boolean;
		device?: string;
		protocol?: string;
		battery?: number;
	}
</script>

<script lang="ts">
	let {
		slot,
		state,
		supported,
		onPair,
		onForget,
	}: {
		slot: Slot;
		state: SlotState;
		supported: boolean;
		onPair: () => void;
		onForget: () => void;
	} = $props();

	const busy = $derived(state === 'requesting' || state === 'connecting');
</script>

<div class="panel p-5">
	<div class="flex items-start gap-4">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<h3 class="font-display font-bold">{slot.label}</h3>
				{#if !slot.required}
					<span class="eyebrow">optional</span>
				{/if}
			</div>

			{#if state === 'connected'}
				<p class="mt-1 text-sm">{slot.device}</p>
				<p class="text-muted mt-0.5 font-mono text-[11px]">
					{slot.protocol}{#if slot.battery}
						· battery {slot.battery}%{/if}
				</p>
			{:else if state === 'requesting'}
				<p class="text-muted mt-1 text-sm">
					Pick your {slot.label.toLowerCase()} in the browser's Bluetooth dialog.
				</p>
			{:else if state === 'connecting'}
				<p class="text-muted mt-1 text-sm">Connecting…</p>
			{:else if state === 'failed'}
				<!-- What went wrong, why, and what to do — never "something went wrong". -->
				<p class="text-z6 mt-1 text-sm">Couldn't connect</p>
				<p class="text-muted mt-0.5 text-xs">
					The device stopped responding after pairing. Wake it up — spin the
					cranks or press its button — then try again. If it's paired to another
					app, close that first.
				</p>
			{:else}
				<p class="text-muted mt-1 text-xs">{slot.need}</p>
			{/if}
		</div>

		<div class="shrink-0">
			{#if state === 'connected'}
				<div class="flex items-center gap-3">
					<span class="bg-z4 h-2 w-2 rounded-full"></span>
					<button
						onclick={onForget}
						class="border-muted/25 hover:border-muted/60 rounded border px-3 py-2 text-xs"
						>Forget</button
					>
				</div>
			{:else}
				<!-- Never render a button that will fail: no Web Bluetooth, no live control. -->
				<button
					onclick={onPair}
					disabled={!supported || busy}
					class="btn {state === 'failed' ? 'btn-secondary' : 'btn-primary'}"
					>{busy
						? 'Pairing…'
						: state === 'failed'
							? 'Try again'
							: 'Pair'}</button
				>
			{/if}
		</div>
	</div>
</div>
