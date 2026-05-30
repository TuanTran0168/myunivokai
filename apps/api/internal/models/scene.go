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
