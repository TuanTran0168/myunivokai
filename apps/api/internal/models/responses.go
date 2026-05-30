package models

type CreateWorldResponse struct {
	World          World          `json:"world"`
	Variant        WorldVariant   `json:"variant"`
	PersonalityDNA PersonalityDNA `json:"personalityDNA"`
}

type WorldResponse struct {
	World           World          `json:"world"`
	SelectedVariant WorldVariant   `json:"selectedVariant"`
	Variants        []WorldVariant `json:"variants"`
	PersonalityDNA  PersonalityDNA `json:"personalityDNA"`
}

type VariantResponse struct {
	Variant WorldVariant `json:"variant"`
}

type PublishResponse struct {
	ShareSlug string `json:"shareSlug"`
	ShareURL  string `json:"shareUrl"`
}

type PublicWorldResponse struct {
	World     PublicWorld   `json:"world"`
	Variant   PublicVariant `json:"variant"`
	PublicDNA PublicDNA     `json:"publicDNA"`
}

type PublicWorld struct {
	Nickname       string `json:"nickname"`
	Archetype      string `json:"archetype"`
	SceneName      string `json:"sceneName"`
	Quote          string `json:"quote"`
	ShortNarrative string `json:"shortNarrative"`
}

type PublicVariant struct {
	Seed   string           `json:"seed"`
	Config WorldSceneConfig `json:"config"`
}

type PublicDNA struct {
	TraitScores TraitScores `json:"traitScores"`
	Planets     []DNAPlanet `json:"planets"`
}
