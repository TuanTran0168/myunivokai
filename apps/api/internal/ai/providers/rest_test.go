package providers

import (
	"testing"

	"github.com/myunivokai/myunivokai/apps/api/internal/validation"
)

func assertNoUnsupportedGeminiKeys(t *testing.T, schema map[string]any, path string) {
	t.Helper()
	for schemaKey, schemaValue := range schema {
		if schemaKey == "properties" {
			propertyMap, ok := schemaValue.(map[string]any)
			if !ok {
				t.Fatalf("%s.properties is not an object", path)
			}
			for propertyName, propertySchema := range propertyMap {
				propertySchemaMap, ok := propertySchema.(map[string]any)
				if !ok {
					t.Fatalf("%s.properties.%s is not an object", path, propertyName)
				}
				assertNoUnsupportedGeminiKeys(t, propertySchemaMap, path+".properties."+propertyName)
			}
			continue
		}
		if schemaKey == "items" {
			itemsSchemaMap, ok := schemaValue.(map[string]any)
			if !ok {
				t.Fatalf("%s.items is not an object", path)
			}
			assertNoUnsupportedGeminiKeys(t, itemsSchemaMap, path+".items")
			continue
		}
		if !geminiSupportedSchemaKeys[schemaKey] {
			t.Fatalf("unsupported key %q survived sanitize at %s", schemaKey, path)
		}
	}
}

func TestSanitizeSchemaForGeminiStripsUnsupportedKeysRecursively(t *testing.T) {
	sanitized := sanitizeSchemaForGemini(validation.PersonalityDNASchema())
	assertNoUnsupportedGeminiKeys(t, sanitized, "root")

	properties, ok := sanitized["properties"].(map[string]any)
	if !ok {
		t.Fatal("sanitized schema lost its properties")
	}
	planets, ok := properties["planets"].(map[string]any)
	if !ok {
		t.Fatal("sanitized schema lost the planets property")
	}
	planetItems, ok := planets["items"].(map[string]any)
	if !ok {
		t.Fatal("sanitized planets schema lost items")
	}
	if _, hasAdditionalProperties := planetItems["additionalProperties"]; hasAdditionalProperties {
		t.Fatal("additionalProperties survived inside array items")
	}
	if _, hasRequired := planetItems["required"]; !hasRequired {
		t.Fatal("required was wrongly stripped from array items")
	}
}
