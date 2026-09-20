package unfurl

import (
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
)

func TestPublicIPRefusesEverythingOffThePublicInternet(t *testing.T) {
	// The list is the threat model: an SSRF is aimed at the operator's own
	// network, so each of these is one door somebody would try.
	cases := []struct {
		ip   string
		want bool
		why  string
	}{
		{"1.1.1.1", true, "an ordinary public resolver"},
		{"93.184.216.34", true, "an ordinary public host"},
		{"2606:4700:4700::1111", true, "public v6"},

		{"127.0.0.1", false, "loopback — the server talking to itself"},
		{"127.9.9.9", false, "the rest of 127/8 is loopback too"},
		{"0.0.0.0", false, "unspecified"},
		{"10.1.2.3", false, "RFC 1918"},
		{"172.16.0.1", false, "RFC 1918"},
		{"172.31.255.254", false, "the top of RFC 1918's /12"},
		{"192.168.1.1", false, "RFC 1918 — the home router"},
		{"169.254.169.254", false, "link-local: the cloud metadata endpoint"},
		{"100.64.0.1", false, "CGNAT"},
		{"192.0.0.1", false, "IETF protocol assignments"},
		{"198.18.0.1", false, "benchmarking"},
		{"224.0.0.1", false, "multicast"},
		{"255.255.255.255", false, "broadcast"},

		{"::1", false, "v6 loopback"},
		{"::", false, "v6 unspecified"},
		{"fe80::1", false, "v6 link-local"},
		{"fc00::1", false, "v6 unique-local"},
		{"fd00::1", false, "v6 unique-local"},
		{"ff02::1", false, "v6 multicast"},

		// The wrappers: a v4 address wearing a v6 costume must be judged as
		// the v4 address it is, or every rule above has a bypass.
		{"::ffff:127.0.0.1", false, "v4-mapped loopback"},
		{"::ffff:169.254.169.254", false, "v4-mapped metadata endpoint"},
		{"::ffff:10.0.0.1", false, "v4-mapped RFC 1918"},
		{"64:ff9b::7f00:1", false, "NAT64 wrapping loopback"},
		{"2002:7f00:1::", false, "6to4 wrapping loopback"},
		{"::7f00:1", false, "v4-compatible IPv6 wrapping loopback"},
		{"::a9fe:a9fe", false, "v4-compatible IPv6 wrapping the metadata endpoint"},
		{"2001:0:53aa:64c:0:0:7f00:1", false, "Teredo"},

		// Ranges a resolver will hand back and no host on the public internet
		// answers on (#2240).
		{"0.1.2.3", false, "\"this network\""},
		{"240.0.0.1", false, "reserved for the future"},
		{"255.255.255.255", false, "broadcast"},
		{"2001:db8::1", false, "documentation"},
	}
	for _, c := range cases {
		t.Run(c.ip, func(t *testing.T) {
			ip := net.ParseIP(c.ip)
			if ip == nil {
				t.Fatalf("test bug: %q is not an address", c.ip)
			}
			if got := publicIP(ip); got != c.want {
				t.Fatalf("publicIP(%s) = %v, want %v — %s", c.ip, got, c.want, c.why)
			}
		})
	}
}

func TestCheckURLTakesOnlyHTTP(t *testing.T) {
	for _, raw := range []string{
		"http://example.com/a",
		"https://example.com/a",
	} {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if err := checkURL(u); err != nil {
			t.Fatalf("%s refused: %v", raw, err)
		}
	}
	// file: and gopher: are the classic redirect targets; data: and
	// javascript: are what an og:image tries to be.
	for _, raw := range []string{
		"file:///etc/passwd",
		"gopher://example.com:70/_x",
		"ftp://example.com/x",
		"data:text/html,<b>x",
		"javascript:alert(1)",
		"https://",
	} {
		u, err := url.Parse(raw)
		if err != nil {
			continue // unparseable is refused earlier, which is also fine
		}
		if err := checkURL(u); err == nil {
			t.Fatalf("%s was allowed", raw)
		}
	}
}

func TestCheckTargetTakesOnlyTheWebsPorts(t *testing.T) {
	// Without this the endpoint is a port scanner: a public host is still a
	// host with an SSH daemon, a database, and a redirect pointing at them.
	f := NewFetcher(nil)
	for _, raw := range []string{
		"https://example.com/a",
		"https://example.com:443/a",
		"http://example.com:80/a",
		"http://example.com:8080/a",
	} {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if err := f.checkTarget(u); err != nil {
			t.Fatalf("%s refused: %v", raw, err)
		}
	}
	for _, raw := range []string{
		"http://example.com:22/",
		"http://example.com:25/",
		"http://example.com:6379/",
		"http://example.com:5432/",
		"http://example.com:11211/",
	} {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if err := f.checkTarget(u); err == nil {
			t.Fatalf("%s was allowed", raw)
		}
	}
}

func TestRenderableImageLeavesSVGOut(t *testing.T) {
	// An SVG is a document. Served from our own origin and opened in a tab it
	// runs its own script as WattRoom — which is why a thumbnail may not be
	// one, however the linked site labels it.
	for _, kind := range []string{"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"} {
		if !renderableImage(kind) {
			t.Fatalf("%s refused", kind)
		}
	}
	for _, kind := range []string{
		"image/svg+xml", "text/html", "application/xhtml+xml",
		"image/svg", "", "application/octet-stream",
	} {
		if renderableImage(kind) {
			t.Fatalf("%s allowed through as a picture", kind)
		}
	}
}

func TestSafeDialRefusesANameThatResolvesInward(t *testing.T) {
	// localhost is the shape of every rebind payload: a name that resolves to
	// an address inside. The dial must never happen.
	conn, err := safeDial(t.Context(), "tcp", "localhost:80")
	if err == nil {
		_ = conn.Close()
		t.Fatal("dialled localhost")
	}
	conn, err = safeDial(t.Context(), "tcp", "127.0.0.1:80")
	if err == nil {
		_ = conn.Close()
		t.Fatal("dialled a literal loopback address")
	}
}

// loopbackFetcher is the real policy with the dialer taken out: httptest
// listens on 127.0.0.1, which safeDial refuses by design (the test above
// keeps that). What these two exercise is the other half of the policy —
// the redirect closure in newClient — so the client keeps its CheckRedirect
// and gets an ordinary transport underneath it.
func loopbackFetcher(t *testing.T, ports map[string]bool) *Fetcher {
	t.Helper()
	f := NewFetcher(nil)
	f.ports = ports
	f.client.Transport = &http.Transport{DisableKeepAlives: true}
	return f
}

func portOf(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("test bug: %q is not a url: %v", raw, err)
	}
	return u.Port()
}

func TestARedirectToANonWebPortIsRefused(t *testing.T) {
	// The port scanner webPorts exists to stop, one hop later: a host that
	// passes the first check and then 302s at somebody's SSH daemon.
	scanned := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, "<title>a port that is not the web</title>")
	}))
	defer scanned.Close()
	entry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, scanned.URL+"/", http.StatusFound)
	}))
	defer entry.Close()

	// Only the first server's port is on the web. The second's is the port
	// the policy has to refuse, and it is reachable only by redirect.
	f := loopbackFetcher(t, map[string]bool{portOf(t, entry.URL): true})
	resp, err := f.get(t.Context(), entry.URL+"/page")
	if resp != nil {
		_ = resp.Body.Close()
	}
	if !errors.Is(err, errBadPort) {
		t.Fatalf("get followed a redirect to %s: err = %v, want %v", scanned.URL, err, errBadPort)
	}
}

func TestARedirectChainStopsAtTheHopCeiling(t *testing.T) {
	// The ceiling is five hops — spelled out rather than read off
	// maxRedirects, because a test that compares the constant to itself
	// passes at any value the constant takes. The chain is finite for the
	// same reason: a ceiling that has stopped working must fail this test
	// rather than hang it.
	const ceiling, chain = 5, 20
	var served atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if served.Add(1) > chain {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.Redirect(w, r, "/hop", http.StatusFound)
	}))
	defer srv.Close()

	f := loopbackFetcher(t, nil) // any port: the ceiling is what is under test
	resp, err := f.get(t.Context(), srv.URL+"/hop")
	if resp != nil {
		_ = resp.Body.Close()
	}
	if !errors.Is(err, errTooManyHop) {
		t.Fatalf("get = %v, want %v after %d hops", err, errTooManyHop, served.Load())
	}
	if got := int(served.Load()); got != ceiling {
		t.Fatalf("followed %d hops, want %d", got, ceiling)
	}
}
