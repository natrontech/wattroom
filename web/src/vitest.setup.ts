// Unit tests run under happy-dom, where a relative `fetch('/api/…')` resolves
// to http://localhost:3000 and goes out on a real socket. Nothing listens, so
// every poll a component starts on mount — DM heads, presence, the account —
// failed with ECONNREFUSED after a round trip, and the AggregateErrors buried
// the summary line in CI (#1870 read as red twice). The failure the app sees
// is the same: the browser's own "Failed to fetch". Immediate, and silent.
// A test that wants a server stubs fetch itself, and still can.
globalThis.fetch = async () => {
	throw new TypeError('Failed to fetch');
};

// Node 26 ships the Web Storage globals, and its `localStorage` is inert: the
// getter warns and evaluates to undefined unless the process was started with
// --localstorage-file. vitest's happy-dom environment copies a window property
// onto the global only when the platform has not defined one already, and
// `localStorage` is not among the names it copies regardless — so on Node 26
// the inert global wins, and a happy-dom test reading storage gets undefined
// while CI's Node 24, which has no such global, stays green (#2058). Install
// happy-dom's own Storage so the suite behaves the same on every Node.
// `sessionStorage` needs no repair: Node's works, and each file gets its own
// worker, so it still starts empty. Node-environment tests are left alone —
// `localStorage` stays undefined there, which is the branch the guards in
// profile.svelte.ts and palette.svelte.ts are written against.
if (typeof document !== 'undefined') {
	Object.defineProperty(globalThis, 'localStorage', {
		value: new Storage(),
		configurable: true,
		writable: true,
	});
}
