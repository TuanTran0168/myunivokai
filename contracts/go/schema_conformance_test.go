package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/myunivokai/myunivokai/contracts/go/schemavalidation"
)

// A schema nothing is checked against is a comment.
//
// TestJSONSchemasAreValidDocuments proves the schema FILES parse; it has never
// proved that any payload conforms to them. That gap is exactly the drift the
// contracts module exists to prevent: a family builder can widen a range, drop
// a field or bump a version and every Go test still passes, because the only
// consumer of the shape is a TypeScript renderer in another module.
//
// The fixtures checked here are the executable form of each contract. The
// forest scene schema says so in its own description, naming the nature-service
// golden files; this test is what makes that sentence true.

const (
	messageEnvelopeSchemaPath = "../schemas/message-envelope.schema.json"
	worldInputSchemaPath      = "../schemas/world-input.schema.json"
	profileDNASchemaPath      = "../schemas/profile-dna.schema.json"
	personalityDNASchemaPath  = "../schemas/personality-dna.schema.json"
	forestSceneSchemaPath     = "../scenes/forest-scene-config.schema.json"

	// world-input declares no $id, so the compiler needs an identity for it.
	// Anything stable works; this mirrors the $id style the other schemas use.
	worldInputSchemaURL = "https://myunivokai.local/contracts/world-input.schema.json"

	// profile-dna.schema.json is an alias: its whole body is a relative $ref to
	// personality-dna.schema.json, which resolves against the alias's own host.
	// The referenced document declares a DIFFERENT $id, so it has to be
	// registered under the URL the ref actually asks for.
	personalityDNAReferenceURL = "https://myunivokai.local/contracts/personality-dna.schema.json"

	forestGoldenSceneGlob = "../../services/nature-service/internal/services/testdata/forest-golden-*.json"
)

func TestContractFixturesConformToTheEnvelopeSchema(t *testing.T) {
	validator := compileSchema(t, messageEnvelopeSchemaPath, "")
	for _, fixturePath := range contractFixturePaths(t) {
		if err := validator.Validate(readFixture(t, fixturePath)); err != nil {
			t.Errorf("%s violates the envelope schema:\n%v", fixturePath, err)
		}
	}
}

func TestGenerateCommandInputConformsToTheWorldInputSchema(t *testing.T) {
	validator := compileSchema(t, worldInputSchemaPath, worldInputSchemaURL)
	var envelope struct {
		Data struct {
			Input json.RawMessage `json:"input"`
		} `json:"data"`
	}
	fixturePath := "../fixtures/dna-generate-command.v1.json"
	if err := json.Unmarshal(readFixture(t, fixturePath), &envelope); err != nil {
		t.Fatalf("decode %s: %v", fixturePath, err)
	}
	if len(envelope.Data.Input) == 0 {
		t.Fatalf("%s carries no data.input to validate", fixturePath)
	}
	if err := validator.Validate(envelope.Data.Input); err != nil {
		t.Errorf("%s data.input violates the world input schema:\n%v", fixturePath, err)
	}
}

func TestComposeCommandProfileDNAConformsToTheProfileDNASchema(t *testing.T) {
	validator := compileSchema(t, profileDNASchemaPath, "", schemavalidation.Reference{
		URL:     personalityDNAReferenceURL,
		Payload: readFixture(t, personalityDNASchemaPath),
	})
	var envelope struct {
		Data struct {
			ProfileDNA json.RawMessage `json:"profileDNA"`
		} `json:"data"`
	}
	fixturePath := "../fixtures/universe-compose-command.v1.json"
	if err := json.Unmarshal(readFixture(t, fixturePath), &envelope); err != nil {
		t.Fatalf("decode %s: %v", fixturePath, err)
	}
	if len(envelope.Data.ProfileDNA) == 0 {
		t.Fatalf("%s carries no data.profileDNA to validate", fixturePath)
	}
	if err := validator.Validate(envelope.Data.ProfileDNA); err != nil {
		t.Errorf("%s data.profileDNA violates the ProfileDNA schema:\n%v", fixturePath, err)
	}
}

func TestForestGoldenScenesConformToTheSceneContract(t *testing.T) {
	validator := compileSchema(t, forestSceneSchemaPath, "")
	goldenPaths, err := filepath.Glob(forestGoldenSceneGlob)
	if err != nil {
		t.Fatalf("glob %s: %v", forestGoldenSceneGlob, err)
	}
	// A glob that silently matches nothing is the failure mode this whole test
	// is meant to remove: it would report success while checking no scene at all.
	if len(goldenPaths) == 0 {
		t.Fatalf("no golden forest scenes matched %s — the fixtures moved and nothing is validating the scene contract", forestGoldenSceneGlob)
	}
	for _, goldenPath := range goldenPaths {
		if err := validator.Validate(readFixture(t, goldenPath)); err != nil {
			t.Errorf("%s violates the forest scene contract:\n%v", goldenPath, err)
		}
	}
}

// Without this, a validator that accepted everything would make every test
// above pass, and the suite would be worse than no suite: it would license the
// belief that the contracts are enforced.
func TestSchemaValidationRejectsBrokenScenes(t *testing.T) {
	validator := compileSchema(t, forestSceneSchemaPath, "")
	goldenPaths, err := filepath.Glob(forestGoldenSceneGlob)
	if err != nil || len(goldenPaths) == 0 {
		t.Fatalf("need at least one golden forest scene to mutate: %v", err)
	}
	var scene map[string]any
	if err := json.Unmarshal(readFixture(t, goldenPaths[0]), &scene); err != nil {
		t.Fatalf("decode %s: %v", goldenPaths[0], err)
	}

	mutations := map[string]func(map[string]any){
		"missing required section": func(document map[string]any) {
			delete(document, "terrain")
		},
		"numeric field outside its documented range": func(document map[string]any) {
			document["terrain"].(map[string]any)["clearingRadius"] = 50
		},
		"colour that is not a hex triplet": func(document map[string]any) {
			document["palette"].(map[string]any)["primary"] = "forest green"
		},
		"unknown enum member": func(document map[string]any) {
			document["season"].(map[string]any)["kind"] = "monsoon"
		},
		"schema version bumped without updating the contract": func(document map[string]any) {
			document["schemaVersion"] = "9.9"
		},
	}
	for mutationName, mutate := range mutations {
		t.Run(mutationName, func(t *testing.T) {
			mutated := cloneDocument(t, scene)
			mutate(mutated)
			mutatedPayload, err := json.Marshal(mutated)
			if err != nil {
				t.Fatalf("encode mutated scene: %v", err)
			}
			if err := validator.Validate(mutatedPayload); err == nil {
				t.Fatal("expected the schema to reject this scene, but it passed")
			}
		})
	}
}

func compileSchema(
	t *testing.T,
	schemaPath, resourceURL string,
	references ...schemavalidation.Reference,
) *schemavalidation.Validator {
	t.Helper()
	if resourceURL == "" {
		resourceURL = schemaIdentifier(t, schemaPath)
	}
	validator, err := schemavalidation.New(resourceURL, readFixture(t, schemaPath), references...)
	if err != nil {
		t.Fatalf("compile %s: %v", schemaPath, err)
	}
	return validator
}

func schemaIdentifier(t *testing.T, schemaPath string) string {
	t.Helper()
	var schemaDocument struct {
		ID string `json:"$id"`
	}
	if err := json.Unmarshal(readFixture(t, schemaPath), &schemaDocument); err != nil {
		t.Fatalf("decode %s: %v", schemaPath, err)
	}
	if schemaDocument.ID == "" {
		t.Fatalf("%s declares no $id; pass an explicit resource URL", schemaPath)
	}
	return schemaDocument.ID
}

func contractFixturePaths(t *testing.T) []string {
	t.Helper()
	fixturePaths, err := filepath.Glob("../fixtures/*.json")
	if err != nil {
		t.Fatalf("glob fixtures: %v", err)
	}
	if len(fixturePaths) == 0 {
		t.Fatal("no contract fixtures found")
	}
	return fixturePaths
}

func readFixture(t *testing.T, path string) []byte {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return payload
}

func cloneDocument(t *testing.T, document map[string]any) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("encode document: %v", err)
	}
	var clone map[string]any
	if err := json.Unmarshal(encoded, &clone); err != nil {
		t.Fatalf("decode document: %v", err)
	}
	return clone
}
