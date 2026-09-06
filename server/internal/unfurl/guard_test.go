package unfurl

import (
	"net"
	"net/url"
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
	s := New(nil, nil)
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
		if err := s.checkTarget(u); err != nil {
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
		if err := s.checkTarget(u); err == nil {
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
