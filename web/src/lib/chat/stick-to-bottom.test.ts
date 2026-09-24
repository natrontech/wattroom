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
	disconnect = vi.fn();
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

/** One more line arrives: the DOM grows, then the observers get their turn. */
async function say(node: HTMLElement, box: { content: number }, px = 20) {
	box.content += px;
	node.appendChild(document.createElement('p'));
	await new Promise((done) => setTimeout(done, 0));
}

describe('stickToBottom (#291)', () => {
	it('opens on the newest line', () => {
		const { node } = log(400);
		stickToBottom(node);
		expect(node.scrollTop).toBe(300);
	});

	it('follows a new line for a reader at the bottom', async () => {
		const { node, box } = log(400);
		stickToBottom(node);
		await say(node, box);
		expect(node.scrollTop).toBe(320);
	});

	it('leaves a reader who scrolled back where they are', async () => {
		const { node, box } = log(400);
		stickToBottom(node);
		node.scrollTop = 0;
		await say(node, box);
		expect(node.scrollTop).toBe(0);
	});

	it('counts a few pixels off the bottom as the bottom', async () => {
		const { node, box } = log(400);
		stickToBottom(node);
		node.scrollTop = 290;
		await say(node, box);
		expect(node.scrollTop).toBe(320);
	});

	it('re-arms once the reader scrolls back down', async () => {
		const { node, box } = log(400);
		stickToBottom(node);
		node.scrollTop = 0;
		await say(node, box);
		node.scrollTop = box.content;
		await say(node, box);
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

	it('counts a resize as no new line for a reader scrolled back', () => {
		const { node, box } = log(400);
		stickToBottom(node);
		node.scrollTop = 0;
		const heard: number[] = [];
		node.addEventListener('wattroom-follow', (e) =>
			heard.push((e as CustomEvent<{ missed: number }>).detail.missed),
		);
		box.content = 420;
		resize();
		expect(node.scrollTop).toBe(0);
		expect(heard).toEqual([]);
	});

	it('stops following once detached', async () => {
		const { node, box } = log(400);
		stickToBottom(node)();
		node.scrollTop = 0;
		await say(node, box);
		expect(node.scrollTop).toBe(0);
	});
});
