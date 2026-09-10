package unfurl

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"time"
)

// The outbound fetch policy (ADR-0031). This file is the reason the package
// exists: fetching a URL a rider typed is an SSRF primitive, and everything
// below is what makes it a bounded one.

// Fetcher is that policy without the endpoints: one guarded client, and the
// reads WattRoom does through it. It is a type rather than a set of methods on
// Service so that the other caller who has to fetch from a host we do not
// control can have the same guard instead of a second one — a rider's sign-in
// picture, copied onto this origin at sign-in (server/internal/avatars,
// #2078). Two outbound clients would be two SSRF surfaces to keep in step,
// and one of them would fall behind.
type Fetcher struct {
	log *slog.Logger
	// The one client this package fetches with. Never http.Get, never
	// http.DefaultClient: this is what decides where a socket may go.
	client *http.Client
	// The ports an outbound fetch may use; nil means any (tests only).
	ports map[string]bool
}

// NewFetcher builds the guarded client. Callers that only fetch — no
// endpoints, no rider ration — take one of these directly.
func NewFetcher(log *slog.Logger) *Fetcher {
	f := &Fetcher{log: log, ports: webPorts}
	// After ports: the client's redirect check reads the policy off f.
	f.client = f.newClient()
	return f
}

const (
	// maxRedirects: enough for the http→https→www chain every real site has,
	// far short of a loop.
	maxRedirects = 5
	// dialTimeout bounds one connection attempt; fetchTimeout bounds the whole
	// request including redirects, so a chain of slow hops cannot add up.
	dialTimeout  = 4 * time.Second
	fetchTimeout = 8 * time.Second
	// A page's metadata is in its <head>; nothing below this is worth the
	// bytes, and a body with no ceiling is a memory hole a stranger picks.
	maxHTMLBytes = 512 << 10
	// A preview thumbnail. Above this the proxy stops reading and the card
	// renders without a picture.
	maxImageBytes = 2 << 20
	// Sent instead of Go's default so an operator reading their logs knows
	// who called and why. No WattRoom credential ever rides along.
	userAgent = "WattRoomBot/1.0 (+https://wattroom.ch; link preview)"
)

var (
	errBadScheme  = errors.New("unfurl: only http and https")
	errBadPort    = errors.New("unfurl: only the web's own ports")
	errBlockedIP  = errors.New("unfurl: address is not on the public internet")
	errTooManyHop = errors.New("unfurl: too many redirects")
)

// blockedNets are the ranges Go's own predicates do not already cover.
// IsGlobalUnicast rules out loopback, unspecified, multicast and link-local;
// IsPrivate rules out RFC 1918 and RFC 4193. What is left is the set of
// addresses that look public to a resolver and are not.
var blockedNets = func() []*net.IPNet {
	cidrs := []string{
		"100.64.0.0/10",   // CGNAT — the ISP's side of a home router
		"192.0.0.0/24",    // IETF protocol assignments
		"192.0.2.0/24",    // TEST-NET-1
		"198.18.0.0/15",   // benchmarking
		"198.51.100.0/24", // TEST-NET-2
		"203.0.113.0/24",  // TEST-NET-3
		"192.88.99.0/24",  // deprecated 6to4 relay anycast
		"64:ff9b::/96",    // NAT64 — a v6 wrapper around a v4 address
		"2002::/16",       // 6to4, same trick
		"100::/64",        // discard-only
	}
	nets := make([]*net.IPNet, 0, len(cidrs))
	for _, cidr := range cidrs {
		_, n, err := net.ParseCIDR(cidr)
		if err != nil {
			panic("unfurl: bad built-in cidr " + cidr) // compile-time constant
		}
		nets = append(nets, n)
	}
	return nets
}()

// publicIP reports whether an address is one we are willing to open a socket
// to. Everything private, local, or otherwise inside the operator's network
// is refused — that network is what an SSRF is aimed at.
func publicIP(ip net.IP) bool {
	if !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return false
	}
	// A v4-mapped v6 address is a v4 address; judge it as one, or ::ffff:10.0.0.1
	// walks past every check below.
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	for _, n := range blockedNets {
		if n.Contains(ip) {
			return false
		}
	}
	return true
}

// checkURL is the scheme half of the policy, applied to the rider's URL and
// again to every redirect target. The address half happens in the dialer,
// because a hostname checked here is not the host that gets connected to.
func checkURL(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("%w: %q", errBadScheme, u.Scheme)
	}
	if u.Host == "" {
		return errBadScheme
	}
	return nil
}

// webPorts is the port half of the policy. Every address the dialer allows is
// public, but "public" is not the same as "a web server": without this the
// endpoint is a port scanner anyone with a chat box can point at any host on
// the internet, one redirect at a time.
//
// A Fetcher field rather than a constant so a test can widen it — an httptest
// server lives on a random high port, and a policy nothing can exercise is
// not one worth having.
var webPorts = map[string]bool{"": true, "80": true, "443": true, "8080": true, "8443": true}

// checkTarget is the full policy for one URL: scheme, host, port.
func (f *Fetcher) checkTarget(u *url.URL) error {
	if err := checkURL(u); err != nil {
		return err
	}
	if f.ports != nil && !f.ports[u.Port()] {
		return fmt.Errorf("%w: %q", errBadPort, u.Port())
	}
	return nil
}

// safeDial resolves the name itself, refuses every address that is not on the
// public internet, and then dials **the address it checked** rather than the
// name. That last part is the whole point: a resolver consulted twice can
// answer twice, and a DNS-rebind attack lives in the gap between the check
// and the connect. There is no gap here.
func safeDial(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: dialTimeout}
	lastErr := errBlockedIP
	for _, ip := range ips {
		if !publicIP(ip.IP) {
			continue
		}
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	// Every answer was refused, or every allowed answer failed to connect.
	return nil, lastErr
}

// newClient builds the one client this package fetches with. Redirects are
// re-checked per hop and capped; the dialer above re-checks the address on
// every hop for free, because each hop opens its own connection.
func (f *Fetcher) newClient() *http.Client {
	return &http.Client{
		Timeout: fetchTimeout,
		Transport: &http.Transport{
			DialContext:           safeDial,
			TLSHandshakeTimeout:   dialTimeout,
			ResponseHeaderTimeout: fetchTimeout,
			DisableKeepAlives:     true, // one stranger's host per connection
			MaxIdleConns:          0,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errTooManyHop
			}
			return f.checkTarget(req.URL)
		},
	}
}

// get issues one guarded GET. The caller reads at most limit bytes off the
// body it gets back — nothing here trusts Content-Length.
func (f *Fetcher) get(ctx context.Context, raw string) (*http.Response, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("unfurl: parse: %w", err)
	}
	if err := f.checkTarget(u); err != nil {
		return nil, err
	}
	// gosec's taint analysis is right that this URL came from a rider, and
	// that is the whole premise of the package: the address is not trusted,
	// so it is f.client — and only ever f.client — that decides where a
	// socket may go. See guard.go's safeDial and ADR-0031. Reaching for a
	// plain http.Get here instead is the mistake this comment exists to stop.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil) //nolint:gosec // G704: guarded by safeDial's pinned, address-checked dial
	if err != nil {
		return nil, fmt.Errorf("unfurl: request: %w", err)
	}
	// Exactly these headers. Nothing that identifies the rider, nothing that
	// carries a session — the fetch is WattRoom's, not theirs.
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept-Language", "en;q=0.9")
	return f.client.Do(req) //nolint:gosec,bodyclose // G704: see above; the caller closes the body
}
