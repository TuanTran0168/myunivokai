package services

import (
	"reflect"
	"testing"

	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

func TestWorldConfigBuilderDeterministic(t *testing.T) {
	builder := NewWorldConfigBuilder()
	input := BuildWorldConfigInput{
		Seed:  "WLD-ABC1234567",
		Input: models.WorldInput{FavoriteColors: []string{"#8B5CF6", "#06B6D4"}},
		DNA: models.PersonalityDNA{
			Archetype:   "Builder Explorer",
			SceneName:   "Galaxy",
			Quote:       "Build.",
			VisualHints: models.VisualHints{Theme: "cosmic-galaxy"},
			Planets: []models.DNAPlanet{
				{Key: "a", Name: "A", Meaning: "A", Energy: 80},
				{Key: "b", Name: "B", Meaning: "B", Energy: 70},
				{Key: "c", Name: "C", Meaning: "C", Energy: 60},
			},
		},
	}
	a := builder.Build(input)
	b := builder.Build(input)
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("expected deterministic config")
	}
	if len(a.Planets) != 3 {
		t.Fatalf("expected 3 planets")
	}
	if a.Particles.DesktopCount < 600 || a.Particles.DesktopCount > 1500 {
		t.Fatalf("desktop particle count out of bounds")
	}
}
