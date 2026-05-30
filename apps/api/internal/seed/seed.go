package seed

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
)

func NewWorldSeed() (string, error) {
	suffix, err := randomBase32(10)
	if err != nil {
		return "", err
	}
	return "WLD-" + suffix, nil
}

func NewVariantSeed(worldID string, variantNo int) (string, error) {
	suffix, err := randomBase32(4)
	if err != nil {
		return "", err
	}
	short := strings.ToUpper(strings.ReplaceAll(worldID, "-", ""))
	if len(short) > 3 {
		short = short[:3]
	}
	return fmt.Sprintf("VAR-%s-%d-%s", short, variantNo, suffix), nil
}

func randomBase32(length int) (string, error) {
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	if len(encoded) > length {
		encoded = encoded[:length]
	}
	return encoded, nil
}
