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
	// A silent marshal failure here would persist NULL/empty JSON for the
	// determinism-critical scene config; surface it as an error instead.
	inputJSON, err := json.Marshal(world.Input)
	if err != nil {
		return WorldBundle{}, fmt.Errorf("marshal world input: %w", err)
	}
	dnaJSON, err := json.Marshal(world.PersonalityDNA)
	if err != nil {
		return WorldBundle{}, fmt.Errorf("marshal personality dna: %w", err)
	}
	configJSON, err := json.Marshal(variant.Config)
	if err != nil {
		return WorldBundle{}, fmt.Errorf("marshal scene config: %w", err)
	}
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
	if err := sendAIGenerationLogs(ctx, tx, logs); err != nil {
		return WorldBundle{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorldBundle{}, err
	}
	return WorldBundle{World: world, Variants: []models.WorldVariant{variant}}, nil
}

func (s *PostgresStore) GetWorld(ctx context.Context, worldID string) (WorldBundle, error) {
	// Both statements travel in one pgx batch: a single network round trip to
	// Neon instead of two sequential queries.
	batch := &pgx.Batch{}
	batch.Queue(`SELECT `+worldSelectColumns+` FROM worlds WHERE id=$1`, worldID)
	batch.Queue(`SELECT `+variantSelectColumns+` FROM world_variants WHERE world_id=$1 ORDER BY variant_no`, worldID)
	results := s.pool.SendBatch(ctx, batch)
	defer results.Close()

	world, err := scanWorld(results.QueryRow())
	if err != nil {
		return WorldBundle{}, mapNoRows(err)
	}
	rows, err := results.Query()
	if err != nil {
		return WorldBundle{}, err
	}
	variants, err := scanVariantRows(rows)
	if err != nil {
		return WorldBundle{}, err
	}
	return WorldBundle{World: world, Variants: variants}, nil
}

func (s *PostgresStore) AddVariant(ctx context.Context, worldID string, variant models.WorldVariant) (models.WorldVariant, error) {
	configJSON, err := json.Marshal(variant.Config)
	if err != nil {
		return models.WorldVariant{}, fmt.Errorf("marshal scene config: %w", err)
	}
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
	row := tx.QueryRow(ctx, `UPDATE world_variants SET is_selected=true WHERE world_id=$1 AND id=$2
		RETURNING `+variantSelectColumns, worldID, variantID)
	variant, err := scanVariant(row)
	if err != nil {
		return models.WorldVariant{}, mapNoRows(err)
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

// worldSelectColumns is the single source of truth for reading a world row;
// scanWorld must stay in sync with this column order.
const worldSelectColumns = `id::text, nickname, COALESCE(role,''), input, personality_dna, archetype, scene_name, quote,
	visibility, share_slug, selected_variant_id::text, created_at, updated_at`

// variantSelectColumns is the single source of truth for reading a variant
// row; scanVariant must stay in sync with this column order.
const variantSelectColumns = `id::text, world_id::text, variant_no, seed, config, COALESCE(thumbnail_url,''), is_selected, created_at`

// rowScanner is satisfied by both pgx.Row and pgx.Rows, so single-row and
// batch reads share one scan routine.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanWorld(scanner rowScanner) (models.World, error) {
	var world models.World
	var inputJSON, dnaJSON []byte
	if err := scanner.Scan(&world.ID, &world.Nickname, &world.Role, &inputJSON, &dnaJSON, &world.Archetype, &world.SceneName, &world.Quote, &world.Visibility, &world.ShareSlug, &world.SelectedVariantID, &world.CreatedAt, &world.UpdatedAt); err != nil {
		return models.World{}, err
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

func scanVariant(scanner rowScanner) (models.WorldVariant, error) {
	var variant models.WorldVariant
	var configJSON []byte
	if err := scanner.Scan(&variant.ID, &variant.WorldID, &variant.VariantNo, &variant.Seed, &configJSON, &variant.ThumbnailURL, &variant.IsSelected, &variant.CreatedAt); err != nil {
		return models.WorldVariant{}, err
	}
	if err := json.Unmarshal(configJSON, &variant.Config); err != nil {
		return models.WorldVariant{}, fmt.Errorf("decode scene config for variant %s: %w", variant.ID, err)
	}
	return variant, nil
}

func scanVariantRows(rows pgx.Rows) ([]models.WorldVariant, error) {
	defer rows.Close()
	var variants []models.WorldVariant
	for rows.Next() {
		variant, err := scanVariant(rows)
		if err != nil {
			return nil, err
		}
		variants = append(variants, variant)
	}
	return variants, rows.Err()
}

func (s *PostgresStore) getWorldByQuery(ctx context.Context, where, arg string) (models.World, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+worldSelectColumns+` FROM worlds `+where, arg)
	world, err := scanWorld(row)
	if err != nil {
		return models.World{}, mapNoRows(err)
	}
	return world, nil
}

// GetWorldsByIDs loads any number of worlds in a fixed two-query round-trip
// pair (worlds by ANY, then all their variants by ANY), instead of the 2xN
// sequential queries N single GetWorld calls would cost.
func (s *PostgresStore) GetWorldsByIDs(ctx context.Context, worldIDs []string) ([]WorldBundle, error) {
	if len(worldIDs) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT `+worldSelectColumns+` FROM worlds WHERE id = ANY($1::uuid[])`, worldIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	worldsByID := make(map[string]models.World, len(worldIDs))
	for rows.Next() {
		world, err := scanWorld(rows)
		if err != nil {
			return nil, err
		}
		worldsByID[world.ID] = world
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	variantsByWorldID, err := s.getVariantsForWorlds(ctx, worldIDs)
	if err != nil {
		return nil, err
	}

	bundles := make([]WorldBundle, 0, len(worldsByID))
	for _, worldID := range worldIDs {
		world, found := worldsByID[worldID]
		if !found {
			continue
		}
		bundles = append(bundles, WorldBundle{World: world, Variants: variantsByWorldID[worldID]})
	}
	return bundles, nil
}

func (s *PostgresStore) getVariantsForWorlds(ctx context.Context, worldIDs []string) (map[string][]models.WorldVariant, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+variantSelectColumns+`
		FROM world_variants WHERE world_id = ANY($1::uuid[]) ORDER BY world_id, variant_no`, worldIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	variantsByWorldID := make(map[string][]models.WorldVariant, len(worldIDs))
	for rows.Next() {
		variant, err := scanVariant(rows)
		if err != nil {
			return nil, err
		}
		variantsByWorldID[variant.WorldID] = append(variantsByWorldID[variant.WorldID], variant)
	}
	return variantsByWorldID, rows.Err()
}

func (s *PostgresStore) getVariants(ctx context.Context, worldID string) ([]models.WorldVariant, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+variantSelectColumns+`
		FROM world_variants WHERE world_id=$1 ORDER BY variant_no`, worldID)
	if err != nil {
		return nil, err
	}
	return scanVariantRows(rows)
}

func (s *PostgresStore) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *PostgresStore) SaveAIGenerationLogs(ctx context.Context, logs []models.AIGenerationLog) error {
	return sendAIGenerationLogs(ctx, s.pool, logs)
}

const insertAIGenerationStatement = `INSERT INTO ai_generations (provider, model, task, prompt_version, input_hash, request_json, response_json, usage_json, latency_ms, status, error)
	VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`

// batchSender is satisfied by both pgx.Tx and *pgxpool.Pool, so AI logs can be
// written inside the world-creation transaction or standalone on failure.
type batchSender interface {
	SendBatch(ctx context.Context, batch *pgx.Batch) pgx.BatchResults
}

// sendAIGenerationLogs writes every attempt log in a single pgx batch: one
// network round trip regardless of how many repair/fallback attempts ran.
func sendAIGenerationLogs(ctx context.Context, sender batchSender, logs []models.AIGenerationLog) error {
	if len(logs) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, log := range logs {
		batch.Queue(insertAIGenerationStatement,
			log.Provider, log.Model, log.Task, log.PromptVersion, log.InputHash, nullableJSON(log.RequestJSON), nullableJSON(log.ResponseJSON), nullableJSON(log.UsageJSON), log.LatencyMS, log.Status, log.Error)
	}
	results := sender.SendBatch(ctx, batch)
	defer results.Close()
	for range logs {
		if _, err := results.Exec(); err != nil {
			return err
		}
	}
	return nil
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
