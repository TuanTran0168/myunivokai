package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/ai/providers"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/config"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/services"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/validation"
)

func TestWorldHandlerFlow(t *testing.T) {
	router := testRouter()
	input := models.WorldInput{
		Nickname:            "Tuan",
		Role:                "Developer",
		Interests:           []string{"coding", "travel", "photo"},
		Traits:              []string{"curious", "builder", "focused"},
		Goal:                "Build a beautiful AI product",
		Challenge:           "I overthink product direction",
		Mood:                "futuristic calm",
		FavoriteColors:      []string{"#8B5CF6", "#06B6D4"},
		PreferredWorldStyle: "cosmic-galaxy",
	}
	body, _ := json.Marshal(input)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/worlds", bytes.NewReader(body))
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", res.Code, res.Body.String())
	}
	var created models.CreateWorldResponse
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.World.ID == "" || created.Variant.ID == "" {
		t.Fatalf("expected world and variant IDs")
	}

	res = httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/api/v1/worlds/"+created.World.ID+"/variants", nil))
	if res.Code != http.StatusCreated {
		t.Fatalf("variant status=%d body=%s", res.Code, res.Body.String())
	}
	var variant models.VariantResponse
	_ = json.Unmarshal(res.Body.Bytes(), &variant)

	res = httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/api/v1/worlds/"+created.World.ID+"/variants/"+variant.Variant.ID+"/select", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("select status=%d body=%s", res.Code, res.Body.String())
	}

	res = httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/api/v1/worlds/"+created.World.ID+"/publish", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("publish status=%d body=%s", res.Code, res.Body.String())
	}
	var published models.PublishResponse
	_ = json.Unmarshal(res.Body.Bytes(), &published)
	if published.ShareSlug == "" || !strings.Contains(published.ShareURL, "/share/") {
		t.Fatalf("unexpected publish response: %+v", published)
	}

	res = httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v1/share/worlds/"+published.ShareSlug, nil))
	if res.Code != http.StatusOK {
		t.Fatalf("share status=%d body=%s", res.Code, res.Body.String())
	}
	if strings.Contains(res.Body.String(), "overthink") {
		t.Fatalf("public response leaked challenge: %s", res.Body.String())
	}
}

func TestWorldHandlerGetBatch(t *testing.T) {
	router := testRouter()
	firstWorldID := createTestWorld(t, router, "Tuan")
	secondWorldID := createTestWorld(t, router, "Neo")

	missingWorldID := "3f2f4c1e-9d5a-4b7e-8c6d-0a1b2c3d4e5f"
	batchIDs := firstWorldID + "," + secondWorldID + "," + missingWorldID + ",not-a-uuid," + firstWorldID
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v1/worlds?ids="+batchIDs, nil))
	if res.Code != http.StatusOK {
		t.Fatalf("batch status=%d body=%s", res.Code, res.Body.String())
	}
	var batch models.WorldListResponse
	if err := json.Unmarshal(res.Body.Bytes(), &batch); err != nil {
		t.Fatal(err)
	}
	if len(batch.Worlds) != 2 {
		t.Fatalf("expected 2 worlds (missing + malformed + duplicate ids skipped), got %d", len(batch.Worlds))
	}
	if batch.Worlds[0].World.ID != firstWorldID || batch.Worlds[1].World.ID != secondWorldID {
		t.Fatalf("expected requested-id order, got %s then %s", batch.Worlds[0].World.ID, batch.Worlds[1].World.ID)
	}
	for _, worldResponse := range batch.Worlds {
		if worldResponse.SelectedVariant.ID == "" || len(worldResponse.Variants) == 0 {
			t.Fatalf("batch entry must match the single-get shape, got %+v", worldResponse)
		}
	}
}

func TestWorldHandlerGetBatchRejectsMissingAndOversizedIDs(t *testing.T) {
	router := testRouter()

	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v1/worlds", nil))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without ids, got %d", res.Code)
	}

	oversizedIDs := make([]string, 0, maximumBatchWorldIDs+1)
	for range maximumBatchWorldIDs + 1 {
		oversizedIDs = append(oversizedIDs, uuid.NewString())
	}
	res = httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v1/worlds?ids="+strings.Join(oversizedIDs, ","), nil))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for more than %d ids, got %d", maximumBatchWorldIDs, res.Code)
	}
}

// createTestWorld creates a world through the full router and returns its id.
func createTestWorld(t *testing.T, router http.Handler, nickname string) string {
	t.Helper()
	input := models.WorldInput{
		Nickname:            nickname,
		Role:                "Developer",
		Interests:           []string{"coding", "travel", "photo"},
		Traits:              []string{"curious", "builder", "focused"},
		Goal:                "Build a beautiful AI product",
		Mood:                "focused",
		FavoriteColors:      []string{"#8B5CF6"},
		PreferredWorldStyle: "cosmic-galaxy",
	}
	body, _ := json.Marshal(input)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/api/v1/worlds", bytes.NewReader(body)))
	if res.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", res.Code, res.Body.String())
	}
	var created models.CreateWorldResponse
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	return created.World.ID
}

func TestWorldHandlerValidationError(t *testing.T) {
	router := testRouter()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/worlds", strings.NewReader(`{"nickname":"A"}`))
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected validation error, got %d", res.Code)
	}
}

func TestWorldHandlerMalformedUUIDReturnsNotFound(t *testing.T) {
	router := testRouter()
	malformedWorldID := "not-a-valid-uuid"
	requests := []*http.Request{
		httptest.NewRequest(http.MethodGet, "/api/v1/worlds/"+malformedWorldID, nil),
		httptest.NewRequest(http.MethodPost, "/api/v1/worlds/"+malformedWorldID+"/variants", nil),
		httptest.NewRequest(http.MethodPost, "/api/v1/worlds/"+malformedWorldID+"/variants/also-bad/select", nil),
		httptest.NewRequest(http.MethodPost, "/api/v1/worlds/"+malformedWorldID+"/publish", nil),
	}
	for _, request := range requests {
		res := httptest.NewRecorder()
		router.ServeHTTP(res, request)
		if res.Code != http.StatusNotFound {
			t.Fatalf("%s %s: expected 404 for malformed UUID, got %d body=%s", request.Method, request.URL.Path, res.Code, res.Body.String())
		}
	}
}

func TestWorldHandlerRejectsOversizedBody(t *testing.T) {
	router := testRouter()
	oversizedPayload := `{"nickname":"` + strings.Repeat("a", 80*1024) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/worlds", strings.NewReader(oversizedPayload))
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized body, got %d", res.Code)
	}
	if !strings.Contains(res.Body.String(), "too large") {
		t.Fatalf("expected body-too-large message, got %s", res.Body.String())
	}
}

func TestWorldHandlerRejectsUnknownFields(t *testing.T) {
	router := testRouter()
	payloadWithUnknownField := `{"nickname":"Tuan","unexpectedField":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/worlds", strings.NewReader(payloadWithUnknownField))
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown field, got %d", res.Code)
	}
}

func testRouter() http.Handler {
	cfg := config.Config{
		AppName:         "Myunivokai",
		AppEnv:          "test",
		PublicWebURL:    "http://localhost:3000",
		AllowedOrigins:  []string{"http://localhost:3000"},
		AIProvider:      "mock",
		AIPromptVersion: "world-dna-v1",
		AITimeout:       time.Second,
		RateLimitRPS:    1000,
		RateLimitBurst:  1000,
	}
	orch := ai.NewOrchestrator(providers.NewMock(), nil, validation.ValidatePersonalityDNA, time.Second)
	store := repositories.NewMemoryStore()
	service := services.NewWorldService(cfg, store, orch, services.NewWorldConfigBuilder())
	return NewRouter(cfg, NewHealthHandler(cfg, store), NewWorldHandler(service), NewShareHandler(service), NewLandingHandler(cfg, time.Now()))
}

// unreachableProvider simulates an AI provider that is down at the transport
// level (network error, timeout), as opposed to answering with bad content.
type unreachableProvider struct{}

func (p unreachableProvider) Name() ai.ProviderName { return ai.ProviderName("unreachable") }

func (p unreachableProvider) GenerateStructured(ctx context.Context, req ai.StructuredRequest) (*ai.StructuredResponse, error) {
	return nil, errors.New("connection refused")
}

func TestWorldHandlerCreateReturns503WhenAIIsUnavailable(t *testing.T) {
	cfg := config.Config{
		AppName:         "Myunivokai",
		AppEnv:          "test",
		PublicWebURL:    "http://localhost:3000",
		AllowedOrigins:  []string{"http://localhost:3000"},
		AIPromptVersion: "world-dna-v1",
		AITimeout:       time.Second,
		RateLimitRPS:    1000,
		RateLimitBurst:  1000,
	}
	orch := ai.NewOrchestrator(unreachableProvider{}, nil, validation.ValidatePersonalityDNA, time.Second)
	store := repositories.NewMemoryStore()
	service := services.NewWorldService(cfg, store, orch, services.NewWorldConfigBuilder())
	router := NewRouter(cfg, NewHealthHandler(cfg, store), NewWorldHandler(service), NewShareHandler(service), NewLandingHandler(cfg, time.Now()))

	input := models.WorldInput{
		Nickname:            "Tuan",
		Interests:           []string{"coding", "travel", "photo"},
		Traits:              []string{"curious", "builder", "focused"},
		Goal:                "Build a beautiful AI product",
		Mood:                "futuristic calm",
		FavoriteColors:      []string{"#8B5CF6"},
		PreferredWorldStyle: "cosmic-galaxy",
	}
	body, _ := json.Marshal(input)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/api/v1/worlds", bytes.NewReader(body)))

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when the AI provider is unreachable, got %d body=%s", res.Code, res.Body.String())
	}
	if retryAfter := res.Header().Get("Retry-After"); retryAfter == "" {
		t.Fatal("503 must carry Retry-After so clients know to retry shortly")
	}
	if !strings.Contains(res.Body.String(), "AI_UNAVAILABLE") {
		t.Fatalf("expected the AI_UNAVAILABLE error code, got %s", res.Body.String())
	}
}

func TestSwaggerIsDisabledInProduction(t *testing.T) {
	cfg := config.Config{AppEnv: "production", RateLimitRPS: 1000, RateLimitBurst: 1000, AllowedOrigins: []string{"http://localhost:3000"}}
	store := repositories.NewMemoryStore()
	orch := ai.NewOrchestrator(providers.NewMock(), nil, validation.ValidatePersonalityDNA, time.Second)
	service := services.NewWorldService(cfg, store, orch, services.NewWorldConfigBuilder())
	router := NewRouter(cfg, NewHealthHandler(cfg, store), NewWorldHandler(service), NewShareHandler(service), NewLandingHandler(cfg, time.Now()))

	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/swagger/index.html", nil))
	if res.Code != http.StatusNotFound {
		t.Fatalf("expected swagger to be hidden in production, got %d", res.Code)
	}

	developmentRouter := testRouter()
	res = httptest.NewRecorder()
	developmentRouter.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/swagger/index.html", nil))
	if res.Code == http.StatusNotFound {
		t.Fatalf("expected swagger to be available outside production, got %d", res.Code)
	}
}

func TestReadinessEndpoint(t *testing.T) {
	router := testRouter()
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/v1/readyz", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("expected readyz 200 with memory store, got %d", res.Code)
	}
}
