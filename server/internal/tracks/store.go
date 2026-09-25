package tracks

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
)

// Audio lives on the VM disk (ADR-0002, ADR-0015), addressed by the SHA-256 of
// its bytes: two riders uploading the same song store one file. Postgres keeps
// the metadata and nothing else, which is the durable-data seam.

var shaPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// pathFor fans out on the first two hex characters. One flat directory of tens
// of thousands of files is slow to list on every filesystem that matters, and
// this is the same shape git uses for the same reason.
//
// The sha is checked rather than trusted: it reaches here from a database row,
// but a path built from an unvalidated string is a traversal waiting for the
// day something else writes that column.
func (s *Service) pathFor(sha string) (string, error) {
	if !shaPattern.MatchString(sha) {
		return "", errors.New("tracks: not a content address")
	}
	return filepath.Join(s.dir, sha[:2], sha+".mp3"), nil
}

// receive streams an upload into a file beside the store, hashing it on the
// way (#2862): what a request holds is one copy buffer, not the whole track —
// six parallel 48 MB bodies used to be six 48 MB slices. The file is the
// caller's to close and remove; place moves it to its address.
func (s *Service) receive(body io.Reader) (f *os.File, sha string, size int64, err error) {
	if err := os.MkdirAll(s.dir, 0o750); err != nil {
		return nil, "", 0, err
	}
	// CreateTemp makes it 0600: the server is the only reader, and the HTTP
	// handler is the access control.
	f, err = os.CreateTemp(s.dir, ".upload-*")
	if err != nil {
		return nil, "", 0, err
	}
	sum := sha256.New()
	if size, err = io.Copy(f, io.TeeReader(body, sum)); err != nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		return nil, "", 0, err
	}
	return f, hex.EncodeToString(sum.Sum(nil)), size, nil
}

// place moves a received file to its content address unless that content is
// already stored. Returns whether it moved it, so a caller can tell a genuine
// upload from a deduplicated one. The file was written beside the store and
// is renamed whole: a crash mid-upload must not leave a truncated file sitting
// at the address of the whole song, where nothing would ever look at it twice.
func (s *Service) place(sha string, f *os.File) (moved bool, err error) {
	path, err := s.pathFor(sha)
	if err != nil {
		return false, err
	}
	if _, err := os.Stat(path); err == nil {
		return false, nil // same content, already here
	} else if !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return false, err
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return false, err
	}
	return true, nil
}

// open hands back the stored audio for http.ServeContent to range over.
func (s *Service) open(sha string) (*os.File, fs.FileInfo, error) {
	path, err := s.pathFor(sha)
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(path) //nolint:gosec // path built from a checked content address
	if err != nil {
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, nil, err
	}
	return f, info, nil
}

// remove deletes the stored audio. A file that is already gone is not an error:
// the row is the thing that was authoritative and it has just been deleted.
func (s *Service) remove(sha string) error {
	path, err := s.pathFor(sha)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}
