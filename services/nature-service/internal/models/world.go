package models

import "time"

// WorldInput keeps the exact same field set as universe-service so the future
// create form (and the gateway) can reuse one client payload shape across both
// services.
type WorldInput struct {
	Nickname            string   `json:"nickname"`
	Role                string   `json:"role,omitempty"`
	Interests           []string `json:"interests"`
	Traits              []string `json:"traits"`
	Goal                string   `json:"goal"`
	Challenge           string   `json:"challenge,omitempty"`
	Mood                string   `json:"mood"`
	FavoriteColors      []string `json:"favoriteColors"`
	PreferredWorldStyle string   `json:"preferredWorldStyle"`
}

type World struct {
	ID                string     `json:"id"`
	Nickname          string     `json:"nickname"`
	Role              string     `json:"role,omitempty"`
	Input             WorldInput `json:"-"`
	NatureDNA         NatureDNA  `json:"-"`
	Archetype         string     `json:"archetype"`
	SceneName         string     `json:"sceneName"`
	Quote             string     `json:"quote"`
	ShortNarrative    string     `json:"shortNarrative,omitempty"`
	Visibility        string     `json:"visibility"`
	ShareSlug         *string    `json:"shareSlug"`
	SelectedVariantID *string    `json:"selectedVariantId,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type WorldVariant struct {
	ID           string            `json:"id"`
	WorldID      string            `json:"worldId,omitempty"`
	VariantNo    int               `json:"variantNo"`
	Seed         string            `json:"seed"`
	Config       ForestSceneConfig `json:"config"`
	ThumbnailURL string            `json:"thumbnailUrl,omitempty"`
	IsSelected   bool              `json:"isSelected"`
	CreatedAt    time.Time         `json:"createdAt"`
}

type AIGenerationLog struct {
	Provider      string
	Model         string
	Task          string
	PromptVersion string
	InputHash     string
	RequestJSON   []byte
	ResponseJSON  []byte
	UsageJSON     []byte
	LatencyMS     int
	Status        string
	Error         string
}
