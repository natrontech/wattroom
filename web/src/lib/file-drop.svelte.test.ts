// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fileDrop } from './file-drop.svelte';

/**
 * The surface and one of its own children, which is what the leave rule is
 * about: a real Node pair, because the rule asks the DOM `contains`.
 */
function surface() {
	const node = document.createElement('div');
	const child = document.createElement('button');
	node.append(child);
	document.body.append(node);
	return { node, child };
}

function drag(
	currentTarget: Node,
	extra: { relatedTarget?: Node | null; files?: unknown[] } = {},
) {
	let prevented = false;
	const event = {
		currentTarget,
		relatedTarget: extra.relatedTarget ?? null,
		dataTransfer: extra.files ? { files: extra.files } : undefined,
		preventDefault: () => (prevented = true),
	};
	return { event: event as unknown as DragEvent, prevented: () => prevented };
}

describe('fileDrop', () => {
	it('lights the surface, and takes the default the browser would', () => {
		const { node } = surface();
		const drop = fileDrop(() => {});
		const over = drag(node);

		drop.on.ondragover(over.event);

		expect(drop.over).toBe(true);
		// Without this the drop never fires and the page navigates to the file.
		expect(over.prevented()).toBe(true);
	});

	it('stays lit while the pointer crosses the surface’s own children', () => {
		const { node, child } = surface();
		const drop = fileDrop(() => {});
		drop.on.ondragover(drag(node).event);

		drop.on.ondragleave(drag(node, { relatedTarget: child }).event);

		expect(drop.over).toBe(true);
	});

	it('goes out when the pointer actually leaves', () => {
		const { node } = surface();
		const outside = document.createElement('div');
		document.body.append(outside);
		const drop = fileDrop(() => {});
		drop.on.ondragover(drag(node).event);

		drop.on.ondragleave(drag(node, { relatedTarget: outside }).event);

		expect(drop.over).toBe(false);
	});

	it('hands the files over and goes out', () => {
		const { node } = surface();
		const taken: FileList[] = [];
		const drop = fileDrop((files) => taken.push(files));
		drop.on.ondragover(drag(node).event);
		const dropped = drag(node, { files: ['a.mp3', 'b.mp3'] });

		drop.on.ondrop(dropped.event);

		expect(Array.from(taken[0] as unknown as string[])).toEqual([
			'a.mp3',
			'b.mp3',
		]);
		expect(drop.over).toBe(false);
		expect(dropped.prevented()).toBe(true);
	});

	it('says nothing when a drag carries no files', () => {
		const { node } = surface();
		let called = 0;
		const drop = fileDrop(() => called++);

		drop.on.ondrop(drag(node, { files: [] }).event);
		drop.on.ondrop(drag(node).event);

		expect(called).toBe(0);
	});
});
