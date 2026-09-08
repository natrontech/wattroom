<script lang="ts">
	import {
		isNewer,
		latestRelease,
		shellVersion,
		type DesktopRelease,
	} from '$lib/desktop';

	// The desktop shell's update nudge (#296). Home only, beside the what's-new
	// notice and for the same reason: never mid-ride (ux.md). The shell polls
	// nothing — this asks once per page load, and a version the rider waved
	// away stays away. It renders nothing at all in a browser.
	const SKIPPED = 'wattroom.desktop-skipped.v1';

	const running = shellVersion();
	let latest = $state<DesktopRelease | null>(null);
	let skipped = $state(readSkipped());
	if (running) void latestRelease().then((r) => (latest = r));

	const offer = $derived(
		running &&
			latest &&
			isNewer(latest.version, running) &&
			skipped !== latest.version
			? latest
			: null,
	);

	function readSkipped(): string | null {
		try {
			return localStorage.getItem(SKIPPED);
		} catch {
			return null;
		}
	}

	function skip() {
		if (!latest) return;
		try {
			localStorage.setItem(SKIPPED, latest.version);
		} catch {
			/* no storage: the notice returns next load, the safe direction */
		}
		skipped = latest.version;
	}
</script>

{#if offer}
	<section class="panel mt-6 flex flex-wrap items-center gap-3 px-5 py-4">
		<div class="min-w-48 flex-1">
			<p class="eyebrow">desktop app</p>
			<p class="mt-1 text-sm">
				WattRoom {offer.version} is out — you are on {running}.
			</p>
		</div>
		<a href="/download" class="btn btn-primary">Get the update</a>
		<button class="btn-link text-xs" onclick={skip}>Not now</button>
	</section>
{/if}
