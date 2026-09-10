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
