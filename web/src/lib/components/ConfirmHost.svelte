<script lang="ts">
	// The one confirm dialog (#1127). Danger token on the action, always:
	// confirming is reserved for what cannot be undone (errors.md). btn-lg
	// because two of the questions are asked mid-ride.
	import { confirmation } from '$lib/confirm.svelte';
	import Modal from './Modal.svelte';
</script>

{#if confirmation.current}
	{@const ask = confirmation.current}
	<Modal label={ask.title} onclose={() => confirmation.settle(false)}>
		<h2 class="font-display text-lg leading-tight font-bold">{ask.title}</h2>
		{#if ask.body}
			<p class="text-muted mt-2 text-sm">{ask.body}</p>
		{/if}
		<div class="mt-5 flex flex-wrap gap-2">
			<button
				onclick={() => confirmation.settle(true)}
				class="btn btn-danger-solid btn-lg">{ask.action}</button
			>
			<button
				onclick={() => confirmation.settle(false)}
				class="btn btn-secondary btn-lg">{ask.cancel ?? 'Cancel'}</button
			>
		</div>
	</Modal>
{/if}
