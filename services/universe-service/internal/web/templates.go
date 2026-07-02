// Package web holds the embedded browser-facing assets the API serves
// directly (currently only the root landing page), keeping markup out of the
// transport-focused handlers package.
package web

import (
	_ "embed"
	"html/template"
)

//go:embed landing_page.html
var landingPageMarkup string

// LandingPageTemplate is parsed once at startup; a broken template is a
// build-time artifact problem, so failing fast here beats a 500 on every
// visit.
var LandingPageTemplate = template.Must(template.New("landing-page").Parse(landingPageMarkup))
