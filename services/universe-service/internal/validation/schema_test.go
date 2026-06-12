package validation

import "testing"

// OpenAI structured outputs in strict mode require every object node to set
// additionalProperties=false and to list every property as required. This test
// locks that invariant so future schema edits cannot silently break OpenAI.
func assertOpenAIStrictObject(t *testing.T, schema map[string]any, path string) {
	t.Helper()
	schemaType, _ := schema["type"].(string)

	if schemaType == "object" {
		additionalProperties, declared := schema["additionalProperties"]
		if !declared || additionalProperties != false {
			t.Fatalf("%s: object must declare additionalProperties=false for OpenAI strict mode", path)
		}
		propertyMap, hasProperties := schema["properties"].(map[string]any)
		if !hasProperties {
			t.Fatalf("%s: object must declare properties for OpenAI strict mode", path)
		}
		requiredNames, _ := schema["required"].([]string)
		if len(requiredNames) != len(propertyMap) {
			t.Fatalf("%s: required must list every property (required=%d, properties=%d)", path, len(requiredNames), len(propertyMap))
		}
		for propertyName, propertySchema := range propertyMap {
			propertySchemaMap, ok := propertySchema.(map[string]any)
			if !ok {
				t.Fatalf("%s.properties.%s is not an object schema", path, propertyName)
			}
			assertOpenAIStrictObject(t, propertySchemaMap, path+"."+propertyName)
		}
	}

	if schemaType == "array" {
		itemsSchemaMap, ok := schema["items"].(map[string]any)
		if !ok {
			t.Fatalf("%s: array must declare an items schema", path)
		}
		assertOpenAIStrictObject(t, itemsSchemaMap, path+".items")
	}
}

func TestPersonalityDNASchemaSatisfiesOpenAIStrictMode(t *testing.T) {
	assertOpenAIStrictObject(t, PersonalityDNASchema(), "root")
}
