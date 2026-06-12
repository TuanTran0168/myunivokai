package seed

import (
	"hash/fnv"
	"math/rand"
)

func NewPRNG(seed string) *rand.Rand {
	h := fnv.New64a()
	_, _ = h.Write([]byte(seed))
	return rand.New(rand.NewSource(int64(h.Sum64())))
}
