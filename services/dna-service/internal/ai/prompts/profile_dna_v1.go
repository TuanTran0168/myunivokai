package prompts

import (
	"fmt"
	"strings"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

const (
	ProfileDNATask = "profile_dna"
	SystemPrompt   = `You create a family-neutral semantic portrait called ProfileDNA.
Return only JSON matching the provided schema. Describe identity, traits, energy,
facets, palette intent and atmosphere. Never mention planets, forests, landmarks,
districts, coordinates, assets, renderers, cameras, or scene geometry.`
	RepairPrompt = "Return corrected JSON only. Keep facets family-neutral and satisfy every schema limit."
)

func UserPrompt(input contracts.WorldInput) string {
	return fmt.Sprintf(`Create ProfileDNA for this profile.
Nickname: %s
Role: %s
Interests: %s
Traits: %s
Goal: %s
Challenge: %s
Mood: %s
Favorite colors: %s
Preferred world style: %s`,
		input.Nickname,
		input.Role,
		strings.Join(input.Interests, ", "),
		strings.Join(input.Traits, ", "),
		input.Goal,
		input.Challenge,
		input.Mood,
		strings.Join(input.FavoriteColors, ", "),
		input.PreferredWorldStyle,
	)
}
