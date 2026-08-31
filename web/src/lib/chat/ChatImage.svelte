<script lang="ts">
	// One picture in a message (#279): a pasted upload or an allowlisted GIF.
	// Click opens the full size — the thumbnail is capped so a tall screenshot
	// can't push the conversation off screen.
	let { src, alt }: { src: string; alt: string } = $props();
</script>

<!-- No loading="lazy": in the panel's justify-end flex column the img's box is
     0x0 until it decodes, so the lazy threshold never fires and it never loads. -->
<a href={src} target="_blank" rel="noopener noreferrer" class="block w-fit">
	<img {src} {alt} class="ring-ink/10 mt-1 max-h-40 rounded ring-1" />
</a>
