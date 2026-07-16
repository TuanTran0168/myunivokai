package seed

import (
	"strings"
	"testing"
)

func TestNewWorldSeedPrefixAndUniqueness(t *testing.T) {
	seen := map[string]bool{}
	for index := 0; index < 100; index++ {
		worldSeed, err := NewWorldSeed()
		if err != nil {
			t.Fatalf("NewWorldSeed: %v", err)
		}
		if !strings.HasPrefix(worldSeed, "NAT-") {
			t.Fatalf("world seed %q must carry the NAT- prefix", worldSeed)
		}
		if seen[worldSeed] {
			t.Fatalf("world seed %q repeated", worldSeed)
		}
		seen[worldSeed] = true
	}
}

func TestNewVariantSeedFormat(t *testing.T) {
	variantSeed, err := NewVariantSeed("0f2a7c1e-1234-5678-9abc-def012345678", 3)
	if err != nil {
		t.Fatalf("NewVariantSeed: %v", err)
	}
	if !strings.HasPrefix(variantSeed, "VAR-0F2-3-") {
		t.Fatalf("variant seed %q must embed the short world id and variant number", variantSeed)
	}
}

func TestNewPRNGIsDeterministicPerSeedString(t *testing.T) {
	first := NewPRNG("NAT-TEST")
	second := NewPRNG("NAT-TEST")
	for draw := 0; draw < 5; draw++ {
		if first.Float64() != second.Float64() {
			t.Fatalf("same seed must produce the same sequence")
		}
	}
	base := NewPRNG("NAT-TEST")
	suffixed := NewPRNG("NAT-TEST-forest-season")
	if base.Float64() == suffixed.Float64() {
		t.Fatalf("a suffixed stream must diverge from the base stream")
	}
}
