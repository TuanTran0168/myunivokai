package prompts

import (
	"fmt"
	"strings"

	"github.com/myunivokai/myunivokai/apps/api/internal/models"
)

const WorldDNATask = "world-dna-v1"

const WorldDNASystemPrompt = "You are Myunivokai's Personality DNA engine. Convert a user's self-described profile into a structured, positive, visually useful personality DNA object. Return only JSON matching the provided schema. Do not include markdown. Do not diagnose mental health. Do not make deterministic claims about the user's future. Keep the tone imaginative, warm, and concise."

func WorldDNAUserPrompt(input models.WorldInput) string {
	return fmt.Sprintf(`Generate Personality DNA for this user profile.

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
- Return 3 to 7 planets.
- Trait scores must be integers from 0 to 100.
- Quote must be under 100 characters.
- Narrative must be under 240 characters.
- Planet meanings must be positive and specific.
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
