package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/myunivokai/myunivokai/services/dna-service/internal/config"
)

func Connect(ctx context.Context, serviceConfig config.Config) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(serviceConfig.DatabaseURL)
	if err != nil {
		return nil, err
	}
	poolConfig.MaxConns = int32(serviceConfig.DatabaseMaximumConnections)
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
