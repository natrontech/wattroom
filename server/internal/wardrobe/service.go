package wardrobe

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/wallet"
)

// undoWindow is how long a purchase can be undone, while the item is still
// unworn (docs/SPEC.md "Wardrobe" — defaults, tune in alpha).
const undoWindow = 10 * time.Minute

// Users is who is asking: the session source only — the garage is private.
type Users interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

type Service struct {
	store *store.Store
	users Users
	log   *slog.Logger
}

func New(st *store.Store, users Users, log *slog.Logger) *Service {
	return &Service{store: st, users: users, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/me/wardrobe/{item}", s.handleBuy)
	mux.HandleFunc("DELETE /api/me/wardrobe/{item}", s.handleUndo)
	mux.HandleFunc("PUT /api/me/outfit", s.handleOutfit)
}

// refusal is an answer the rider reads, carried out of the locked
// transaction as the error that rolls it back.
type refusal struct {
	status        int
	code, message string
}

func (r refusal) Error() string { return r.message }

// notForSale is why an item is never bought, in the words the shop uses.
func notForSale(it Item) string {
	switch it.Kind() {
	case "earn":
		return "Earned, not sold."
	case "with":
		return "It comes with its frame."
	case "crew":
		return "Your crew designs its kit, and its members wear it free."
	}
	return "Free to pick — there is nothing to buy."
}

// handleBuy spends Batzen on one item (#3154, ADR-0069). The balance is read
// and the purchase written under the rider's row lock, so two purchases at
// once can never take a balance below zero.
func (s *Service) handleBuy(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to shop.")
	if !ok {
		return
	}
	it, ok := Lookup(r.PathValue("item"))
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "There is no such item.")
		return
	}
	if it.Kind() != "buy" {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", notForSale(it))
		return
	}
	var balance int64
	err := s.store.WithUserLocked(r.Context(), user.ID, func(q *db.Queries) error {
		if _, err := q.GetWardrobeItem(r.Context(), db.GetWardrobeItemParams{UserID: user.ID, ItemID: it.ID}); err == nil {
			return refusal{http.StatusConflict, "conflict", "It is already yours."}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		held, err := wallet.Balance(r.Context(), q, user.ID)
		if err != nil {
			return err
		}
		if held < int64(it.Price()) {
			return refusal{http.StatusConflict, "conflict", s.short(r.Context(), q, user.ID, int64(it.Price())-held)}
		}
		acquired, err := q.AddWardrobeItem(r.Context(), db.AddWardrobeItemParams{UserID: user.ID, ItemID: it.ID, Source: "bought"})
		if err != nil {
			return err
		}
		if err := wallet.Spend(r.Context(), q, user.ID, purchaseRef(it.ID, acquired), it.Price()); err != nil {
			return err
		}
		balance = held - int64(it.Price())
		return nil
	})
	if s.refused(w, err, "wardrobe purchase failed", "The item could not be bought. Try again.") {
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"item": it.ID, "balance": balance})
}

// short is the refusal a rider reads when a price is out of reach, in rides
// rather than Batzen alone: "You need 38 more — about one ride like your last
// one".
func (s *Service) short(ctx context.Context, q *db.Queries, user pgtype.UUID, need int64) string {
	last, err := q.LastRideBatzen(ctx, user)
	if err != nil || last <= 0 {
		return fmt.Sprintf("You need %d more Batzen — every minute ridden at your FTP earns one.", need)
	}
	rides := (need + int64(last) - 1) / int64(last)
	if rides == 1 {
		return fmt.Sprintf("You need %d more — about one ride like your last one.", need)
	}
	return fmt.Sprintf("You need %d more — about %d rides like your last one.", need, rides)
}

// handleUndo gives a purchase back (docs/SPEC.md "Wardrobe"): within the
// undo window, and only while the item has not been worn on a ride. The
// Batzen come back under the purchase's own ref, and the item comes off the
// outfit if it was on it.
func (s *Service) handleUndo(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to shop.")
	if !ok {
		return
	}
	it, ok := Lookup(r.PathValue("item"))
	if !ok {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "There is no such item.")
		return
	}
	var balance int64
	err := s.store.WithUserLocked(r.Context(), user.ID, func(q *db.Queries) error {
		owned, err := q.GetWardrobeItem(r.Context(), db.GetWardrobeItemParams{UserID: user.ID, ItemID: it.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return refusal{http.StatusNotFound, "not_found", "That item is not yours."}
		}
		if err != nil {
			return err
		}
		switch {
		case owned.Source != "bought":
			return refusal{http.StatusBadRequest, "validation_error", "Only a purchase can be undone."}
		case owned.FirstWornAt.Valid:
			return refusal{http.StatusConflict, "conflict", "It has been worn on a ride, so it is yours to keep."}
		case time.Since(owned.AcquiredAt.Time) > undoWindow:
			return refusal{http.StatusConflict, "conflict", "A purchase can be undone for 10 minutes, and these have passed."}
		}
		if n, err := q.RemoveUnwornWardrobeItem(r.Context(), db.RemoveUnwornWardrobeItemParams{UserID: user.ID, ItemID: it.ID}); err != nil || n == 0 {
			return errors.Join(err, errors.New("wardrobe: the item was not removed"))
		}
		if err := q.TakeOffItem(r.Context(), db.TakeOffItemParams{UserID: user.ID, Slot: it.Slot, ItemID: it.ID}); err != nil {
			return err
		}
		if err := wallet.Refund(r.Context(), q, user.ID, purchaseRef(it.ID, owned.AcquiredAt), it.Price()); err != nil {
			return err
		}
		balance, err = wallet.Balance(r.Context(), q, user.ID)
		return err
	})
	if s.refused(w, err, "wardrobe undo failed", "The purchase could not be undone. Try again.") {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"item": it.ID, "balance": balance})
}

// purchaseRef names one purchase of one item: bought, undone and bought
// again are two purchases, each with its own ledger row.
func purchaseRef(item string, acquired pgtype.Timestamptz) string {
	return item + "@" + strconv.FormatInt(acquired.Time.UnixMicro(), 10)
}

// refused writes a refusal or a failure, and reports whether it wrote either.
func (s *Service) refused(w http.ResponseWriter, err error, what, message string) bool {
	var no refusal
	switch {
	case err == nil:
		return false
	case errors.As(err, &no):
		httpx.WriteError(w, no.status, no.code, no.message)
	default:
		httpx.Fail(w, s.log, what, err, message)
	}
	return true
}
