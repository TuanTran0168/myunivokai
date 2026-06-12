package seed

import (
	"strings"
	"testing"
)

func TestNewWorldSeed(t *testing.T) {
	value, err := NewWorldSeed()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(value, "WLD-") || len(value) != 14 {
		t.Fatalf("unexpected world seed %q", value)
	}
}

func TestPRNGDeterministic(t *testing.T) {
	a := NewPRNG("WLD-ABC").Float64()
	b := NewPRNG("WLD-ABC").Float64()
	if a != b {
		t.Fatalf("expected deterministic PRNG")
	}
}
