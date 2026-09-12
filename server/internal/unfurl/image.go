package unfurl

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// What a picture from somebody else's host may be, and how much of it we are
// willing to hold. The two readers below differ in one thing only — the
// thumbnail proxy streams to a rider who is waiting, and Image buffers because
// its caller has to store the bytes — so the trust boundary lives here once
// rather than in each of them.

var (
	errNotFetched = errors.New("unfurl: host did not answer with the picture")
	errNotImage   = errors.New("unfurl: not one of the picture types WattRoom renders")
	errTooBig     = errors.New("unfurl: picture is over the cap")
)

// Image reads one picture from a host WattRoom does not control and hands back
// the bytes: guarded dial, capped read, and the type taken from the **bytes**
// rather than believed from the header — the same order httpx.ReadImageUpload
// puts them in, because bytes that will be served from our own origin under
// our own CSP have to be what they claim whoever sent them.
//
// Over the cap is a refusal, not a truncation. The thumbnail proxy truncates
// on purpose (half a preview beats none), but Image's caller keeps what it
// gets, and half a picture stored forever is worse than the initial the app
// draws instead.
func (f *Fetcher) Image(ctx context.Context, raw string, max int64) (data []byte, mime string, err error) {
	res, err := f.get(ctx, raw)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("%w: %d", errNotFetched, res.StatusCode)
	}
	// max+1 so a body exactly at the cap is kept and one byte over is caught;
	// nothing here trusts Content-Length.
	data, err = io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil {
		return nil, "", fmt.Errorf("unfurl: read picture: %w", err)
	}
	if int64(len(data)) > max {
		return nil, "", errTooBig
	}
	if mime = http.DetectContentType(data); !renderableImage(mime) {
		return nil, "", fmt.Errorf("%w: %s", errNotImage, mime)
	}
	return data, mime, nil
}

// renderableImage is the narrow set a picture from a stranger's host may be.
// SVG is deliberately absent: it is a document, not a picture — served from
// our own origin it can carry script, and a rider who opens the image in a tab
// is then running a stranger's markup as WattRoom. The CSP would catch it; not
// serving it at all is the answer that does not depend on a header.
func renderableImage(kind string) bool {
	switch kind {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif":
		return true
	}
	return false
}
