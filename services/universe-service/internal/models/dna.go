package models

type PersonalityDNA struct {
	SchemaVersion   string          `json:"schemaVersion"`
	Archetype       string          `json:"archetype"`
	SceneName       string          `json:"sceneName"`
	Quote           string          `json:"quote"`
	ShortNarrative  string          `json:"shortNarrative"`
	TraitScores     TraitScores     `json:"traitScores"`
	EnergySignature EnergySignature `json:"energySignature"`
	Planets         []DNAPlanet     `json:"planets"`
	VisualHints     VisualHints     `json:"visualHints"`
}

type TraitScores struct {
	Creativity int `json:"creativity"`
	Discipline int `json:"discipline"`
	Curiosity  int `json:"curiosity"`
	Energy     int `json:"energy"`
	Focus      int `json:"focus"`
}

type EnergySignature struct {
	Primary   string `json:"primary"`
	Secondary string `json:"secondary"`
	Intensity int    `json:"intensity"`
}

type DNAPlanet struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Meaning string `json:"meaning"`
	Energy  int    `json:"energy"`
}

type VisualHints struct {
	Theme         string `json:"theme"`
	CoreSymbol    string `json:"coreSymbol"`
	PaletteIntent string `json:"paletteIntent"`
	MotionIntent  string `json:"motionIntent"`
}
