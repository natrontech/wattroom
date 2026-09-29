package notify

// The unsubscribe link every mail carries: a form on GET, the change on
// POST, so a scanner prefetching links unsubscribes nobody. Split from
// notify.go (#3358).

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func unsubParams(r *http.Request) (id, token pgtype.UUID, ok bool) {
	id, err1 := store.ParseUUID(r.URL.Query().Get("u"))
	token, err2 := store.ParseUUID(r.URL.Query().Get("t"))
	return id, token, err1 == nil && err2 == nil
}

// handleUnsubscribeForm answers the emailed link with a plain confirm page —
// the click comes from a mail client, not the SPA.
func (s *Service) handleUnsubscribeForm(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := unsubParams(r); !ok {
		s.unsubOutcome(w, http.StatusBadRequest, "That link is incomplete",
			"Use the link from the email, or switch emails off in your WattRoom settings.")
		return
	}
	// No action attribute: the form posts back to this same URL, query and
	// all — nothing request-derived is ever written into the HTML.
	httpx.WritePage(w, http.StatusOK, "Unsubscribe", httpx.PageBody(
		"Stop WattRoom session emails?",
		"You can turn them back on any time in your settings.",
		`<form method="post"><button>Unsubscribe</button></form>`))
}

// unsubOutcome is the page the click lands on: a mail client sent it, so the
// answer is a page in the app's shell, not JSON (#832).
func (s *Service) unsubOutcome(w http.ResponseWriter, status int, heading, line string) {
	httpx.WritePage(w, status, heading, httpx.PageBody(heading, line,
		httpx.PageLink(s.baseURL+"/settings/notifications", "Back to WattRoom")))
}

func (s *Service) handleUnsubscribe(w http.ResponseWriter, r *http.Request) {
	id, token, ok := unsubParams(r)
	if !ok {
		s.unsubOutcome(w, http.StatusBadRequest, "That link is incomplete",
			"Use the link from the email, or switch emails off in your WattRoom settings.")
		return
	}
	rows, err := s.store.Queries.UnsubscribePlanned(r.Context(), db.UnsubscribePlannedParams{
		ID: id, UnsubToken: token,
	})
	if err != nil {
		s.log.Error("unsubscribe failed", "err", err)
		s.unsubOutcome(w, http.StatusInternalServerError, "That did not work",
			"The unsubscribe failed on our side. Try the link again.")
		return
	}
	if rows == 0 {
		s.unsubOutcome(w, http.StatusNotFound, "That link does not match an account",
			"Emails may already be off.")
		return
	}
	s.unsubOutcome(w, http.StatusOK, "Done — no more session emails",
		"Turn them back on any time in your WattRoom settings.")
}
