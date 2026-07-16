package models

// NatureDNA mirrors universe-service's PersonalityDNA envelope. The only
// structural difference is the semantic layer: a forest world is anchored by
// landmarks (clickable places around the clearing) instead of planets. The AI
// produces semantics only — names, meanings, energies — never visual numbers;
// those come deterministically from the seed in the forest config builder.
type NatureDNA struct {
	SchemaVersion   string          `json:"schemaVersion"`
	Archetype       string          `json:"archetype"`
	SceneName       string          `json:"sceneName"`
	Quote           string          `json:"quote"`
	ShortNarrative  string          `json:"shortNarrative"`
	TraitScores     TraitScores     `json:"traitScores"`
	EnergySignature EnergySignature `json:"energySignature"`
	Landmarks       []DNALandmark   `json:"landmarks"`
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

// DNALandmark is the forest counterpart of a DNA planet: one meaningful place
// in the user's forest, named from their own interests/traits.
type DNALandmark struct {
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
