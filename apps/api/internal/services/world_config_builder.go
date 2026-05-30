package services

import (
	"math"

	"github.com/myunivokai/myunivokai/apps/api/internal/models"
	"github.com/myunivokai/myunivokai/apps/api/internal/seed"
)

type WorldConfigBuilder struct{}

type BuildWorldConfigInput struct {
	DNA       models.PersonalityDNA
	Seed      string
	VariantNo int
	Input     models.WorldInput
}

func NewWorldConfigBuilder() *WorldConfigBuilder {
	return &WorldConfigBuilder{}
}

func (b *WorldConfigBuilder) Build(input BuildWorldConfigInput) models.WorldSceneConfig {
	rng := seed.NewPRNG(input.Seed)
	primary := "#8B5CF6"
	secondary := "#06B6D4"
	if len(input.Input.FavoriteColors) > 0 {
		primary = input.Input.FavoriteColors[0]
	}
	if len(input.Input.FavoriteColors) > 1 {
		secondary = input.Input.FavoriteColors[1]
	}
	shapes := []string{"sphere", "octahedron", "torus", "box"}
	config := models.WorldSceneConfig{
		SchemaVersion: "1.0",
		SceneName:     input.DNA.SceneName,
		Archetype:     input.DNA.Archetype,
		Quote:         input.DNA.Quote,
		Theme:         input.DNA.VisualHints.Theme,
		Palette: models.Palette{
			Background: "#050816",
			Primary:    primary,
			Secondary:  secondary,
			Accent:     "#FACC15",
			Gradient:   []string{primary, secondary, "#FACC15"},
		},
		Core: models.CoreConfig{
			Shape:     shapes[rng.Intn(len(shapes))],
			Color:     primary,
			Emissive:  secondary,
			Scale:     round(1.05 + rng.Float64()*0.45),
			SpinSpeed: round(0.08 + rng.Float64()*0.18),
		},
		Particles: models.ParticleConfig{
			DesktopCount: 600 + rng.Intn(901),
			MobileCount:  250 + rng.Intn(451),
			Color:        secondary,
			Spread:       round(12 + rng.Float64()*8),
		},
		Camera: models.CameraConfig{
			Distance: round(7 + rng.Float64()*5),
			FOV:      50,
		},
		PostFX: models.PostFXConfig{
			BloomIntensity: round(0.3 + rng.Float64()*1.1),
		},
		HUD: models.HUDConfig{ShowTraitBars: true, ShowLabels: true},
	}
	for i, planet := range input.DNA.Planets {
		color := secondary
		if i%3 == 1 {
			color = "#FACC15"
		} else if i%3 == 2 {
			color = primary
		}
		config.Planets = append(config.Planets, models.PlanetSceneConfig{
			Key:         planet.Key,
			Name:        planet.Name,
			Meaning:     planet.Meaning,
			Color:       color,
			Size:        round(0.45 + rng.Float64()*0.8),
			OrbitRadius: round(3.2 + float64(i)*1.05 + rng.Float64()*0.65),
			OrbitSpeed:  round(0.04 + rng.Float64()*0.32),
			Phase:       round(rng.Float64() * math.Pi * 2),
			Energy:      planet.Energy,
		})
	}
	return config
}

func round(value float64) float64 {
	return math.Round(value*100) / 100
}
