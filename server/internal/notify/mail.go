package notify

// The look of a WattRoom email (#838, ADR-0030). One template, table layout,
// inline styles: an email client has no CSS variables, no light-dark() and no
// web fonts, so nothing in web/src/app.css reaches an inbox. The palette below
// is a hand copy of the Outrun dark values — the second such copy, beside the
// one server/internal/httpx makes for the pages a mail link opens. No build
// step joins them, and the mail is deliberately one fixed look rather than the
// rider's chosen theme, so the copy is a constant rather than drift.
//
// ADR-0005 survives the copy: #ff3d8b (--color-watt) marks the live thing the
// mail is about — a workout name, a start time — and #8b2bff (--color-neon) is
// structure. A mail with nothing live in it, the address confirmation, has no
// Lead and so no magenta outside the mark, whose watt-to-neon gradient is
// copied from web/src/lib/brand/Logo.svelte.

import (
	"bytes"
	"html/template"
)

// mail is one message in both parts: the fields the template renders, and the
// plain text that goes out beside it. Exported field names because a template
// cannot read unexported ones.
type mail struct {
	To      string
	Subject string
	Heading string   // what happened, in ink — chrome, never the glow
	Lead    string   // the live thing, in watt. Empty when there is none
	Body    []string // paragraphs
	Action  string   // button label. Empty for a mail with nothing to press
	URL     string   // where the button goes
	Text    string   // the plain-text part, sent alongside the HTML
	Unsub   string   // bulk mail only: the RFC 8058 link and the footer line
	BaseURL string   // filled in by send
}

func (m mail) render() (string, error) {
	var buf bytes.Buffer
	if err := mailTemplate.Execute(&buf, m); err != nil {
		return "", err
	}
	return buf.String(), nil
}

var mailTemplate = template.Must(template.New("mail").Parse(mailHTML))

// The equalizer W, five bars whose heights trace the letter, as five table
// cells — an <img> would mean a host to serve it, a hole where the wordmark
// belongs whenever a client blocks images, and a tracking-shaped request out
// of an app that promises not to make those.
const mailHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>{{.Subject}}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0118;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0118;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

<tr><td style="padding:0 2px 20px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="bottom" style="padding-right:3px;"><div style="width:5px;height:29px;border-radius:3px;background-color:#8b2bff;background-image:linear-gradient(#ff3d8b,#8b2bff);"></div></td>
    <td valign="bottom" style="padding-right:3px;"><div style="width:5px;height:13px;border-radius:3px;background-color:#8b2bff;background-image:linear-gradient(#ff3d8b,#8b2bff);"></div></td>
    <td valign="bottom" style="padding-right:3px;"><div style="width:5px;height:21px;border-radius:3px;background-color:#8b2bff;background-image:linear-gradient(#ff3d8b,#8b2bff);"></div></td>
    <td valign="bottom" style="padding-right:3px;"><div style="width:5px;height:13px;border-radius:3px;background-color:#8b2bff;background-image:linear-gradient(#ff3d8b,#8b2bff);"></div></td>
    <td valign="bottom"><div style="width:5px;height:29px;border-radius:3px;background-color:#8b2bff;background-image:linear-gradient(#ff3d8b,#8b2bff);"></div></td>
    <td valign="bottom" style="padding-left:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:19px;font-weight:700;letter-spacing:-0.4px;color:#ffffff;">WattRoom</td>
  </tr></table>
</td></tr>

<tr><td bgcolor="#1a0736" style="background-color:#1a0736;border-radius:14px;padding:30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <h1 style="margin:0;font-size:21px;line-height:1.3;font-weight:700;color:#ffffff;">{{.Heading}}</h1>
  {{- if .Lead}}
  <p style="margin:14px 0 0;font-size:17px;line-height:1.45;font-weight:700;color:#ff3d8b;">{{.Lead}}</p>
  {{- end}}
  {{- range .Body}}
  <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#ffffff;">{{.}}</p>
  {{- end}}
  {{- if .Action}}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;"><tr>
    <td bgcolor="#8b2bff" style="background-color:#8b2bff;border-radius:9px;">
      <a href="{{.URL}}" style="display:inline-block;padding:14px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">{{.Action}}</a>
    </td>
  </tr></table>
  {{- end}}
</td></tr>

<tr><td style="padding:22px 2px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9182b8;">
  {{- if .Unsub}}
  <p style="margin:0 0 8px;">You get this because session emails are switched on in your WattRoom profile. <a href="{{.Unsub}}" style="color:#9182b8;">Turn them off</a>.</p>
  {{- end}}
  <p style="margin:0;"><a href="{{.BaseURL}}" style="color:#9182b8;text-decoration:none;">wattroom.ch</a></p>
</td></tr>

</table>
</td></tr></table>
</body>
</html>
`
