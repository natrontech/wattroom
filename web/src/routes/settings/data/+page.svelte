<script lang="ts">
	// Your data (#1330): what leaves the account and what reads it — the
	// export and the purge (YourData), and the read-only tokens for your own
	// AI and tools (ADR-0017).
	import CoachAccess from '$lib/profile/CoachAccess.svelte';
	import YourData from '$lib/profile/YourData.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<CoachAccess initial={data.tokens} initialError={data.tokensError} />
<YourData />
