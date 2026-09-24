package hub

import "testing"

// The lobby ping names one channel only when one channel is all that changed
// (#2435); anything else coalesces to the plain re-fetch-everything ping,
// which costs a client a wider re-fetch and never a missed one.
func TestTheLobbyPingNamesAChannelOnlyWhenItIsTheWholeStory(t *testing.T) {
	for _, c := range []struct {
		name   string
		queued []string
		want   string
	}{
		{"nothing but a presence change", []string{""}, `{}`},
		{"one channel", []string{"c1"}, `{"channel":"c1"}`},
		{"the same channel twice", []string{"c1", "c1"}, `{"channel":"c1"}`},
		{"two channels", []string{"c1", "c2"}, `{}`},
		{"a channel, then presence", []string{"c1", ""}, `{}`},
		{"presence, then a channel", []string{"", "c1"}, `{}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			client := &lobbyClient{ping: make(chan struct{}, 1)}
			for _, channel := range c.queued {
				client.queue(channel)
			}
			if got := string(client.take()); got != c.want {
				t.Errorf("ping = %s, want %s", got, c.want)
			}
			// Taken is cleared: the next change starts afresh.
			client.queue("c3")
			if got := string(client.take()); got != `{"channel":"c3"}` {
				t.Errorf("after a take, ping = %s", got)
			}
		})
	}
}

// A read pings the reader's own devices and nobody else's (#2711): a rider
// who heard someone else's read would be holding a read receipt (ADR-0012).
func TestAReadPingsOnlyTheReadersOwnSockets(t *testing.T) {
	phone := &lobbyClient{ping: make(chan struct{}, 1)}
	desktop := &lobbyClient{ping: make(chan struct{}, 1)}
	friend := &lobbyClient{ping: make(chan struct{}, 1)}
	h := &Hub{lobby: map[*lobbyClient]string{phone: "me", desktop: "me", friend: "them"}}
	h.ReadChanged("me")
	for name, c := range map[string]struct {
		client *lobbyClient
		pinged bool
	}{"phone": {phone, true}, "desktop": {desktop, true}, "friend": {friend, false}} {
		if got := len(c.client.ping) == 1; got != c.pinged {
			t.Errorf("%s pinged = %v, want %v", name, got, c.pinged)
		}
	}
}
