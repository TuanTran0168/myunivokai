package main

import (
	"os"
	"strings"

	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/db"
	"github.com/rs/zerolog/log"
)

const defaultMigrationsDirectory = "migrations"

func main() {
	serviceConfig, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("load dna service configuration")
	}
	databaseURL := serviceConfig.DatabaseDirectURL
	if strings.TrimSpace(databaseURL) == "" {
		databaseURL = serviceConfig.DatabaseURL
	}
	migrationsDirectory := strings.TrimSpace(os.Getenv("MIGRATIONS_DIR"))
	if migrationsDirectory == "" {
		migrationsDirectory = defaultMigrationsDirectory
	}
	if err := db.Migrate(databaseURL, migrationsDirectory); err != nil {
		log.Fatal().Err(err).Msg("run dna database migrations")
	}
}
