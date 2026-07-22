package db

import (
	"database/sql"
	"errors"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func Migrate(databaseURL, migrationsDirectory string) error {
	if databaseURL == "" {
		return errors.New("database url is required for migrations")
	}
	connection, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}
	defer connection.Close()
	return goose.Up(connection, migrationsDirectory)
}
