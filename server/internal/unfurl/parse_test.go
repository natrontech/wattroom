package unfurl

import (
	"net/url"
	"strings"
	"testing"
)

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestParseTakesOpenGraphOverTheDocumentTitle(t *testing.T) {
	page := `<!doctype html><html><head>
		<title>Steam Store</title>
		<meta property="og:title" content="Team Fortress 2 on Steam" />
		<meta property="og:description" content="Nine distinct classes." />
		<meta property="og:image" content="/img/header.jpg" />
		<meta property="og:site_name" content="Steam" />
	</head><body><p>ignored</p></body></html>`
	card := parse(strings.NewReader(page), mustURL(t, "https://store.steampowered.com/app/440/"))
	if card.Title != "Team Fortress 2 on Steam" {
		t.Fatalf("title: %q", card.Title)
	}
	if card.Description != "Nine distinct classes." {
		t.Fatalf("description: %q", card.Description)
	}
	// Relative og:image resolves against the page, not against WattRoom.
	if card.Image != "https://store.steampowered.com/img/header.jpg" {
		t.Fatalf("image: %q", card.Image)
	}
	if card.SiteName != "Steam" || card.Host != "store.steampowered.com" {
		t.Fatalf("site/host: %q %q", card.SiteName, card.Host)
	}
}

func TestParseFallsBackToTitleAndDescription(t *testing.T) {
	page := `<html><head><title>  A   plain   page </title>
		<meta name="description" content="Nothing fancy."></head><body></body></html>`
	card := parse(strings.NewReader(page), mustURL(t, "https://www.example.com/x"))
	if card.Title != "A plain page" {
		t.Fatalf("title not collapsed: %q", card.Title)
	}
	if card.Description != "Nothing fancy." {
		t.Fatalf("description: %q", card.Description)
	}
	// www. is chrome, not identity — the card names the site.
	if card.Host != "example.com" {
		t.Fatalf("host: %q", card.Host)
	}
}

func TestParseRefusesAnImageThatIsNotAFetchableURL(t *testing.T) {
	for _, src := range []string{
		"data:image/png;base64,AAAA",
		"javascript:alert(1)",
		"file:///etc/passwd",
	} {
		page := `<html><head><title>t</title><meta property="og:image" content="` + src + `"></head>`
		card := parse(strings.NewReader(page), mustURL(t, "https://example.com/"))
		if card.Image != "" {
			t.Fatalf("%s survived as an image: %q", src, card.Image)
		}
	}
}

func TestParseUnescapesAndTruncatesRatherThanCarryingMarkup(t *testing.T) {
	page := `<html><head>
		<meta property="og:title" content="Bell &amp; Ross &lt;b&gt;bold&lt;/b&gt;">
		<meta property="og:description" content="` + strings.Repeat("é", maxDescRunes+50) + `">
	</head>`
	card := parse(strings.NewReader(page), mustURL(t, "https://example.com/"))
	// Entities become text. The client renders it as text either way — this
	// is about the card saying what the page says, not about escaping.
	if card.Title != "Bell & Ross <b>bold</b>" {
		t.Fatalf("title: %q", card.Title)
	}
	if runes := []rune(card.Description); len(runes) != maxDescRunes+1 {
		t.Fatalf("description is %d runes, want %d plus the ellipsis", len(runes), maxDescRunes)
	}
	if !strings.HasSuffix(card.Description, "…") {
		t.Fatalf("truncation is not marked: %q", card.Description)
	}
}

func TestParseStopsAtTheBody(t *testing.T) {
	// Metadata after <body> is not metadata. Reading on would mean tokenising
	// however much markup a stranger felt like sending.
	page := `<html><head><title>real</title></head><body>
		<meta property="og:title" content="injected later">
		</body></html>`
	card := parse(strings.NewReader(page), mustURL(t, "https://example.com/"))
	if card.Title != "real" {
		t.Fatalf("title: %q", card.Title)
	}
}

func TestParseOfSomethingWithNoMetadataIsNotACard(t *testing.T) {
	card := parse(strings.NewReader("<html><body>just words</body></html>"), mustURL(t, "https://example.com/"))
	if card.Filled() {
		t.Fatalf("empty page produced a card: %+v", card)
	}
	// Truncated markup must not panic or invent anything either.
	card = parse(strings.NewReader("<html><head><meta property=\"og:ti"), mustURL(t, "https://example.com/"))
	if card.Filled() {
		t.Fatalf("truncated page produced a card: %+v", card)
	}
}
