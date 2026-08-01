// Package schemavalidation compiles the repository's JSON Schema contracts and
// checks documents against them.
//
// It is deliberately a separate package from contracts: every service imports
// the contracts types, and none of them should inherit a schema compiler in
// their build graph just to use an envelope struct.
package schemavalidation

import (
	"bytes"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

type Validator struct {
	schema *jsonschema.Schema
}

// Reference is a schema a compiled schema points at. Nothing here fetches over
// the network: a $ref to an unregistered URL is a compile error, not a silent
// download, so the contracts a document is checked against are always the ones
// in this repository.
type Reference struct {
	URL     string
	Payload []byte
}

// New compiles schemaPayload. resourceURL is the identity that the schema's own
// internal references resolve against; pass the schema's $id when it declares
// one, and any stable URL when it does not. Pass every schema it $refs as a
// Reference, keyed by the URL that ref resolves to.
//
// Format keywords are asserted rather than treated as annotations. Left at the
// specification default, "format": "date-time" would accept any string at all,
// which makes a timestamp contract worthless.
func New(resourceURL string, schemaPayload []byte, references ...Reference) (*Validator, error) {
	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat()
	for _, reference := range references {
		if err := addResource(compiler, reference.URL, reference.Payload); err != nil {
			return nil, err
		}
	}
	if err := addResource(compiler, resourceURL, schemaPayload); err != nil {
		return nil, err
	}
	compiledSchema, err := compiler.Compile(resourceURL)
	if err != nil {
		return nil, fmt.Errorf("compile schema %s: %w", resourceURL, err)
	}
	return &Validator{schema: compiledSchema}, nil
}

func addResource(compiler *jsonschema.Compiler, resourceURL string, schemaPayload []byte) error {
	schemaDocument, err := jsonschema.UnmarshalJSON(bytes.NewReader(schemaPayload))
	if err != nil {
		return fmt.Errorf("decode schema %s: %w", resourceURL, err)
	}
	if err := compiler.AddResource(resourceURL, schemaDocument); err != nil {
		return fmt.Errorf("register schema %s: %w", resourceURL, err)
	}
	return nil
}

// Validate reports every keyword the document violates, not only the first.
func (validator *Validator) Validate(documentPayload []byte) error {
	document, err := jsonschema.UnmarshalJSON(bytes.NewReader(documentPayload))
	if err != nil {
		return fmt.Errorf("decode document: %w", err)
	}
	return validator.schema.Validate(document)
}
