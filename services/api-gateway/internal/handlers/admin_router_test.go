package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
)

func testAdminGatewayConfig() config.Config {
	serviceConfig := testGatewayConfig()
	serviceConfig.AdminRoutesEnabled = true
	serviceConfig.AdminAllowedOrigin = "https://admin.example.com"
	serviceConfig.AdminRateLimitRequestsPerSecond = 1000
	serviceConfig.AdminRateLimitBurst = 1000
	return serviceConfig
}

// Every /api/admin route must reject an unauthenticated request except
// login, which is public by design - see the S4-AUTH-003 default-deny
// scenario in notes/sprints/sprint-04-2026-08-06/user-stories.md. A route
// added later without wiring RequireAdminRefreshCookie or
// RequireAdminAccessToken fails this test instead of shipping open.
func TestAdminRoutesDefaultDenyUnlessExplicitlyPublic(t *testing.T) {
	publicRoutes := map[string]bool{"POST /api/admin/auth/login": true}
	router := NewRouter(testAdminGatewayConfig(), &fakeBroker{}, newFakeEdgeStore())

	walkErr := chi.Walk(router.(chi.Router), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !strings.HasPrefix(route, "/api/admin") {
			return nil
		}
		key := method + " " + route
		if publicRoutes[key] {
			return nil
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(method, route, nil))
		if response.Code != http.StatusUnauthorized {
			t.Errorf("route %s: expected 401 default-deny for an unauthenticated request, got %d", key, response.Code)
		}
		return nil
	})
	if walkErr != nil {
		t.Fatal(walkErr)
	}
}

func TestAdminRoutesAreNotMountedWhenDisabled(t *testing.T) {
	router := NewRouter(testGatewayConfig(), &fakeBroker{}, newFakeEdgeStore())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", strings.NewReader(`{"email":"a@b.com","password":"x"}`)))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when ADMIN_ROUTES_ENABLED is false", response.Code)
	}
}

func TestAdminLoginSetsSessionCookiesAndOmitsTokensFromTheBody(t *testing.T) {
	session := contracts.LoginResponseData{
		AccessToken: "access-token-value", AccessExpiresAt: time.Now().Add(10 * time.Minute).UTC(),
		RefreshToken: "refresh-token-value", RefreshExpiresAt: time.Now().Add(336 * time.Hour).UTC(),
		Account: contracts.AccountSummary{AccountID: "account-1", Email: "staff@example.com"},
	}
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusOK, session)
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{response: responseEnvelope}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", strings.NewReader(`{"email":"staff@example.com","password":"correct horse battery staple"}`)))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	if brokerClient.requestedSubject != contracts.AuthLoginQuerySubject {
		t.Fatalf("subject = %q, want %q", brokerClient.requestedSubject, contracts.AuthLoginQuerySubject)
	}
	if strings.Contains(response.Body.String(), "access-token-value") || strings.Contains(response.Body.String(), "refresh-token-value") {
		t.Fatalf("session tokens must never appear in the response body: %s", response.Body.String())
	}
	cookies := response.Result().Cookies()
	var access, refresh *http.Cookie
	for _, cookie := range cookies {
		switch cookie.Name {
		case "myunivokai_admin_access":
			access = cookie
		case "myunivokai_admin_refresh":
			refresh = cookie
		}
	}
	if access == nil || access.Value != "access-token-value" || !access.HttpOnly || access.SameSite != http.SameSiteLaxMode {
		t.Fatalf("access cookie = %+v", access)
	}
	if refresh == nil || refresh.Value != "refresh-token-value" || refresh.Path != "/api/admin/auth" || !refresh.HttpOnly {
		t.Fatalf("refresh cookie = %+v", refresh)
	}
	var decodedBody map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decodedBody); err != nil {
		t.Fatal(err)
	}
	if _, hasAccountKey := decodedBody["account"]; !hasAccountKey {
		t.Fatalf("expected the account summary in the response body, got %s", response.Body.String())
	}
}

func TestAdminRefreshRequiresARefreshCookieBeforeCallingAuthService(t *testing.T) {
	brokerClient := &fakeBroker{}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/admin/auth/refresh", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
	if brokerClient.requestedSubject != "" {
		t.Fatalf("auth-service must not be called without a refresh cookie, but subject=%q was requested", brokerClient.requestedSubject)
	}
}

func TestAdminLogoutClearsSessionCookies(t *testing.T) {
	responseEnvelope, err := contracts.SuccessRPCEnvelope("request-1", http.StatusNoContent, struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	brokerClient := &fakeBroker{response: responseEnvelope}
	router := NewRouter(testAdminGatewayConfig(), brokerClient, newFakeEdgeStore())
	request := httptest.NewRequest(http.MethodPost, "/api/admin/auth/logout", nil)
	request.AddCookie(&http.Cookie{Name: "myunivokai_admin_refresh", Value: "raw-refresh-token"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}
	for _, cookie := range response.Result().Cookies() {
		if cookie.MaxAge >= 0 {
			t.Fatalf("cookie %q was not cleared: MaxAge=%d", cookie.Name, cookie.MaxAge)
		}
	}
}

func TestAdminCORSAllowsOnlyItsOwnOriginNeverTheProductOrigin(t *testing.T) {
	router := NewRouter(testAdminGatewayConfig(), &fakeBroker{}, newFakeEdgeStore())
	request := httptest.NewRequest(http.MethodOptions, "/api/admin/auth/login", nil)
	request.Header.Set("Origin", "http://localhost:41300") // the product origin, not the admin origin
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Header().Get("Access-Control-Allow-Origin") == "http://localhost:41300" {
		t.Fatal("the admin CORS handler must not allow the product origin")
	}

	adminOriginRequest := httptest.NewRequest(http.MethodOptions, "/api/admin/auth/login", nil)
	adminOriginRequest.Header.Set("Origin", "https://admin.example.com")
	adminOriginRequest.Header.Set("Access-Control-Request-Method", http.MethodPost)
	adminOriginResponse := httptest.NewRecorder()
	router.ServeHTTP(adminOriginResponse, adminOriginRequest)
	if adminOriginResponse.Header().Get("Access-Control-Allow-Origin") != "https://admin.example.com" {
		t.Fatalf("admin origin preflight = %q", adminOriginResponse.Header().Get("Access-Control-Allow-Origin"))
	}
}
