package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/myunivokai/myunivokai/apps/api/internal/ai"
	"github.com/myunivokai/myunivokai/apps/api/internal/ai/providers"
	"github.com/myunivokai/myunivokai/apps/api/internal/config"
	"github.com/myunivokai/myunivokai/apps/api/internal/models"
	"github.com/myunivokai/myunivokai/apps/api/internal/repositories"
	"github.com/myunivokai/myunivokai/apps/api/internal/services"
	"github.com/myunivokai/myunivokai/apps/api/internal/validation"
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

func TestWorldHandlerValidationError(t *testing.T) {
	router := testRouter()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/worlds", strings.NewReader(`{"nickname":"A"}`))
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected validation error, got %d", res.Code)
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
	service := services.NewWorldService(cfg, repositories.NewMemoryStore(), orch, services.NewWorldConfigBuilder())
	return NewRouter(cfg, NewHealthHandler(cfg), NewWorldHandler(service), NewShareHandler(service))
}
