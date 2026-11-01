<script lang="ts">
	// Dev-only tools: /dev/card (share cards, make screenshots) and /dev/perf (make perf).
	let { children } = $props();
</script>

<div class="cave bg-surface text-ink flex h-screen flex-col">
	<div class="min-h-0 flex-1 overflow-y-auto">
		{@render children()}
	</div>
</div>
