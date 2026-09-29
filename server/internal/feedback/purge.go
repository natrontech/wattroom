package feedback

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// RemoveReporter takes a deleted account's flag reports out of reports.jsonl
// (#2906). Each row keeps the rider's display name, their last two minutes
// and their own log lines, and WATTROOM.md's purge promises all of it goes.
// After the account's commit, like the track reaper: a file that will not
// rewrite is a log line, never a deletion that did not happen.
//
// Only rows carrying the account's id go. Rows from before #2822 hold a
// display name and nothing else, which cannot be told apart from another
// rider's, so no purge can claim them.
func (s *Service) RemoveReporter(userID string) {
	if err := s.removeReporter(userID); err != nil {
		s.log.Error("feedback reports not purged after account delete", "err", err)
	}
}

// removeReporter rewrites the file without the rider's rows: a temp file in
// the same directory, synced, then renamed over — so a crash midway leaves
// the old file whole, and the append lock keeps a report submitted meanwhile
// from landing in the file the rename is about to replace.
// ponytail: reads the whole file per delete; a delete is rare and the file is
// reports, not rides — a retention sweep bounds it if it ever matters.
func (s *Service) removeReporter(userID string) error {
	if userID == "" {
		return nil // "" is every row that predates the id, never one rider's
	}
	s.fileMu.Lock()
	defer s.fileMu.Unlock()
	path := filepath.Join(s.dir, "reports.jsonl")
	in, err := os.Open(path) //nolint:gosec // our own file under the configured dir
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.CreateTemp(s.dir, "reports-*.jsonl")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(out.Name()) }() // gone already once renamed
	removed, err := copyWithout(out, in, userID)
	if err == nil && removed > 0 {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil || removed == 0 {
		return err
	}
	return os.Rename(out.Name(), path)
}

// copyWithout copies every line whose reporterId is not userID and counts the
// ones it left out. A line that does not parse is kept: it is nobody's to drop.
func copyWithout(dst io.Writer, src io.Reader, userID string) (int, error) {
	r := bufio.NewReader(src)
	removed := 0
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			var row struct {
				ReporterID string `json:"reporterId"`
			}
			if json.Unmarshal(line, &row) == nil && row.ReporterID == userID {
				removed++
			} else if _, werr := dst.Write(line); werr != nil {
				return removed, werr
			}
		}
		if errors.Is(err, io.EOF) {
			return removed, nil
		}
		if err != nil {
			return removed, err
		}
	}
}
