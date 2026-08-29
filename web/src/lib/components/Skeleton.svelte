<script lang="ts">
	let { class: className = '', rows = 1 }: { class?: string; rows?: number } =
		$props();
</script>

{#each { length: rows } as _, i (i)}
	<div class="skeleton rounded {className}" aria-hidden="true"></div>
{/each}
