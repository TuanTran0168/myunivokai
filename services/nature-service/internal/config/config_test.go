package config

import (
	"strings"
	"testing"
)

func TestProductionRequiresGatewaySecret(t *testing.T) {
	config := Config{AppEnv: "production"}
	if err := config.ValidateProductionGatewayAccess(); err == nil {
		t.Fatal("expected production config without gateway secret to fail")
	}
	config.GatewaySharedSecret = strings.Repeat("s", minimumGatewaySharedSecretLength)
	if err := config.ValidateProductionGatewayAccess(); err != nil {
		t.Fatalf("valid production gateway secret rejected: %v", err)
	}
}
