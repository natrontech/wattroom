package notify

// A crew's session mail: planned, moved and cancelled sessions to the
// riders who asked for them (ADR-0030). Split from notify.go (#3358).

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// What a session mail is about. The three share an audience, an opt-in and a
// shape; only the words differ, which is why they share a path (ADR-0030 puts
// all of them behind the one notify_planned switch).
type sessionChange int

const (
	sessionPlanned sessionChange = iota
	sessionMoved
	sessionCancelled
	sessionReminder
)

// sessionNote is what one session mail is about: which crew and channel,
// which workout, when, who caused it, and which of the four changes it is.
//
// A struct rather than a seventh positional parameter (#1011). The session
// id joined the list for the reminder alone, and it would have sat next to
// the actor's id — two pgtype.UUIDs in a row, at two call sites, with the
// wrong order compiling and mailing the wrong people.
type sessionNote struct {
	// The crew the plan is on, and the voice channel it names — invalid
	// while it names none (#2440).
	crew, channel pgtype.UUID
	workout       string
	startsAt      time.Time
	// Who caused it, and therefore already knows: they are not mailed. The
	// reminder is caused by the clock, so it passes noActor, which excludes
	// nobody.
	actor pgtype.UUID
	// The session itself, set by the reminder alone — the one mail whose
	// audience depends on what riders answered (#1011). Left invalid (NULL)
	// by the other three, where a decline excludes nobody: a plan has no
	// answers yet, a move clears them, and a cancellation is news whatever
	// anyone said.
	session pgtype.UUID
	change  sessionChange
}

// SessionPlanned emails every opted-in member except the planner. Fire and
// forget: the handler must not wait on a mail provider. The goroutine exits
// when the member list is sent or the one-minute context runs out.
func (s *Service) SessionPlanned(crew, channel pgtype.UUID, workoutName string, startsAt time.Time, planner pgtype.UUID) {
	s.sessionAsync(crew, channel, workoutName, startsAt, planner, sessionPlanned)
}

// SessionRescheduled is SessionPlanned for a plan that moved (#258): same
// audience, subject and body say so.
func (s *Service) SessionRescheduled(crew, channel pgtype.UUID, workoutName string, startsAt time.Time, planner pgtype.UUID) {
	s.sessionAsync(crew, channel, workoutName, startsAt, planner, sessionMoved)
}

// SessionCancelled is the mail the other two owed the crew (#839): riders told
// to turn up at seven were never told the plan was gone. startsAt is when the
// session would have been.
func (s *Service) SessionCancelled(crew, channel pgtype.UUID, workoutName string, startsAt time.Time, actor pgtype.UUID) {
	s.sessionAsync(crew, channel, workoutName, startsAt, actor, sessionCancelled)
}

func (s *Service) sessionAsync(crew, channel pgtype.UUID, workoutName string, startsAt time.Time, planner pgtype.UUID, change sessionChange) {
	if !s.allowSessionMail(crew) {
		return
	}
	note := sessionNote{
		crew: crew, channel: channel, workout: workoutName, startsAt: startsAt,
		actor: planner, change: change,
	}
	// Who it reaches is read before the caller moves on (#2610): deleting a
	// private channel cancels its plans and then the channel, and a lookup
	// run after that finds nobody the channel admits.
	lookup, cancelLookup := context.WithTimeout(context.Background(), 10*time.Second)
	audience, ok := s.sessionAudience(lookup, note)
	cancelLookup()
	if !ok {
		return
	}
	// Guarded (#651): a mail-provider panic must not cost a ride. The outer
	// ceiling is generous because every target has its own below (#1641).
	safego.Go(s.log, "session mail "+store.UUIDString(crew), func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		s.sessionSend(ctx, note, audience)
	})
}

// allowSessionMail is the per-crew ceiling (#1639): past it a plan, a move or
// a cancellation still lands on the crew's schedule and the channel's
// timeline, and simply mails nobody until the window turns — logged, never a
// failed request.
func (s *Service) allowSessionMail(crew pgtype.UUID) bool {
	if s.sessions == nil || s.sessions.Spend(crew) {
		return true
	}
	s.log.Warn("session mail ceiling reached", "crew", store.UUIDString(crew))
	return false
}

// targetBudget bounds one rider's mail — the mailer's own per-request
// timeout with headroom — so a slow provider costs one member their mail,
// never every member after them (#1641).
const targetBudget = 20 * time.Second

// oneLine is rider-supplied text as a subject or a text-part line may carry
// it (#1640): control characters collapse to a space. The HTML part goes
// through html/template; the subject becomes a header and the text part is
// rendered as written, and a room name with a newline in it used to write
// its own extra lines under the operator's signature.
func oneLine(text string) string {
	var out strings.Builder
	spaced := false
	for _, r := range text {
		if unicode.IsControl(r) {
			if !spaced {
				out.WriteRune(' ')
				spaced = true
			}
			continue
		}
		out.WriteRune(r)
		spaced = false
	}
	return strings.TrimSpace(out.String())
}

func (s *Service) sessionMail(ctx context.Context, note sessionNote) {
	if audience, ok := s.sessionAudience(ctx, note); ok {
		s.sessionSend(ctx, note, audience)
	}
}

// sessionAudience is what a session mail names and whom it reaches.
type sessionAudience struct {
	where   db.GetPlanPlaceRow
	targets []db.ListCrewNotifyTargetsRow
}

func (s *Service) sessionAudience(ctx context.Context, note sessionNote) (sessionAudience, bool) {
	crewID := store.UUIDString(note.crew)
	where, err := s.store.Queries.GetPlanPlace(ctx, db.GetPlanPlaceParams{CrewID: note.crew, ChannelID: note.channel})
	if err != nil {
		s.log.Error("session mail place lookup failed", "err", err, "crew", crewID)
		return sessionAudience{}, false
	}
	targets, err := s.store.Queries.ListCrewNotifyTargets(ctx, db.ListCrewNotifyTargetsParams{
		CrewID: note.crew, ChannelID: note.channel, Actor: note.actor, SessionID: note.session,
	})
	if err != nil {
		s.log.Error("notify targets query failed", "err", err, "crew", crewID)
		return sessionAudience{}, false
	}
	return sessionAudience{where: where, targets: targets}, true
}

func (s *Service) sessionSend(ctx context.Context, note sessionNote, audience sessionAudience) {
	startsAt, change := note.startsAt, note.change
	crewID := store.UUIDString(note.crew)
	where, targets := audience.where, audience.targets
	// What the mail calls the place (#2440): "Thursday Crew · Pain Cave", or
	// the crew alone for a plan that names no channel yet. The link goes
	// where the rider would ride it — the channel, or the crew's calendar.
	place := oneLine(where.CrewName)
	link := s.baseURL + "/crew/" + crewID + "/schedule"
	action := "Open the crew's schedule"
	if note.channel.Valid && where.ChannelName != "" {
		place += " · " + oneLine(where.ChannelName)
		link = s.baseURL + "/crew/" + crewID + "/v/" + store.UUIDString(note.channel)
		action = "Open the channel"
	}
	workoutName := oneLine(note.workout)
	// Everything below that names a time is now per rider (#858), so it waits
	// for the loop: only the words that are the same for the whole crew are
	// settled here.
	prefix := ""
	verb := "has a planned session"
	// The heading stands on its own, so it cannot end on the dangling "to"
	// that the sentence in the text part needs.
	heading := place + " has a planned session"
	// Where the last line of the text part points. A cancellation has nothing
	// to ride, but the crew is still where anything else planned lives.
	closing := "Ride it here"
	switch change {
	case sessionPlanned:
	case sessionReminder:
		// Deliberately relative, and so the one session mail that needs no
		// zone at all. The gap is measured, not assumed (#1903): a plan made
		// forty minutes ahead, or one moved inside the hour, is claimed the
		// same minute, and "in an hour" was a lie four minutes before a start.
		verb = "rides " + inWords(time.Until(startsAt))
		heading = place + " " + verb
	case sessionMoved:
		prefix = "Moved: "
		verb = "moved a planned session to"
		heading = place + " moved a planned session"
	case sessionCancelled:
		prefix = "Cancelled: "
		verb = "cancelled a planned session"
		heading = place + " cancelled a planned session"
		closing = "Anything else planned is here"
		// The schedule, not the channel: that is where anything else planned
		// is, and a channel deleted with its plans is no page at all (#2610).
		link = s.baseURL + "/crew/" + crewID + "/schedule"
		action = "Open the crew's schedule"
	}
	for _, t := range targets {
		// The rider's own clock, or the server's when no browser of theirs has
		// reported one yet.
		when := localTime(startsAt, t.Timezone)
		subject := fmt.Sprintf("%s%s rides %s — %s", prefix, place, workoutName, when)
		detail := when
		if change == sessionReminder {
			gap := inWords(time.Until(startsAt))
			subject = fmt.Sprintf("%s rides %s %s", place, workoutName, gap)
			detail = gap
		}
		unsub := fmt.Sprintf("%s/api/notify/unsubscribe?u=%s&t=%s",
			s.baseURL, store.UUIDString(t.ID), store.UUIDString(t.UnsubToken))
		text := fmt.Sprintf(`%s %s:

    %s
    %s

%s: %s

You get this because session emails are switched on in your WattRoom
settings. Turn them off: %s`,
			place, verb, workoutName, detail, closing, link, unsub)
		m := mail{
			To: *t.Email, Subject: subject, Heading: heading,
			Action: action, URL: link,
			Text: text, Unsub: unsub,
		}
		switch change {
		case sessionReminder:
			// The session is about to happen, which is as live as this mail
			// gets, so the workout is what glows. No body: the heading already
			// says "in an hour", and saying it twice on a card this small
			// reads as padding.
			m.Lead = workoutName
		case sessionCancelled:
			// Nothing is happening at that time any more, so nothing glows:
			// watt marks live data, and this mail exists to say there is none
			// (ADR-0005). The session moves out of the lead and into the body.
			m.Body = []string{workoutName + " was planned for " + when + ". It is not happening."}
		case sessionPlanned, sessionMoved:
			// The workout and its time are the live thing this mail is about,
			// so they are what glows.
			m.Lead = workoutName + " — " + when
		}
		one, cancel := context.WithTimeout(ctx, targetBudget)
		err := s.send(one, m)
		cancel()
		if err != nil {
			s.log.Warn("session email failed", "err", err, "crew", crewID)
		}
	}
}

// inWords is how far off a start is, as the reminder says it: the hour the
// claim window is named for, else the minutes that are actually left.
func inWords(gap time.Duration) string {
	minutes := int(gap.Round(time.Minute) / time.Minute)
	switch {
	case minutes >= 55:
		return "in an hour"
	case minutes > 1:
		return fmt.Sprintf("in %d minutes", minutes)
	case minutes == 1:
		return "in a minute"
	default:
		return "now"
	}
}
