package models

// ForestSceneConfig is the stored scene contract for the forest family.
// Renderers are keyed by (sceneType, schemaVersion). The config deliberately
// stays small (~3-4 KB): only semantic and hero placements are stored
// (landmarks); mass scatter — trees, grass, particles, paths — is derived
// frontend-side from the placement/path seeds embedded here, the same pattern
// universe-service uses for its Milky Way sky.
type ForestSceneConfig struct {
	SchemaVersion string  `json:"schemaVersion"`
	SceneType     string  `json:"sceneType"`
	SceneName     string  `json:"sceneName"`
	Archetype     string  `json:"archetype"`
	Quote         string  `json:"quote"`
	Theme         string  `json:"theme"`
	Palette       Palette `json:"palette"`

	Season           SeasonConfig           `json:"season"`
	Lighting         LightingConfig         `json:"lighting"`
	Terrain          TerrainConfig          `json:"terrain"`
	Trees            TreesConfig            `json:"trees"`
	Weather          WeatherConfig          `json:"weather"`
	Wildlife         WildlifeConfig         `json:"wildlife"`
	AmbientParticles AmbientParticlesConfig `json:"ambientParticles"`
	Landmarks        []LandmarkSceneConfig  `json:"landmarks"`

	Camera CameraConfig `json:"camera"`
	PostFX PostFXConfig `json:"postFX"`
	HUD    HUDConfig    `json:"hud"`
	Assets AssetsConfig `json:"assets"`
}

// SeasonConfig drives the whole seasonal dressing. BlendTowardKind/BlendAmount
// model "giao mùa": when set, the renderer lerps tint, ground and particle
// counts toward the adjacent season by BlendAmount.
type SeasonConfig struct {
	Kind            string   `json:"kind"`
	BlendTowardKind string   `json:"blendTowardKind,omitempty"`
	BlendAmount     float64  `json:"blendAmount,omitempty"`
	FoliageColors   []string `json:"foliageColors"`
	GroundKind      string   `json:"groundKind"`
}

type LightingConfig struct {
	TimeOfDay           string  `json:"timeOfDay"`
	SunElevationRadians float64 `json:"sunElevationRadians"`
	SunAzimuthRadians   float64 `json:"sunAzimuthRadians"`
	SunColor            string  `json:"sunColor"`
	AmbientColor        string  `json:"ambientColor"`
	HdriKey             string  `json:"hdriKey"`
	Exposure            float64 `json:"exposure"`
	FogColor            string  `json:"fogColor"`
	FogDensity          float64 `json:"fogDensity"`
}

type TerrainConfig struct {
	// PlacementSeed feeds the frontend's deterministic scatter of rocks and
	// grass; the backend only decides the counts and bounds.
	PlacementSeed         string  `json:"placementSeed"`
	ClearingRadius        float64 `json:"clearingRadius"`
	TreelineRadius        float64 `json:"treelineRadius"`
	HillAmplitude         float64 `json:"hillAmplitude"`
	HillFrequency         float64 `json:"hillFrequency"`
	PathEnabled           bool    `json:"pathEnabled"`
	RockCount             int     `json:"rockCount"`
	GrassTuftCountDesktop int     `json:"grassTuftCountDesktop"`
	GrassTuftCountMobile  int     `json:"grassTuftCountMobile"`
}

type TreeSpeciesMixEntry struct {
	ModelKey string  `json:"modelKey"`
	Weight   float64 `json:"weight"`
}

type TreesConfig struct {
	PlacementSeed        string                `json:"placementSeed"`
	CountDesktop         int                   `json:"countDesktop"`
	CountMobile          int                   `json:"countMobile"`
	SpeciesMix           []TreeSpeciesMixEntry `json:"speciesMix"`
	ScaleMin             float64               `json:"scaleMin"`
	ScaleMax             float64               `json:"scaleMax"`
	FoliageTintStrength  float64               `json:"foliageTintStrength"`
	WindStrength         float64               `json:"windStrength"`
	WindDirectionRadians float64               `json:"windDirectionRadians"`
	WindGustFrequency    float64               `json:"windGustFrequency"`
}

// WeatherConfig: particle counts are zero unless Kind matches (rain counts for
// "rain", snowflake counts for "snow"), so the renderer never guesses.
type WeatherConfig struct {
	Kind                  string  `json:"kind"`
	Intensity             float64 `json:"intensity"`
	CloudCoverage         float64 `json:"cloudCoverage"`
	RainDropCountDesktop  int     `json:"rainDropCountDesktop"`
	RainDropCountMobile   int     `json:"rainDropCountMobile"`
	SnowflakeCountDesktop int     `json:"snowflakeCountDesktop"`
	SnowflakeCountMobile  int     `json:"snowflakeCountMobile"`
}

type GroundAnimalConfig struct {
	ModelKey string `json:"modelKey"`
	Count    int    `json:"count"`
	// PathSeed feeds the frontend's deterministic walk-loop generation for
	// this animal slot.
	PathSeed  string  `json:"pathSeed"`
	WalkSpeed float64 `json:"walkSpeed"`
	Scale     float64 `json:"scale"`
}

type BirdFlockConfig struct {
	ModelKey    string  `json:"modelKey"`
	BirdCount   int     `json:"birdCount"`
	PathSeed    string  `json:"pathSeed"`
	AltitudeMin float64 `json:"altitudeMin"`
	AltitudeMax float64 `json:"altitudeMax"`
	FlightSpeed float64 `json:"flightSpeed"`
	Pattern     string  `json:"pattern"`
}

type WildlifeConfig struct {
	GroundAnimals []GroundAnimalConfig `json:"groundAnimals"`
	BirdFlocks    []BirdFlockConfig    `json:"birdFlocks"`
}

// AmbientParticlesConfig: at most one seasonal system is non-zero — falling
// leaves in autumn, blossom petals in spring, fireflies on summer dusks, snow
// dust in winter (weather snowfall is separate, under WeatherConfig).
type AmbientParticlesConfig struct {
	FallingLeafCount  int `json:"fallingLeafCount"`
	BlossomPetalCount int `json:"blossomPetalCount"`
	FireflyCount      int `json:"fireflyCount"`
	SnowDustCount     int `json:"snowDustCount"`
}

// LandmarkSceneConfig is the forest counterpart of a planet scene config: the
// clickable POI layer. Placement is polar around the clearing center and is
// stored (not derived) because landmarks are the hero layer of the portrait.
type LandmarkSceneConfig struct {
	Key              string  `json:"key"`
	Name             string  `json:"name"`
	Meaning          string  `json:"meaning"`
	Kind             string  `json:"kind"`
	AngleRadians     float64 `json:"angleRadians"`
	RadiusFromCenter float64 `json:"radiusFromCenter"`
	AccentColor      string  `json:"accentColor"`
	Energy           int     `json:"energy"`
}

type Palette struct {
	Background string   `json:"background"`
	Primary    string   `json:"primary"`
	Secondary  string   `json:"secondary"`
	Accent     string   `json:"accent"`
	Gradient   []string `json:"gradient"`
}

type CameraConfig struct {
	Distance float64 `json:"distance"`
	FOV      float64 `json:"fov"`
}

type PostFXGradeConfig struct {
	HueRadians float64 `json:"hueRadians"`
	Saturation float64 `json:"saturation"`
	Brightness float64 `json:"brightness"`
	Contrast   float64 `json:"contrast"`
}

// PostFXConfig: unlike universe-service (where the grade arrived in a later
// schema version and is a pointer), forest configs carry a grade from 1.0, so
// the field is a plain value.
type PostFXConfig struct {
	BloomIntensity float64           `json:"bloomIntensity"`
	Grade          PostFXGradeConfig `json:"grade"`
}

type HUDConfig struct {
	ShowTraitBars bool `json:"showTraitBars"`
	ShowLabels    bool `json:"showLabels"`
}

// AssetsConfig pins which catalog resolved the model keys, and lists every GLB
// key the config references so the renderer can preload deterministically.
type AssetsConfig struct {
	CatalogVersion string   `json:"catalogVersion"`
	ModelKeys      []string `json:"modelKeys"`
	HdriKey        string   `json:"hdriKey"`
}
