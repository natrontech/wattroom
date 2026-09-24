// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { stickToBottom } from '$lib/chat/stick-to-bottom';

// happy-dom lays nothing out, so the scroll box is modelled by hand: the test
// says how tall the content is, and scrollTop clamps and fires `scroll` the way
// a real element does.

/** Stand-in for the browser's observer, so a resize can be driven. */
let resize: () => void = () => {};
let watched: Element[] = [];
class FakeResizeObserver {
	constructor(private cb: () => void) {
		watched = [];
		resize = () => this.cb();
	}
	observe(target: Element) {
		watched.push(target);
	}
	disconnect() {
		resize = () => {};
	}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

const BOX = 100;

function log(content: number) {
	const node = document.createElement('div');
	let top = 0;
	const box = { content };
	Object.defineProperty(node, 'clientHeight', { get: () => BOX });
	Object.defineProperty(node, 'scrollHeight', { get: () => box.content });
	Object.defineProperty(node, 'scrollTop', {
		get: () => top,
		set: (value: number) => {
			top = Math.max(0, Math.min(value, Math.max(0, box.content - BOX)));
			node.dispatchEvent(new Event('scroll'));
		},
	});
	return { node, box };
}

/** One more line arrives: the content grows, and its observer hears it. */
function say(node: HTMLElement, box: { content: number }, px = 20) {
	box.content += px;
	node.appendChild(document.createElement('p'));
	resize();
}

/** What the log tells the thread about following, in order. */
function heard(node: HTMLElement): boolean[] {
	const told: boolean[] = [];
	node.addEventListener('wattroom-follow', (event) =>
		told.push((event as CustomEvent<{ pinned: boolean }>).detail.pinned),
	);
	return told;
}

describe('stickToBottom (#291)', () => {
	it('opens on the newest line', () => {
		const { node } = log(400);
		stickToBottom(node);
		expect(node.scrollTop).toBe(300);
	});

	it('follows a new line for a reader at the bottom', () => {
		const { node, box } = log(400);
		stickToBottom(node);
		say(node, box);
		expect(node.scrollTop).toBe(320);
	});

	it('leaves a reader who scrolled back where they are', () => {
		const { node, box } = log(400);
		stickToBottom(node);
		node.scrollTop = 0;
		say(node, box);
		expect(node.scrollTop).toBe(0);
	});

	it('counts a few pixels off the bottom as the bottom', () => {
		const { node, box } = log(400);
		stickToBottom(node);
		node.scrollTop = 290;
		say(node, box);
		expect(node.scrollTop).toBe(320);
	});

	it('re-arms once the reader scrolls back down', () => {
		const { node, box } = log(400);
		stickToBottom(node);
		node.scrollTop = 0;
		say(node, box);
		node.scrollTop = box.content;
		say(node, box);
		expect(node.scrollTop).toBe(340);
	});

	it('watches the content, which grows after its line lands (#2686)', () => {
		// A picture decoding or a link's card arriving resizes the content, not
		// the box — only an observer on the content hears it before the frame
		// is painted.
		const { node, box } = log(400);
		const content = node.appendChild(document.createElement('div'));
		stickToBottom(node);
		expect(watched).toContain(content);
		box.content = 500;
		resize();
		expect(node.scrollTop).toBe(400);
	});

	it('keeps the newest line in view when the panel is resized', () => {
		const { node, box } = log(400);
		stickToBottom(node);
		box.content = 600;
		resize();
		expect(node.scrollTop).toBe(500);
	});

	it('tells the thread when the reader leaves the bottom and comes back', () => {
		// Only that: how many lines they missed is counted from the lines
		// (#2703), never from the DOM changing behind them.
		const { node, box } = log(400);
		stickToBottom(node);
		const told = heard(node);
		node.scrollTop = 0;
		say(node, box);
		node.scrollTop = box.content;
		expect(told).toEqual([false, true]);
	});

	it('re-arms a reader whose log stopped overflowing, and says so', () => {
		// Switching DM peers empties the thread without remounting it: the
		// thread must hear that its reader is following again, or it keeps
		// offering the old peer's "new messages".
		const { node, box } = log(400);
		stickToBottom(node);
		node.scrollTop = 0;
		const told = heard(node);
		box.content = 50;
		resize();
		expect(told).toEqual([true]);
		say(node, box, 400);
		expect(node.scrollTop).toBe(350);
	});

	it('stops following once detached', () => {
		const { node, box } = log(400);
		stickToBottom(node)();
		node.scrollTop = 0;
		say(node, box);
		expect(node.scrollTop).toBe(0);
	});
});
