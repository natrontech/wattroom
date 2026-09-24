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

	// Whether the reader is following, for the thread's "new messages" way
	// down. Only that: how many lines they missed is the thread's to count,
	// from its lines (#2703) — the DOM changing is not a message arriving.
	const tell = () =>
		node.dispatchEvent(
			new CustomEvent('wattroom-follow', { detail: { pinned } }),
		);

	// A log that no longer overflows has no reading position to protect —
	// which also re-arms a reader who scrolled back and then cleared the
	// thread (switching DM peers empties the box).
	const keep = () => {
		if (!pinned && node.scrollHeight <= node.clientHeight) {
			pinned = true;
			tell();
		}
		if (pinned) toBottom();
	};

	// The way down (#1765): the thread's "new messages" button.
	const onPin = () => {
		pinned = true;
		toBottom();
		tell();
	};
	const onScroll = () => {
		const was = pinned;
		pinned = atBottom(node);
		if (was !== pinned) tell();
	};

	toBottom();
	node.addEventListener('scroll', onScroll, { passive: true });
	node.addEventListener('wattroom-pin', onPin);

	// The content, not only the box: a new line, a picture decoding or a
	// link's card landing all grow it (#2686). A resize is reported after
	// layout and before paint, so the log re-pins in the same frame.
	const box = new ResizeObserver(keep);
	box.observe(node);
	for (const content of node.children) box.observe(content);

	return () => {
		node.removeEventListener('scroll', onScroll);
		node.removeEventListener('wattroom-pin', onPin);
		box.disconnect();
	};
}
