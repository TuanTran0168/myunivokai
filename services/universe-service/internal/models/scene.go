package models

type WorldSceneConfig struct {
	SchemaVersion string              `json:"schemaVersion"`
	SceneName     string              `json:"sceneName"`
	Archetype     string              `json:"archetype"`
	Quote         string              `json:"quote"`
	Theme         string              `json:"theme"`
	Palette       Palette             `json:"palette"`
	Core          CoreConfig          `json:"core"`
	Planets       []PlanetSceneConfig `json:"planets"`
	Particles     ParticleConfig      `json:"particles"`
	Camera        CameraConfig        `json:"camera"`
	PostFX        PostFXConfig        `json:"postFX"`
	HUD           HUDConfig           `json:"hud"`
	// Sky was added in schemaVersion 1.1. Pointer + omitempty so configs stored
	// before that keep round-tripping without a sky key; the frontend falls back
	// to its built-in sky defaults when the key is absent.
	Sky *SkyConfig `json:"sky,omitempty"`
}

// SkyConfig drives the night-sky rendering (procedural Milky Way band and the
// zodiac constellation figures). Built deterministically by the world config
// builder and stored with the variant, so the frontend renders the sky purely
// from data instead of hardcoded constants.
type SkyConfig struct {
	MilkyWay       MilkyWayConfig      `json:"milkyWay"`
	Constellations ConstellationConfig `json:"constellations"`
}

// WeightedColor is one entry of a weighted color palette. Weights are relative
// probabilities; they do not need to sum to 1.
type WeightedColor struct {
	Color  string  `json:"color"`
	Weight float64 `json:"weight"`
}

type MilkyWayConfig struct {
	Seed                     string          `json:"seed"`
	AllSkyStarCount          int             `json:"allSkyStarCount"`
	BandStarCount            int             `json:"bandStarCount"`
	CoreStarCount            int             `json:"coreStarCount"`
	HeroStarCount            int             `json:"heroStarCount"`
	NebulaCloudCount         int             `json:"nebulaCloudCount"`
	CoreCloudCount           int             `json:"coreCloudCount"`
	DustCloudCount           int             `json:"dustCloudCount"`
	StarColors               []WeightedColor `json:"starColors"`
	CoreStarColors           []WeightedColor `json:"coreStarColors"`
	NebulaCloudColors        []WeightedColor `json:"nebulaCloudColors"`
	CoreCloudColors          []WeightedColor `json:"coreCloudColors"`
	DustCloudColors          []WeightedColor `json:"dustCloudColors"`
	NebulaCloudOpacity       float64         `json:"nebulaCloudOpacity"`
	CoreCloudOpacity         float64         `json:"coreCloudOpacity"`
	DustCloudOpacity         float64         `json:"dustCloudOpacity"`
	BandTiltXRadians         float64         `json:"bandTiltXRadians"`
	BandTiltZRadians         float64         `json:"bandTiltZRadians"`
	RotationRadiansPerSecond float64         `json:"rotationRadiansPerSecond"`
}

type ConstellationConfig struct {
	Seed                     string  `json:"seed"`
	DisplayCount             int     `json:"displayCount"`
	StarColor                string  `json:"starColor"`
	LineColor                string  `json:"lineColor"`
	GlowMultiplier           float64 `json:"glowMultiplier"`
	RotationRadiansPerSecond float64 `json:"rotationRadiansPerSecond"`
}

type Palette struct {
	Background string   `json:"background"`
	Primary    string   `json:"primary"`
	Secondary  string   `json:"secondary"`
	Accent     string   `json:"accent"`
	Gradient   []string `json:"gradient"`
}

type CoreConfig struct {
	Shape     string  `json:"shape"`
	Color     string  `json:"color"`
	Emissive  string  `json:"emissive"`
	Scale     float64 `json:"scale"`
	SpinSpeed float64 `json:"spinSpeed"`
}

type PlanetSceneConfig struct {
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Meaning     string  `json:"meaning"`
	Color       string  `json:"color"`
	Size        float64 `json:"size"`
	OrbitRadius float64 `json:"orbitRadius"`
	OrbitSpeed  float64 `json:"orbitSpeed"`
	Phase       float64 `json:"phase"`
	Energy      int     `json:"energy"`
}

type ParticleConfig struct {
	DesktopCount int     `json:"desktopCount"`
	MobileCount  int     `json:"mobileCount"`
	Color        string  `json:"color"`
	Spread       float64 `json:"spread"`
}

type CameraConfig struct {
	Distance float64 `json:"distance"`
	FOV      float64 `json:"fov"`
}

type PostFXConfig struct {
	BloomIntensity float64 `json:"bloomIntensity"`
}

type HUDConfig struct {
	ShowTraitBars bool `json:"showTraitBars"`
	ShowLabels    bool `json:"showLabels"`
}
