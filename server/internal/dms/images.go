// Pictures in a conversation (#208 amended): the upload, the read and the
// prune that keeps a thread to its bound. Split from dms.go for size.
package dms

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// handleImageUpload stores one pasted image for a thread: raw bytes in, blob
// id out, which the sender then puts on a message. The insert carries the
// friendship gate, so a stranger cannot park bytes on someone's row.
func (s *Service) handleImageUpload(w http.ResponseWriter, r *http.Request) {
	me, peer, ok := s.peer(w, r)
	if !ok {
		return
	}
	data, mime, ok := httpx.ReadImageUpload(w, r)
	if !ok {
		return
	}
	id, err := s.store.Queries.SaveDmImage(r.Context(), db.SaveDmImageParams{
		SenderID: me.ID, RecipientID: peer, Mime: mime, Bytes: data,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Zero rows = the friendship gate refused, same as SendDm.
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only message accepted friends.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "dm image save failed", err, "The picture could not be sent. Try again.", "user", store.UUIDString(me.ID))
		return
	}
	s.pruneImages(r, me.ID, peer)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"id": store.UUIDString(id)})
}

// handleImage serves a stored blob to the two people it belongs to. Deliberately
// no friendship re-check: unfriending ends the conversation, it does not black
// out pictures already delivered.
func (s *Service) handleImage(w http.ResponseWriter, r *http.Request) {
	me, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	img, err := s.store.Queries.GetDmImage(r.Context(), db.GetDmImageParams{
		ImageID: id, ViewerID: me.ID,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "No such image.")
		return
	}
	httpx.ServeImmutableImage(w, img.Mime, img.Bytes)
}

// pruneImages sweeps a pair's orphaned blobs. Called from both writes that can
// grow a thread — a sent message and an upload — so a client that uploads
// without ever sending still triggers the bound.
func (s *Service) pruneImages(r *http.Request, me, peer pgtype.UUID) {
	if err := s.store.Queries.PruneDmImages(r.Context(), db.PruneDmImagesParams{
		Column1: me, Column2: peer,
	}); err != nil {
		s.log.Warn("prune dm images", "err", err)
	}
}
