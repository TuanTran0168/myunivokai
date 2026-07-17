package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/ai/providers"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/config"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/repositories"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/services"
	"github.com/myunivokai/myunivokai/services/nature-service/internal/validation"
)

func newTestRouter(t *testing.T) http.Handler {
	t.Helper()
	cfg := config.Config{
		AppEnv:          "test",
		AppName:         "Myunivokai Nature",
		PublicWebURL:    "http://localhost:3000",
		AllowedOrigins:  []string{"http://localhost:3000"},
		RateLimitRPS:    1000,
		RateLimitBurst:  1000,
		ShareSlugLength: 10,
	}
	store := repositories.NewMemoryStore()
	orchestrator := ai.NewOrchestrator(providers.NewMock(), nil, validation.ValidateNatureDNA, time.Second)
	worldService := services.NewWorldService(cfg, store, orchestrator, services.NewForestConfigBuilder())
	return NewRouter(cfg, NewHealthHandler(cfg, store), NewWorldHandler(worldService), NewShareHandler(worldService), NewLandingHandler(cfg))
}

func validCreateBody(t *testing.T) *bytes.Reader {
	t.Helper()
	payload, err := json.Marshal(models.WorldInput{
		Nickname:            "Tuan",
		Interests:           []string{"hiking", "music", "photography"},
		Traits:              []string{"curious", "calm", "kind"},
		Goal:                "Grow a quiet forest of my own.",
		Mood:                "dreamy",
		FavoriteColors:      []string{"#8B5CF6", "#06B6D4"},
		PreferredWorldStyle: "aurora",
	})
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	return bytes.NewReader(payload)
}

func performRequest(t *testing.T, router http.Handler, method, path string, body *bytes.Reader) *httptest.ResponseRecorder {
	t.Helper()
	var request *http.Request
	if body != nil {
		request = httptest.NewRequest(method, path, body)
	} else {
		request = httptest.NewRequest(method, path, nil)
	}
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestHealthzEndpoint(t *testing.T) {
	router := newTestRouter(t)
	response := performRequest(t, router, http.MethodGet, "/api/v1/healthz", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("healthz = %d, want 200", response.Code)
	}
}

func TestSwaggerAvailabilityFollowsEnvironment(t *testing.T) {
	productionConfig := config.Config{
		AppEnv:         "production",
		AllowedOrigins: []string{"http://localhost:3000"},
		RateLimitRPS:   1000,
		RateLimitBurst: 1000,
	}
	store := repositories.NewMemoryStore()
	orchestrator := ai.NewOrchestrator(providers.NewMock(), nil, validation.ValidateNatureDNA, time.Second)
	worldService := services.NewWorldService(productionConfig, store, orchestrator, services.NewForestConfigBuilder())
	productionRouter := NewRouter(productionConfig, NewHealthHandler(productionConfig, store), NewWorldHandler(worldService), NewShareHandler(worldService), NewLandingHandler(productionConfig))

	productionResponse := httptest.NewRecorder()
	productionRouter.ServeHTTP(productionResponse, httptest.NewRequest(http.MethodGet, "/swagger/index.html", nil))
	if productionResponse.Code != http.StatusNotFound {
		t.Fatalf("expected swagger to be hidden in production, got %d", productionResponse.Code)
	}

	developmentConfig := productionConfig
	developmentConfig.AppEnv = "development"
	developmentRouter := NewRouter(developmentConfig, NewHealthHandler(developmentConfig, store), NewWorldHandler(worldService), NewShareHandler(worldService), NewLandingHandler(developmentConfig))
	developmentResponse := httptest.NewRecorder()
	developmentRouter.ServeHTTP(developmentResponse, httptest.NewRequest(http.MethodGet, "/swagger/index.html", nil))
	if developmentResponse.Code != http.StatusOK {
		t.Fatalf("expected swagger outside production, got %d", developmentResponse.Code)
	}
}

func TestCreateWorldEndpoint(t *testing.T) {
	router := newTestRouter(t)
	response := performRequest(t, router, http.MethodPost, "/api/v1/worlds", validCreateBody(t))
	if response.Code != http.StatusCreated {
		t.Fatalf("create = %d, want 201; body: %s", response.Code, response.Body.String())
	}
	var created models.CreateWorldResponse
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Variant.Config.SceneType != "forest" {
		t.Fatalf("config sceneType = %q, want forest", created.Variant.Config.SceneType)
	}
	if len(created.NatureDNA.Landmarks) < 3 {
		t.Fatalf("natureDNA must carry at least 3 landmarks")
	}
}

func TestCreateWorldValidationError(t *testing.T) {
	router := newTestRouter(t)
	payload, _ := json.Marshal(models.WorldInput{Nickname: "x", Mood: "chaotic"})
	response := performRequest(t, router, http.MethodPost, "/api/v1/worlds", bytes.NewReader(payload))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid input = %d, want 400", response.Code)
	}
	if body := response.Body.String(); !bytes.Contains([]byte(body), []byte("VALIDATION_ERROR")) {
		t.Fatalf("expected the VALIDATION_ERROR envelope, got %s", body)
	}
}

func TestGetWorldNotFound(t *testing.T) {
	router := newTestRouter(t)
	if response := performRequest(t, router, http.MethodGet, "/api/v1/worlds/"+uuid.NewString(), nil); response.Code != http.StatusNotFound {
		t.Fatalf("unknown world = %d, want 404", response.Code)
	}
	if response := performRequest(t, router, http.MethodGet, "/api/v1/worlds/not-a-uuid", nil); response.Code != http.StatusNotFound {
		t.Fatalf("malformed world id = %d, want 404", response.Code)
	}
}

// The whole lifecycle through real HTTP: create → regenerate → select →
// publish → public share.
func TestWorldLifecycleThroughRouter(t *testing.T) {
	router := newTestRouter(t)
	createResponse := performRequest(t, router, http.MethodPost, "/api/v1/worlds", validCreateBody(t))
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create = %d; body: %s", createResponse.Code, createResponse.Body.String())
	}
	var created models.CreateWorldResponse
	if err := json.Unmarshal(createResponse.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}

	regenerateResponse := performRequest(t, router, http.MethodPost, fmt.Sprintf("/api/v1/worlds/%s/variants", created.World.ID), bytes.NewReader(nil))
	if regenerateResponse.Code != http.StatusCreated {
		t.Fatalf("regenerate = %d; body: %s", regenerateResponse.Code, regenerateResponse.Body.String())
	}
	var regenerated models.VariantResponse
	if err := json.Unmarshal(regenerateResponse.Body.Bytes(), &regenerated); err != nil {
		t.Fatalf("decode regenerate: %v", err)
	}
	if regenerated.Variant.VariantNo != 2 {
		t.Fatalf("regenerated variantNo = %d, want 2", regenerated.Variant.VariantNo)
	}

	selectResponse := performRequest(t, router, http.MethodPost, fmt.Sprintf("/api/v1/worlds/%s/variants/%s/select", created.World.ID, regenerated.Variant.ID), bytes.NewReader(nil))
	if selectResponse.Code != http.StatusOK {
		t.Fatalf("select = %d; body: %s", selectResponse.Code, selectResponse.Body.String())
	}

	publishResponse := performRequest(t, router, http.MethodPost, fmt.Sprintf("/api/v1/worlds/%s/publish", created.World.ID), bytes.NewReader(nil))
	if publishResponse.Code != http.StatusOK {
		t.Fatalf("publish = %d; body: %s", publishResponse.Code, publishResponse.Body.String())
	}
	var published models.PublishResponse
	if err := json.Unmarshal(publishResponse.Body.Bytes(), &published); err != nil {
		t.Fatalf("decode publish: %v", err)
	}

	shareResponse := performRequest(t, router, http.MethodGet, "/api/v1/share/worlds/"+published.ShareSlug, nil)
	if shareResponse.Code != http.StatusOK {
		t.Fatalf("share = %d; body: %s", shareResponse.Code, shareResponse.Body.String())
	}
	var public models.PublicWorldResponse
	if err := json.Unmarshal(shareResponse.Body.Bytes(), &public); err != nil {
		t.Fatalf("decode share: %v", err)
	}
	// The share view must expose the SELECTED variant (variant 2 after select).
	if public.Variant.Seed != regenerated.Variant.Seed {
		t.Fatalf("share must serve the selected variant, got seed %q want %q", public.Variant.Seed, regenerated.Variant.Seed)
	}
	if len(public.PublicDNA.Landmarks) == 0 {
		t.Fatalf("public DNA must expose landmarks")
	}
}
