// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { stickToBottom } from '$lib/chat/stick-to-bottom';

// happy-dom lays nothing out, so the scroll box is modelled by hand: the test
// says how tall the content is, and scrollTop clamps and fires `scroll` the way
// a real element does.

/** Stand-in for the browser's observer, so a panel resize can be driven. */
let resize: () => void = () => {};
class FakeResizeObserver {
	constructor(private cb: () => void) {
		resize = () => this.cb();
	}
	observe() {}
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

	it('follows an image that only takes up height once it decodes', () => {
		const { node, box } = log(400);
		stickToBottom(node);
		const image = document.createElement('img');
		node.appendChild(image);
		box.content = 500;
		image.dispatchEvent(new Event('load'));
		expect(node.scrollTop).toBe(400);
	});

	it('keeps the newest line in view when the panel is resized', () => {
		const { node, box } = log(400);
		stickToBottom(node);
		box.content = 600;
		resize();
		expect(node.scrollTop).toBe(500);
	});

	it('stops following once detached', async () => {
		const { node, box } = log(400);
		stickToBottom(node)();
		node.scrollTop = 0;
		await say(node, box);
		expect(node.scrollTop).toBe(0);
	});
});
