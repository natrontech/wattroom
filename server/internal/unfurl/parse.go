package unfurl

import (
	"html"
	"io"
	"net/url"
	"strings"

	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Card is what one link becomes. Every field is optional except Host — a page
// that offers nothing still tells the reader where the link goes, and a card
// with only a host is not worth drawing, which is the client's call.
type Card struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	// Absolute, on the page's own host. The client never loads it directly —
	// it asks the image proxy for it, so a preview costs no rider their IP.
	Image    string `json:"image,omitempty"`
	SiteName string `json:"siteName,omitempty"`
	Host     string `json:"host"`
}

// Filled reports whether the page said anything worth a card.
func (c Card) Filled() bool { return c.Title != "" || c.Description != "" || c.Image != "" }

const (
	maxTitleRunes = 200
	maxDescRunes  = 400
)

// parse pulls Open Graph out of a page's <head>, falling back to <title> and
// the description meta. Tokenised rather than tree-parsed: the metadata is all
// in the head, so this stops at <body> and never builds a document out of a
// stranger's 500 KB of markup.
//
// base is the URL the response actually came from — after redirects — so a
// relative og:image resolves against the right host.
func parse(body io.Reader, base *url.URL) Card {
	card := Card{URL: base.String(), Host: strings.TrimPrefix(base.Hostname(), "www.")}
	var title, ogTitle, desc, ogDesc, image, site string

	z := xhtml.NewTokenizer(body)
	for {
		switch z.Next() {
		case xhtml.ErrorToken:
			// io.EOF, a read past the byte cap, or malformed markup — whatever
			// was collected up to here is the answer.
			return finish(card, ogTitle, title, ogDesc, desc, image, site, base)
		case xhtml.StartTagToken, xhtml.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			switch atom.Lookup(name) {
			case atom.Body:
				// Metadata lives in the head. Everything past here is content.
				return finish(card, ogTitle, title, ogDesc, desc, image, site, base)
			case atom.Title:
				if z.Next() == xhtml.TextToken {
					title = string(z.Text())
				}
			case atom.Meta:
				if !hasAttr {
					continue
				}
				key, content := metaPair(z)
				switch key {
				case "og:title", "twitter:title":
					if ogTitle == "" {
						ogTitle = content
					}
				case "og:description", "twitter:description", "description":
					if key == "description" {
						if desc == "" {
							desc = content
						}
					} else if ogDesc == "" {
						ogDesc = content
					}
				case "og:image", "og:image:url", "og:image:secure_url", "twitter:image":
					if image == "" {
						image = content
					}
				case "og:site_name":
					if site == "" {
						site = content
					}
				}
			}
		}
	}
}

// metaPair reads one <meta> tag's identity and value. Open Graph uses
// `property`, the Twitter and HTML tags use `name`; both mean the same thing
// here, so both are read into one key.
func metaPair(z *xhtml.Tokenizer) (key, content string) {
	for {
		name, value, more := z.TagAttr()
		switch string(name) {
		case "property", "name":
			key = strings.ToLower(strings.TrimSpace(string(value)))
		case "content":
			content = string(value)
		}
		if !more {
			return key, content
		}
	}
}

func finish(card Card, ogTitle, title, ogDesc, desc, image, site string, base *url.URL) Card {
	card.Title = clean(firstOf(ogTitle, title), maxTitleRunes)
	card.Description = clean(firstOf(ogDesc, desc), maxDescRunes)
	card.SiteName = clean(site, maxTitleRunes)
	card.Image = absolute(clean(image, 2048), base)
	return card
}

func firstOf(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// clean unescapes the entities the tokenizer leaves in attribute values,
// collapses whitespace, and truncates. The result is data for a JSON field —
// never markup, and never long enough to make the response the payload.
func clean(s string, maxRunes int) string {
	s = strings.Join(strings.Fields(html.UnescapeString(s)), " ")
	if r := []rune(s); len(r) > maxRunes {
		s = strings.TrimSpace(string(r[:maxRunes])) + "…"
	}
	return s
}

// absolute resolves a possibly-relative image against the page it came from
// and refuses anything that is not http(s) — a `data:` or `javascript:`
// og:image must not reach the client as an image source.
func absolute(raw string, base *url.URL) string {
	if raw == "" {
		return ""
	}
	ref, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(ref)
	if err := checkURL(resolved); err != nil {
		return ""
	}
	return resolved.String()
}
