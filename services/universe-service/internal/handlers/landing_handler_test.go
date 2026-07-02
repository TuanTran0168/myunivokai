package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLandingPageServesRootAsHTML(t *testing.T) {
	router := testRouter()
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200 at the service root, got %d", res.Code)
	}
	if contentType := res.Header().Get("Content-Type"); !strings.Contains(contentType, "text/html") {
		t.Fatalf("expected an HTML landing page, got Content-Type %q", contentType)
	}

	pageBody := res.Body.String()
	for _, expectedFragment := range []string{"Trần Đăng Tuấn", "Myunivokai", "http://localhost:3000", "uptime-counter"} {
		if !strings.Contains(pageBody, expectedFragment) {
			t.Fatalf("expected the landing page to contain %q", expectedFragment)
		}
	}
}

func TestLandingPageAnswersHeadRequests(t *testing.T) {
	router := testRouter()
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodHead, "/", nil))

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200 for HEAD at the service root, got %d", res.Code)
	}
}
