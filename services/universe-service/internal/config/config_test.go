package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestLoadDefaults(t *testing.T) {
	t.Setenv("AI_PROVIDER", "")
	t.Setenv("DATABASE_URL", "")
	cfg := Load()
	if cfg.AIProvider != "mock" {
		t.Fatalf("expected mock provider, got %s", cfg.AIProvider)
	}
	if cfg.AITimeout != 35*time.Second {
		t.Fatalf("expected 35s timeout, got %s", cfg.AITimeout)
	}
	if cfg.DatabaseURL != "" {
		t.Fatalf("expected empty database url")
	}
}

func TestLoadEnvDevFile(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, ".env.dev"), "APP_NAME=FromDev\nAPI_PORT=9001\n")
	chdir(t, dir)
	t.Setenv("APP_ENV", "dev")
	unsetenv(t, "APP_NAME")
	unsetenv(t, "API_PORT")

	cfg := Load()
	if cfg.AppName != "FromDev" {
		t.Fatalf("expected app name from .env.dev, got %q", cfg.AppName)
	}
	if cfg.APIPort != "9001" {
		t.Fatalf("expected port from .env.dev, got %q", cfg.APIPort)
	}
}

func TestLoadExplicitEnvFile(t *testing.T) {
	dir := t.TempDir()
	envFile := filepath.Join(dir, ".env.prod")
	writeFile(t, envFile, "APP_ENV=production\nAPP_NAME=FromProd\n")
	chdir(t, dir)
	t.Setenv("MYUNIVOKAI_ENV_FILE", envFile)
	unsetenv(t, "APP_ENV")
	unsetenv(t, "APP_NAME")

	cfg := Load()
	if cfg.AppEnv != "production" {
		t.Fatalf("expected production env, got %q", cfg.AppEnv)
	}
	if cfg.AppName != "FromProd" {
		t.Fatalf("expected app name from explicit env file, got %q", cfg.AppName)
	}
}

func TestLoadEnvAlias(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, ".env.prod"), "APP_NAME=FromProdAlias\n")
	chdir(t, dir)
	unsetenv(t, "APP_ENV")
	t.Setenv("ENV", "prod")
	unsetenv(t, "APP_NAME")

	cfg := Load()
	if cfg.AppEnv != "prod" {
		t.Fatalf("expected ENV alias to set app env, got %q", cfg.AppEnv)
	}
	if cfg.AppName != "FromProdAlias" {
		t.Fatalf("expected app name from .env.prod, got %q", cfg.AppName)
	}
}

func TestLoadEnvFileLayeringKeepsProcessEnv(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, ".env"), "APP_NAME=FromBase\nAPI_PORT=8000\n")
	writeFile(t, filepath.Join(dir, ".env.dev"), "APP_NAME=FromDev\nAPI_PORT=9001\n")
	chdir(t, dir)
	t.Setenv("APP_ENV", "dev")
	t.Setenv("APP_NAME", "FromProcess")
	unsetenv(t, "API_PORT")

	cfg := Load()
	if cfg.AppName != "FromProcess" {
		t.Fatalf("expected process env to win, got %q", cfg.AppName)
	}
	if cfg.APIPort != "9001" {
		t.Fatalf("expected .env.dev to override .env, got %q", cfg.APIPort)
	}
}

func chdir(t *testing.T, dir string) {
	t.Helper()
	old, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(old)
	})
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func unsetenv(t *testing.T, key string) {
	t.Helper()
	old, ok := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if ok {
			_ = os.Setenv(key, old)
		} else {
			_ = os.Unsetenv(key)
		}
	})
}
