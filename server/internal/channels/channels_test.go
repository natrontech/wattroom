package channels

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// One crew: alice owns it, dave is an admin, bob a member, erin is banned
// from it and carol is in none of it.
type harness struct {
	mux   *http.ServeMux
	store *store.Store
	users *testx.Users
	crew  string
}

func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)
	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "carol", "dave", "erin"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID) })
	}
	crew, err := st.Queries.CreateCrew(t.Context(), db.CreateCrewParams{
		Name: "Thursday Crew", OwnerID: users.ByToken["alice"].ID, Code: testx.CrewCode(),
	})
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	// Before the users: crews.owner_id is ON DELETE RESTRICT (ADR-0038).
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	for who, role := range map[string]string{"dave": "admin", "bob": "member", "erin": "banned"} {
		if err := st.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
			CrewID: crew.ID, UserID: users.ByToken[who].ID, Role: role,
		}); err != nil {
			t.Fatalf("crew role %s: %v", who, err)
		}
	}
	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return &harness{mux: mux, store: st, users: users, crew: store.UUIDString(crew.ID)}
}

func (h *harness) call(t *testing.T, user, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, reader)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

// create makes a channel through the API as the crew's owner and returns its id.
func (h *harness) create(t *testing.T, kind, name string, private bool) string {
	t.Helper()
	status, body := h.call(t, "alice", http.MethodPost, "/api/crews/"+h.crew+"/channels",
		fmt.Sprintf(`{"kind":%q,"name":%q,"private":%v}`, kind, name, private))
	if status != http.StatusCreated {
		t.Fatalf("create %s channel: %d %v", kind, status, body)
	}
	id, ok := body["id"].(string)
	if !ok {
		t.Fatalf("created %s channel has no id: %v", kind, body)
	}
	return id
}

// listed is what `who` sees in the crew's channel list, by name.
func (h *harness) listed(t *testing.T, who string) map[string]map[string]any {
	t.Helper()
	status, body := h.call(t, who, http.MethodGet, "/api/crews/"+h.crew+"/channels", "")
	if status != http.StatusOK {
		t.Fatalf("%s lists channels: %d %v", who, status, body)
	}
	rows, ok := body["channels"].([]any)
	if !ok {
		t.Fatalf("%s's channel list is not a list: %v", who, body)
	}
	out := map[string]map[string]any{}
	for _, c := range rows {
		row, ok := c.(map[string]any)
		if !ok {
			t.Fatalf("a channel row is not an object: %v", c)
		}
		name, _ := row["name"].(string)
		out[name] = row
	}
	return out
}

func TestMayEnter(t *testing.T) {
	for _, c := range []struct {
		role           string
		private, named bool
		want           bool
	}{
		{"owner", false, false, true},
		{"owner", true, false, true},
		{"admin", true, false, true},
		{"member", false, false, true},
		{"member", true, true, true},
		{"member", true, false, false},
		{"banned", false, false, false},
		{"banned", true, true, false},
		{"", false, false, false},
		{"", true, true, false},
	} {
		if got := mayEnter(c.role, c.private, c.named); got != c.want {
			t.Errorf("mayEnter(%q, private=%v, named=%v) = %v, want %v", c.role, c.private, c.named, got, c.want)
		}
	}
}

func TestListShowsOnlyWhatTheCallerMayEnter(t *testing.T) {
	h := setup(t)
	h.create(t, "text", "general", false)
	h.create(t, "voice", "Pain Cave", false)
	secret := h.create(t, "text", "coaches", true)
	if status, _ := h.call(t, "alice", http.MethodPut,
		"/api/channels/"+secret+"/members/"+store.UUIDString(h.users.ByToken["dave"].ID), ""); status != http.StatusNoContent {
		t.Fatalf("name dave: %d", status)
	}

	bob := h.listed(t, "bob")
	if _, ok := bob["coaches"]; ok {
		t.Error("a member not named into a private channel can see it listed")
	}
	if len(bob) != 2 {
		t.Errorf("bob sees %d channels, want the two open ones", len(bob))
	}
	if voice := bob["Pain Cave"]; voice["kind"] != "voice" || voice["autoplay"] == nil {
		t.Errorf("the voice channel reads %v; want kind voice with its autoplay", voice)
	}
	if text := bob["general"]; text["autoplay"] != nil || text["soundPack"] != nil {
		t.Errorf("a text channel carries deck settings: %v", text)
	}
	if admin := h.listed(t, "dave"); admin["coaches"] == nil {
		t.Error("an admin cannot see a private channel")
	}

	if status, _ := h.call(t, "carol", http.MethodGet, "/api/crews/"+h.crew+"/channels", ""); status != http.StatusNotFound {
		t.Errorf("someone outside the crew listing its channels: %d, want 404", status)
	}
	if status, _ := h.call(t, "erin", http.MethodGet, "/api/crews/"+h.crew+"/channels", ""); status != http.StatusNotFound {
		t.Errorf("a banned rider listing the crew's channels: %d, want 404", status)
	}
	if status, _ := h.call(t, "", http.MethodGet, "/api/crews/"+h.crew+"/channels", ""); status != http.StatusUnauthorized {
		t.Errorf("no session: %d, want 401", status)
	}
}

func TestCreateChannel(t *testing.T) {
	h := setup(t)
	path := "/api/crews/" + h.crew + "/channels"

	status, body := h.call(t, "dave", http.MethodPost, path, `{"kind":"voice","name":"  Pain Cave  "}`)
	if status != http.StatusCreated || body["name"] != "Pain Cave" || body["position"] != float64(0) {
		t.Fatalf("an admin creates a voice channel: %d %v", status, body)
	}
	if _, body = h.call(t, "dave", http.MethodPost, path, `{"kind":"voice","name":"Lounge"}`); body["position"] != float64(1) {
		t.Errorf("a second voice channel lands at %v, want the end of the list (1)", body["position"])
	}

	for what, c := range map[string]struct {
		who, body string
		want      int
		field     string
	}{
		"a member":         {"bob", `{"kind":"text","name":"general"}`, http.StatusForbidden, ""},
		"an outsider":      {"carol", `{"kind":"text","name":"general"}`, http.StatusNotFound, ""},
		"no session":       {"", `{"kind":"text","name":"general"}`, http.StatusUnauthorized, ""},
		"a third kind":     {"dave", `{"kind":"video","name":"general"}`, http.StatusBadRequest, "kind"},
		"an empty name":    {"dave", `{"kind":"text","name":"   "}`, http.StatusBadRequest, "name"},
		"a name too long":  {"dave", fmt.Sprintf(`{"kind":"text","name":%q}`, strings.Repeat("é", protocol.MaxChannelNameChars+1)), http.StatusBadRequest, "name"},
		"two lines":        {"dave", `{"kind":"text","name":"a\nb"}`, http.StatusBadRequest, "name"},
		"an unknown field": {"dave", `{"kind":"text","name":"general","owner":"me"}`, http.StatusBadRequest, ""},
	} {
		status, body := h.call(t, c.who, http.MethodPost, path, c.body)
		if status != c.want {
			t.Errorf("%s: %d %v, want %d", what, status, body, c.want)
		}
		if c.field != "" && body["field"] != c.field {
			t.Errorf("%s: refusal names field %v, want %q", what, body["field"], c.field)
		}
	}
}

func TestCreateRefusesPastTheCap(t *testing.T) {
	h := setup(t)
	for i := range protocol.MaxCrewVoiceChannels {
		h.create(t, "voice", fmt.Sprintf("voice %d", i), false)
	}
	status, body := h.call(t, "alice", http.MethodPost, "/api/crews/"+h.crew+"/channels", `{"kind":"voice","name":"one more"}`)
	if status != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("voice channel past the cap: %d %v, want 429 rate_limited", status, body)
	}
	if msg, _ := body["message"].(string); !strings.Contains(msg, fmt.Sprint(protocol.MaxCrewVoiceChannels)) {
		t.Errorf("the refusal %q does not name the number", msg)
	}
	// The cap is per kind: a full voice list leaves room for text.
	h.create(t, "text", "general", false)
}

func TestUpdateChannel(t *testing.T) {
	h := setup(t)
	first := h.create(t, "voice", "Lounge", false)
	second := h.create(t, "voice", "Pain Cave", false)
	text := h.create(t, "text", "general", false)
	secret := h.create(t, "text", "coaches", true)

	status, body := h.call(t, "dave", http.MethodPatch, "/api/channels/"+second,
		`{"name":"Sufferfest","position":0,"soundPack":"silent","autoplay":{"enabled":true,"order":"smart"}}`)
	if status != http.StatusOK || body["name"] != "Sufferfest" || body["soundPack"] != "silent" {
		t.Fatalf("an admin renames and moves a voice channel: %d %v", status, body)
	}
	if auto, _ := body["autoplay"].(map[string]any); auto["enabled"] != true || auto["order"] != "smart" {
		t.Errorf("autoplay came back %v", auto)
	}
	positions := map[string]float64{}
	for name, row := range h.listed(t, "alice") {
		positions[name], _ = row["position"].(float64)
	}
	if positions["Sufferfest"] != 0 || positions["Lounge"] != 1 {
		t.Errorf("after the move: %v, want Sufferfest 0 and Lounge 1", positions)
	}
	if status, _ := h.call(t, "dave", http.MethodPatch, "/api/channels/"+first, `{"position":99}`); status != http.StatusOK {
		t.Errorf("a move past the end is clamped, not refused: %d", status)
	}

	other, err := h.store.Queries.CreatePlaylist(t.Context(), db.CreatePlaylistParams{
		UserID: h.users.ByToken["dave"].ID, Name: "Dave's own",
	})
	if err != nil {
		t.Fatalf("playlist: %v", err)
	}
	for what, c := range map[string]struct {
		who, id, body string
		want          int
		field         string
	}{
		"a member":                       {"bob", first, `{"name":"x"}`, http.StatusForbidden, ""},
		"a member on a hidden channel":   {"bob", secret, `{"name":"x"}`, http.StatusNotFound, ""},
		"an outsider":                    {"carol", first, `{"name":"x"}`, http.StatusNotFound, ""},
		"no session":                     {"", first, `{"name":"x"}`, http.StatusUnauthorized, ""},
		"no such channel":                {"dave", "00000000-0000-0000-0000-000000000000", `{"name":"x"}`, http.StatusNotFound, ""},
		"a name too long":                {"dave", first, fmt.Sprintf(`{"name":%q}`, strings.Repeat("x", protocol.MaxChannelNameChars+1)), http.StatusBadRequest, "name"},
		"a negative position":            {"dave", first, `{"position":-1}`, http.StatusBadRequest, "position"},
		"a sound pack on a text channel": {"dave", text, `{"soundPack":"silent"}`, http.StatusBadRequest, "kind"},
		"an unknown sound pack":          {"dave", first, `{"soundPack":"loud"}`, http.StatusBadRequest, "soundPack"},
		"an unknown autoplay order":      {"dave", first, `{"autoplay":{"order":"random"}}`, http.StatusBadRequest, "autoplay.order"},
		"a rider's own playlist":         {"dave", first, fmt.Sprintf(`{"autoplay":{"playlistId":%q}}`, store.UUIDString(other.ID)), http.StatusBadRequest, "autoplay.playlistId"},
	} {
		status, body := h.call(t, c.who, http.MethodPatch, "/api/channels/"+c.id, c.body)
		if status != c.want {
			t.Errorf("%s: %d %v, want %d", what, status, body, c.want)
		}
		if c.field != "" && body["field"] != c.field {
			t.Errorf("%s: refusal names field %v, want %q", what, body["field"], c.field)
		}
	}
}

func TestPrivateChannelMembers(t *testing.T) {
	h := setup(t)
	secret := h.create(t, "voice", "Coaches' corner", true)
	open := h.create(t, "text", "general", false)
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	member := "/api/channels/" + secret + "/members/" + bob

	if status, _ := h.call(t, "bob", http.MethodPatch, "/api/channels/"+secret, `{"name":"x"}`); status != http.StatusNotFound {
		t.Fatalf("before being named, bob reaches the private channel: %d", status)
	}
	if status, _ := h.call(t, "dave", http.MethodPut, member, ""); status != http.StatusNoContent {
		t.Fatalf("an admin names bob in: %d", status)
	}
	if status, _ := h.call(t, "dave", http.MethodPut, member, ""); status != http.StatusNoContent {
		t.Fatalf("naming bob twice: %d, want the same 204", status)
	}
	listed := h.listed(t, "bob")
	if listed["Coaches' corner"] == nil {
		t.Fatal("named into the private channel, bob still cannot see it")
	}
	if members, _ := listed["Coaches' corner"]["members"].([]any); len(members) != 1 {
		t.Errorf("the channel names %d members, want bob alone", len(members))
	}
	if status, _ := h.call(t, "bob", http.MethodPut, "/api/channels/"+secret+"/members/"+store.UUIDString(h.users.ByToken["dave"].ID), ""); status != http.StatusForbidden {
		t.Errorf("a named member naming someone else: %d, want 403", status)
	}

	for what, c := range map[string]struct {
		path string
		want int
	}{
		"someone outside the crew":  {"/api/channels/" + secret + "/members/" + store.UUIDString(h.users.ByToken["carol"].ID), http.StatusNotFound},
		"a rider the crew banned":   {"/api/channels/" + secret + "/members/" + store.UUIDString(h.users.ByToken["erin"].ID), http.StatusNotFound},
		"a member into an open one": {"/api/channels/" + open + "/members/" + bob, http.StatusBadRequest},
	} {
		if status, body := h.call(t, "dave", http.MethodPut, c.path, ""); status != c.want {
			t.Errorf("naming %s: %d %v, want %d", what, status, body, c.want)
		}
	}

	if status, _ := h.call(t, "dave", http.MethodDelete, member, ""); status != http.StatusNoContent {
		t.Fatalf("an admin takes bob out: %d", status)
	}
	if h.listed(t, "bob")["Coaches' corner"] != nil {
		t.Error("taken out, bob still sees the private channel")
	}
}

func TestDeleteChannelTakesItsChat(t *testing.T) {
	h := setup(t)
	id := h.create(t, "text", "general", false)
	channelID, _ := store.ParseUUID(id)
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into chat_messages (channel_id, user_id, text) values ($1, $2, 'hello')`,
		channelID, h.users.ByToken["bob"].ID); err != nil {
		t.Fatalf("chat: %v", err)
	}

	if status, _ := h.call(t, "bob", http.MethodDelete, "/api/channels/"+id, ""); status != http.StatusForbidden {
		t.Errorf("a member deleting a channel: %d, want 403", status)
	}
	if status, _ := h.call(t, "carol", http.MethodDelete, "/api/channels/"+id, ""); status != http.StatusNotFound {
		t.Errorf("an outsider deleting a channel: %d, want 404", status)
	}
	if status, _ := h.call(t, "dave", http.MethodDelete, "/api/channels/"+id, ""); status != http.StatusNoContent {
		t.Fatalf("an admin deletes a channel: %d", status)
	}
	var left int
	if err := h.store.Pool.QueryRow(t.Context(),
		`select count(*) from chat_messages where channel_id = $1`, channelID).Scan(&left); err != nil {
		t.Fatalf("count: %v", err)
	}
	if left != 0 {
		t.Errorf("%d chat line(s) outlived their channel", left)
	}
	if status, _ := h.call(t, "dave", http.MethodDelete, "/api/channels/"+id, ""); status != http.StatusNotFound {
		t.Errorf("deleting it again: %d, want 404", status)
	}
}
