package prompts

import (
	"fmt"
	"strings"

	"github.com/myunivokai/myunivokai/services/nature-service/internal/models"
)

const ForestDNATask = "forest-dna-v1"

const ForestDNASystemPrompt = "You are Myunivokai's Nature DNA engine. Convert a user's self-described profile into a structured, positive, visually useful nature DNA object for a personal forest scene. Landmarks are meaningful places in the user's forest (a heart tree, a still pond, a standing stone...). Return only JSON matching the provided schema. Do not include markdown. Do not diagnose mental health. Do not make deterministic claims about the user's future. Keep the tone imaginative, warm, and concise."

func ForestDNAUserPrompt(input models.WorldInput) string {
	return fmt.Sprintf(`Generate Nature DNA for this user profile.

Nickname: %s
Role: %s
Interests: %s
Traits: %s
Goal: %s
Challenge: %s
Mood: %s
Favorite colors: %s
Preferred world style: %s

Rules:
- Return 3 to 7 landmarks.
- Trait scores must be integers from 0 to 100.
- Quote must be under 100 characters.
- Narrative must be under 240 characters.
- Landmark meanings must be positive and specific.
- Do not reveal or repeat sensitive challenge text directly.`,
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

const RepairPrompt = "Your previous output did not match the required schema. Return a corrected JSON object only. Do not include explanations. Use the same intended meaning but fix schema/type/range issues."
