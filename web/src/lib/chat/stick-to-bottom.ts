/**
 * A chat log that stays readable while it grows (#291).
 *
 * The panel used to bottom-pin with `justify-end`, which is not a scroll
 * behaviour at all: it parks the content against the bottom edge and lets the
 * overflow spill past the *start* edge, where no browser will scroll. The
 * layout fix is `mt-auto` on the list inside a `min-h-0` scroll box; this
 * attachment supplies the part the flexbox was standing in for — following the
 * newest line — and makes it conditional. A rider reading scrollback mid-ride
 * must not be yanked to the bottom because someone else typed.
 */

/** A few pixels off the bottom still counts as being at the bottom. */
const AT_BOTTOM_PX = 32;

function atBottom(node: HTMLElement): boolean {
	return node.scrollHeight - node.scrollTop - node.clientHeight <= AT_BOTTOM_PX;
}

/** Attach to the scroll container; the messages are its children. */
export function stickToBottom(node: HTMLElement): () => void {
	let pinned = true;

	const toBottom = () => {
		node.scrollTop = node.scrollHeight;
	};

	// A log that no longer overflows has no reading position to protect —
	// which also re-arms a reader who scrolled back and then cleared the
	// thread (switching DM peers empties the box).
	const keep = () => {
		if (node.scrollHeight <= node.clientHeight) pinned = true;
		if (pinned) toBottom();
	};
	// Only the DOM changing is a line landing. The box resizing — a composer
	// growing a row as you type (#2642) — or a picture decoding is not one,
	// and counting them told a reader about messages nobody sent.
	const follow = () => {
		keep();
		if (pinned) return;
		missed += 1;
		tell();
	};

	// Your own send pins and scrolls (#1765): the rule that arrivals never
	// yank a reader is right for arrivals and wrong for what you just typed.
	const onPin = () => {
		pinned = true;
		missed = 0;
		toBottom();
		tell();
	};
	// How many lines landed behind a reader who scrolled back, for the
	// "new messages" way down.
	let missed = 0;
	const tell = () =>
		node.dispatchEvent(
			new CustomEvent('wattroom-follow', { detail: { pinned, missed } }),
		);
	const onScroll = () => {
		const was = pinned;
		pinned = atBottom(node);
		if (pinned) missed = 0;
		if (was !== pinned || pinned) tell();
	};

	toBottom();
	node.addEventListener('scroll', onScroll, { passive: true });
	node.addEventListener('wattroom-pin', onPin);

	const lines = new MutationObserver(follow);
	lines.observe(node, { childList: true, subtree: true, characterData: true });
	// The content too, not only the box (#2686): a picture decoding or a
	// link's card landing grows a line long after the mutation that added it.
	// A resize is reported after layout and before paint, so the log re-pins
	// in the same frame; the image `load` event this replaces could arrive a
	// frame late, and that frame showed the thread jumping.
	const box = new ResizeObserver(keep);
	box.observe(node);
	for (const content of node.children) box.observe(content);

	return () => {
		node.removeEventListener('scroll', onScroll);
		node.removeEventListener('wattroom-pin', onPin);
		lines.disconnect();
		box.disconnect();
	};
}
