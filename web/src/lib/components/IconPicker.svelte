<script lang="ts">
	// The curated icon set as a radiogroup (#447): a room's mark and a crew's
	// (#1209) come from the same set, drawn by the same control, so the two
	// cannot drift. Chrome, not data — the neon ring is the structural accent.
	import { ROOM_ICONS } from '$lib/icons';

	let {
		value,
		onpick,
		disabled = false,
		labelledby,
	}: {
		/** The chosen key; '' is none. */
		value: string;
		onpick: (key: string) => void;
		disabled?: boolean;
		/** id of the visible label, when there is one. */
		labelledby?: string;
	} = $props();
</script>

<div
	class="flex flex-wrap items-center gap-1.5"
	role="radiogroup"
	aria-labelledby={labelledby}
	aria-label={labelledby ? undefined : 'icon'}
>
	<button
		type="button"
		role="radio"
		aria-checked={value === ''}
		onclick={() => onpick('')}
		{disabled}
		class="btn btn-secondary btn-xs {value === ''
			? 'ring-neon bg-neon/15 ring-1'
			: ''}">None</button
	>
	{#each Object.entries(ROOM_ICONS) as [key, Icon] (key)}
		<button
			type="button"
			role="radio"
			aria-checked={value === key}
			aria-label={key}
			title={key}
			onclick={() => onpick(key)}
			{disabled}
			class="btn btn-secondary btn-xs {value === key
				? 'ring-neon bg-neon/15 ring-1'
				: ''}"><Icon size={16} /></button
		>
	{/each}
</div>
