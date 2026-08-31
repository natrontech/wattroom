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

	const follow = () => {
		// A log that no longer overflows has no reading position to protect —
		// which also re-arms a reader who scrolled back and then cleared the
		// thread (switching DM peers empties the box).
		if (node.scrollHeight <= node.clientHeight) pinned = true;
		if (pinned) toBottom();
	};

	const onScroll = () => {
		pinned = atBottom(node);
	};

	toBottom();
	node.addEventListener('scroll', onScroll, { passive: true });
	// Images decode after their line is in the DOM and only then take up
	// height, so the mutation that added them has long since been handled.
	node.addEventListener('load', follow, true);

	const lines = new MutationObserver(follow);
	lines.observe(node, { childList: true, subtree: true, characterData: true });
	const box = new ResizeObserver(follow);
	box.observe(node);

	return () => {
		node.removeEventListener('scroll', onScroll);
		node.removeEventListener('load', follow, true);
		lines.disconnect();
		box.disconnect();
	};
}
