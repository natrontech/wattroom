package httpx

import (
	"html"
	"net/http"
	"strings"
)

// WritePage renders one of the few pages the server serves itself: the
// confirm-address and unsubscribe links from a mail land here, not in the SPA.
// They used to be a bare <form> in the browser's default serif, which on the
// one page that asks a rider to trust a link from their inbox read as
// phishing (#832). The shell is the app's — its tokens copied from
// web/src/app.css by hand, since no build step joins the two — and carries no
// script: the form-POST-not-GET rule that keeps mail scanners from confirming
// on a rider's behalf needs none.
//
// body is HTML the caller has already escaped; title is escaped here.
func WritePage(w http.ResponseWriter, status int, title, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	// Placeholders rather than a format string: the CSS is full of %.
	_, _ = w.Write([]byte(strings.NewReplacer(
		"{{title}}", html.EscapeString(title), "{{body}}", body).Replace(pageShell)))
}

// PageBody is the common shape of those pages: a heading, one line, and at
// most one thing to do (a form to submit, or a link out). Escapes what it is
// handed.
func PageBody(heading, line, action string) string {
	return "<h1>" + html.EscapeString(heading) + "</h1><p>" + html.EscapeString(line) + "</p>" + action
}

// PageLink is a link styled as the page's one button; href is escaped.
func PageLink(href, label string) string {
	return `<a class="btn" href="` + html.EscapeString(href) + `">` + html.EscapeString(label) + `</a>`
}

const pageShell = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>{{title}} · WattRoom</title>
<style>
:root{color-scheme:light dark;--paper:light-dark(#ffffff,#000000);--raised:light-dark(#ffffff,#1a0736);--ink:light-dark(#180a2e,#ffffff);--muted:light-dark(#60548a,#9182b8);--neon:light-dark(#6f1ad1,#8b2bff)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:16px/1.5 Barlow,ui-sans-serif,system-ui,sans-serif}
main{width:min(28rem,calc(100% - 2rem));padding:2rem;border:1px solid color-mix(in srgb,var(--neon) 35%,transparent);border-radius:.75rem;background:var(--raised)}
.brand{margin:0 0 1.25rem;font:700 .95rem 'Chakra Petch',Barlow,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--neon)}
h1{margin:0 0 .5rem;font:600 1.4rem/1.3 'Chakra Petch',Barlow,system-ui,sans-serif}
p{margin:0 0 1.25rem;color:var(--muted)}
strong{color:var(--ink)}
button,.btn{display:inline-block;padding:.7rem 1.4rem;border:1px solid var(--neon);border-radius:.5rem;background:var(--neon);color:#fff;font:600 1rem Barlow,ui-sans-serif,system-ui,sans-serif;text-decoration:none;cursor:pointer}
button:hover,.btn:hover{filter:brightness(1.1)}
</style></head><body><main><p class="brand">WattRoom</p>{{body}}</main></body></html>
`
