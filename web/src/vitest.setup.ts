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

// Storage needs no repair here any more (#2346). vitest 4's happy-dom
// environment copied a window property onto the global only when the platform
// had not already defined one, so Node 26's inert `localStorage` — a getter
// that warns and evaluates to undefined without --localstorage-file — won, and
// a happy-dom test reading storage got undefined while CI's Node 24, which has
// no such global, stayed green (#2058). vitest 5 installs every global as an
// accessor pair bound to the window regardless, so `globalThis.localStorage`
// *is* `window.localStorage` on both Nodes and the shim that stood here would
// now replace that live accessor with a detached Storage of its own.
//
// src/vitest.setup.test.ts is what keeps this honest: it asserts the round trip
// through three storage-backed modules, so a Node or a vitest that breaks the
// global again fails there by name instead of silently handing the suite
// defaults.
