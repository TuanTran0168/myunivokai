package repositories

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/myunivokai/myunivokai/services/universe-service/internal/models"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

func (s *PostgresStore) CreateWorld(ctx context.Context, world models.World, variant models.WorldVariant, logs []models.AIGenerationLog) (WorldBundle, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorldBundle{}, err
	}
	defer tx.Rollback(ctx)
	inputJSON, _ := json.Marshal(world.Input)
	dnaJSON, _ := json.Marshal(world.PersonalityDNA)
	configJSON, _ := json.Marshal(variant.Config)
	row := tx.QueryRow(ctx, `INSERT INTO worlds (nickname, role, input, personality_dna, archetype, scene_name, quote, visibility)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'private')
		RETURNING id::text, created_at, updated_at`,
		world.Nickname, world.Role, inputJSON, dnaJSON, world.Archetype, world.SceneName, world.Quote)
	if err := row.Scan(&world.ID, &world.CreatedAt, &world.UpdatedAt); err != nil {
		return WorldBundle{}, err
	}
	row = tx.QueryRow(ctx, `INSERT INTO world_variants (world_id, variant_no, seed, config, is_selected)
		VALUES ($1,$2,$3,$4,true)
		RETURNING id::text, created_at`, world.ID, variant.VariantNo, variant.Seed, configJSON)
	if err := row.Scan(&variant.ID, &variant.CreatedAt); err != nil {
		return WorldBundle{}, err
	}
	variant.WorldID = world.ID
	variant.IsSelected = true
	world.SelectedVariantID = &variant.ID
	if _, err := tx.Exec(ctx, `UPDATE worlds SET selected_variant_id=$1 WHERE id=$2`, variant.ID, world.ID); err != nil {
		return WorldBundle{}, err
	}
	for _, log := range logs {
		if _, err := insertAIGeneration(ctx, tx, log); err != nil {
			return WorldBundle{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return WorldBundle{}, err
	}
	return WorldBundle{World: world, Variants: []models.WorldVariant{variant}}, nil
}

func (s *PostgresStore) GetWorld(ctx context.Context, worldID string) (WorldBundle, error) {
	world, err := s.getWorldByQuery(ctx, `WHERE id=$1`, worldID)
	if err != nil {
		return WorldBundle{}, err
	}
	variants, err := s.getVariants(ctx, world.ID)
	if err != nil {
		return WorldBundle{}, err
	}
	return WorldBundle{World: world, Variants: variants}, nil
}

func (s *PostgresStore) AddVariant(ctx context.Context, worldID string, variant models.WorldVariant) (models.WorldVariant, error) {
	configJSON, _ := json.Marshal(variant.Config)
	row := s.pool.QueryRow(ctx, `INSERT INTO world_variants (world_id, variant_no, seed, config)
		VALUES ($1,$2,$3,$4)
		RETURNING id::text, world_id::text, created_at`, worldID, variant.VariantNo, variant.Seed, configJSON)
	if err := row.Scan(&variant.ID, &variant.WorldID, &variant.CreatedAt); err != nil {
		return models.WorldVariant{}, mapConstraintViolation(err)
	}
	return variant, nil
}

func (s *PostgresStore) SelectVariant(ctx context.Context, worldID, variantID string) (models.WorldVariant, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return models.WorldVariant{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE world_variants SET is_selected=false WHERE world_id=$1`, worldID); err != nil {
		return models.WorldVariant{}, err
	}
	var variant models.WorldVariant
	var configJSON []byte
	row := tx.QueryRow(ctx, `UPDATE world_variants SET is_selected=true WHERE world_id=$1 AND id=$2
		RETURNING id::text, world_id::text, variant_no, seed, config, COALESCE(thumbnail_url,''), is_selected, created_at`, worldID, variantID)
	if err := row.Scan(&variant.ID, &variant.WorldID, &variant.VariantNo, &variant.Seed, &configJSON, &variant.ThumbnailURL, &variant.IsSelected, &variant.CreatedAt); err != nil {
		return models.WorldVariant{}, mapNoRows(err)
	}
	if err := json.Unmarshal(configJSON, &variant.Config); err != nil {
		return models.WorldVariant{}, fmt.Errorf("decode scene config for variant %s: %w", variant.ID, err)
	}
	if _, err := tx.Exec(ctx, `UPDATE worlds SET selected_variant_id=$1, updated_at=NOW() WHERE id=$2`, variantID, worldID); err != nil {
		return models.WorldVariant{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return models.WorldVariant{}, err
	}
	return variant, nil
}

func (s *PostgresStore) PublishWorld(ctx context.Context, worldID, slug string) (models.World, error) {
	world, err := s.getWorldByQuery(ctx, `WHERE id=$1`, worldID)
	if err != nil {
		return models.World{}, err
	}
	if world.ShareSlug != nil {
		slug = *world.ShareSlug
	}
	row := s.pool.QueryRow(ctx, `UPDATE worlds SET visibility='public', share_slug=COALESCE(share_slug, $1), updated_at=NOW()
		WHERE id=$2 RETURNING share_slug, updated_at`, slug, worldID)
	if err := row.Scan(&world.ShareSlug, &world.UpdatedAt); err != nil {
		return models.World{}, mapConstraintViolation(err)
	}
	world.Visibility = "public"
	return world, nil
}

func (s *PostgresStore) GetPublicWorld(ctx context.Context, slug string) (WorldBundle, error) {
	world, err := s.getWorldByQuery(ctx, `WHERE share_slug=$1 AND visibility='public'`, slug)
	if err != nil {
		return WorldBundle{}, err
	}
	variants, err := s.getVariants(ctx, world.ID)
	if err != nil {
		return WorldBundle{}, err
	}
	return WorldBundle{World: world, Variants: variants}, nil
}

func (s *PostgresStore) getWorldByQuery(ctx context.Context, where, arg string) (models.World, error) {
	var world models.World
	var inputJSON, dnaJSON []byte
	row := s.pool.QueryRow(ctx, `SELECT id::text, nickname, COALESCE(role,''), input, personality_dna, archetype, scene_name, quote,
		visibility, share_slug, selected_variant_id::text, created_at, updated_at FROM worlds `+where, arg)
	if err := row.Scan(&world.ID, &world.Nickname, &world.Role, &inputJSON, &dnaJSON, &world.Archetype, &world.SceneName, &world.Quote, &world.Visibility, &world.ShareSlug, &world.SelectedVariantID, &world.CreatedAt, &world.UpdatedAt); err != nil {
		return models.World{}, mapNoRows(err)
	}
	if err := json.Unmarshal(inputJSON, &world.Input); err != nil {
		return models.World{}, fmt.Errorf("decode world input for %s: %w", world.ID, err)
	}
	if err := json.Unmarshal(dnaJSON, &world.PersonalityDNA); err != nil {
		return models.World{}, fmt.Errorf("decode personality dna for %s: %w", world.ID, err)
	}
	world.ShortNarrative = world.PersonalityDNA.ShortNarrative
	return world, nil
}

func (s *PostgresStore) getVariants(ctx context.Context, worldID string) ([]models.WorldVariant, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text, world_id::text, variant_no, seed, config, COALESCE(thumbnail_url,''), is_selected, created_at
		FROM world_variants WHERE world_id=$1 ORDER BY variant_no`, worldID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var variants []models.WorldVariant
	for rows.Next() {
		var variant models.WorldVariant
		var configJSON []byte
		if err := rows.Scan(&variant.ID, &variant.WorldID, &variant.VariantNo, &variant.Seed, &configJSON, &variant.ThumbnailURL, &variant.IsSelected, &variant.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(configJSON, &variant.Config); err != nil {
			return nil, fmt.Errorf("decode scene config for variant %s: %w", variant.ID, err)
		}
		variants = append(variants, variant)
	}
	return variants, rows.Err()
}

func (s *PostgresStore) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *PostgresStore) SaveAIGenerationLogs(ctx context.Context, logs []models.AIGenerationLog) error {
	for _, log := range logs {
		if _, err := insertAIGeneration(ctx, s.pool, log); err != nil {
			return err
		}
	}
	return nil
}

// commandExecutor is satisfied by both pgx.Tx and *pgxpool.Pool, so AI logs can
// be written inside the world-creation transaction or standalone on failure.
type commandExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

func insertAIGeneration(ctx context.Context, executor commandExecutor, log models.AIGenerationLog) (any, error) {
	return executor.Exec(ctx, `INSERT INTO ai_generations (provider, model, task, prompt_version, input_hash, request_json, response_json, usage_json, latency_ms, status, error)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		log.Provider, log.Model, log.Task, log.PromptVersion, log.InputHash, nullableJSON(log.RequestJSON), nullableJSON(log.ResponseJSON), nullableJSON(log.UsageJSON), log.LatencyMS, log.Status, log.Error)
}

func nullableJSON(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

func mapNoRows(err error) error {
	if err == pgx.ErrNoRows {
		return ErrNotFound
	}
	return err
}

const (
	postgresUniqueViolationCode     = "23505"
	postgresForeignKeyViolationCode = "23503"
)

// mapConstraintViolation translates Postgres constraint errors into sentinel
// errors the service layer can react to (retry on conflict, 404 on missing FK).
func mapConstraintViolation(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case postgresUniqueViolationCode:
			return ErrConflict
		case postgresForeignKeyViolationCode:
			return ErrNotFound
		}
	}
	return mapNoRows(err)
}
