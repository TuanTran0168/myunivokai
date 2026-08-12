package repositories

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/analytics-service/internal/models"
)

// distributionLimit bounds every top-N chart. A distribution with hundreds of
// bars is unreadable long before it is slow, so this is a product bound that
// happens to also be a performance one.
const distributionLimit = 8

// worldJobHistoryLimit bounds the detail page's job list. A world normally
// accumulates a handful of jobs — one creation, one per variant, one publish —
// so this is far above the real shape and exists only so a pathological world
// cannot push the response past the 2500ms request/reply deadline.
const worldJobHistoryLimit = 50

// postgresInvalidTextCode is invalid_text_representation, raised when a value
// that is not a UUID reaches a ::uuid cast.
const postgresInvalidTextCode = "22P02"

// Overview answers the whole dashboard in one round trip. Every count, rate
// and percentile below is computed by PostgreSQL; the gateway and the admin
// app sum nothing, which is the rule this service exists to enforce.
func (store *PostgresStore) Overview(ctx context.Context, filter models.OverviewFilter) (contracts.AnalyticsOverviewResponseData, error) {
	days := contracts.NormalizeDays(filter.Days)
	since := time.Now().UTC().AddDate(0, 0, -days)
	family := string(filter.Family)

	batch := &pgx.Batch{}
	batch.Queue(`SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE is_published),
			COUNT(*) FILTER (WHERE world_created_at >= $2),
			COALESCE(AVG(trait_creativity), 0), COALESCE(AVG(trait_discipline), 0),
			COALESCE(AVG(trait_curiosity), 0), COALESCE(AVG(trait_energy), 0), COALESCE(AVG(trait_focus), 0),
			MIN(world_created_at)
		FROM world_projections
		WHERE ($1 = '' OR family = $1)`, family, since)
	batch.Queue(`SELECT w.family,
			COUNT(*), COUNT(*) FILTER (WHERE w.is_published), COALESCE(SUM(w.variant_count), 0)
		FROM world_projections w
		WHERE ($1 = '' OR w.family = $1)
		GROUP BY w.family
		ORDER BY w.family`, family)
	batch.Queue(`SELECT family,
			COUNT(*), COUNT(*) FILTER (WHERE status = 'failed')
		FROM job_projections
		WHERE ($1 = '' OR family = $1) AND created_at >= $2
		GROUP BY family
		ORDER BY family`, family, since)
	batch.Queue(`SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status = 'completed'),
			COUNT(*) FILTER (WHERE status = 'failed'),
			COUNT(*) FILTER (WHERE status NOT IN ('completed','failed')),
			COUNT(*) FILTER (WHERE duration_ms IS NOT NULL),
			COALESCE(AVG(duration_ms), 0),
			COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0),
			COALESCE(MAX(duration_ms), 0)
		FROM job_projections
		WHERE ($1 = '' OR family = $1) AND created_at >= $2`, family, since)
	batch.Queue(distributionQuery("archetype"), family, since, distributionLimit)
	batch.Queue(distributionQuery("world_style"), family, since, distributionLimit)
	batch.Queue(distributionQuery("mood"), family, since, distributionLimit)
	batch.Queue(`SELECT error_code, COUNT(*)
		FROM job_projections
		WHERE ($1 = '' OR family = $1) AND created_at >= $2 AND error_code <> ''
		GROUP BY error_code
		ORDER BY COUNT(*) DESC, error_code
		LIMIT $3`, family, since, distributionLimit)
	batch.Queue(`SELECT
			COUNT(*) FILTER (WHERE variant_count > 1),
			COUNT(*)
		FROM world_projections
		WHERE ($1 = '' OR family = $1)`, family)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	overview := contracts.AnalyticsOverviewResponseData{Days: days, GeneratedAt: time.Now().UTC()}
	var averageCreativity, averageDiscipline, averageCuriosity, averageEnergy, averageFocus float64
	var oldestWorld *time.Time
	if err := results.QueryRow().Scan(
		&overview.TotalWorlds, &overview.TotalPublished, &overview.WorldsInWindow,
		&averageCreativity, &averageDiscipline, &averageCuriosity, &averageEnergy, &averageFocus,
		&oldestWorld,
	); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.AverageTraitScores = contracts.TraitScores{
		Creativity: roundToInt(averageCreativity),
		Discipline: roundToInt(averageDiscipline),
		Curiosity:  roundToInt(averageCuriosity),
		Energy:     roundToInt(averageEnergy),
		Focus:      roundToInt(averageFocus),
	}
	overview.OldestProjectedWorld = oldestWorld

	familyTotals, err := scanFamilyWorldTotals(results)
	if err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	if err := mergeFamilyJobTotals(results, familyTotals); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.Families = orderFamilyTotals(familyTotals)

	var averageDuration, percentile95Duration, slowestDuration float64
	if err := results.QueryRow().Scan(
		&overview.JobHealth.TotalJobs, &overview.JobHealth.CompletedJobs, &overview.JobHealth.FailedJobs,
		&overview.JobHealth.InFlightJobs, &overview.JobHealth.MeasuredJobCount,
		&averageDuration, &percentile95Duration, &slowestDuration,
	); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.JobHealth.AverageDurationMs = roundToInt(averageDuration)
	overview.JobHealth.P95DurationMs = roundToInt(percentile95Duration)
	overview.JobHealth.SlowestDurationMs = roundToInt(slowestDuration)
	overview.JobHealth.FailureRatePercent = percentageOf(overview.JobHealth.FailedJobs, overview.JobHealth.TotalJobs)

	for _, target := range []*[]contracts.AnalyticsDistributionSlice{
		&overview.ArchetypeTop, &overview.WorldStyleTop, &overview.MoodTop, &overview.ErrorCodeTop,
	} {
		slices, scanError := scanDistribution(results)
		if scanError != nil {
			return contracts.AnalyticsOverviewResponseData{}, scanError
		}
		*target = slices
	}

	var multiVariantWorlds, countedWorlds int
	if err := results.QueryRow().Scan(&multiVariantWorlds, &countedWorlds); err != nil {
		return contracts.AnalyticsOverviewResponseData{}, err
	}
	overview.JobHealth.MultiVariantPercent = percentageOf(multiVariantWorlds, countedWorlds)
	overview.JobHealth.PublishRatePercent = percentageOf(overview.TotalPublished, overview.TotalWorlds)
	return overview, nil
}

// Timeseries fills empty days with explicit zeroes via generate_series, so a
// chart draws a flat line through a quiet week instead of interpolating
// across a hole that never existed.
func (store *PostgresStore) Timeseries(ctx context.Context, filter models.OverviewFilter) (contracts.AnalyticsTimeseriesResponseData, error) {
	days := contracts.NormalizeDays(filter.Days)
	family := string(filter.Family)
	rows, err := store.pool.Query(ctx, `WITH calendar AS (
			SELECT generate_series(
				date_trunc('day', NOW() AT TIME ZONE 'UTC') - MAKE_INTERVAL(days => $2 - 1),
				date_trunc('day', NOW() AT TIME ZONE 'UTC'),
				INTERVAL '1 day'
			) AS day
		),
		worlds AS (
			SELECT date_trunc('day', world_created_at AT TIME ZONE 'UTC') AS day,
				COUNT(*) AS world_count,
				COUNT(*) FILTER (WHERE is_published) AS published_count
			FROM world_projections
			WHERE ($1 = '' OR family = $1)
			GROUP BY 1
		),
		jobs AS (
			SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
				COUNT(*) AS job_count,
				COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
			FROM job_projections
			WHERE ($1 = '' OR family = $1)
			GROUP BY 1
		)
		SELECT calendar.day,
			COALESCE(worlds.world_count, 0), COALESCE(worlds.published_count, 0),
			COALESCE(jobs.job_count, 0), COALESCE(jobs.failed_count, 0)
		FROM calendar
		LEFT JOIN worlds ON worlds.day = calendar.day
		LEFT JOIN jobs ON jobs.day = calendar.day
		ORDER BY calendar.day`, family, days)
	if err != nil {
		return contracts.AnalyticsTimeseriesResponseData{}, err
	}
	defer rows.Close()
	points := make([]contracts.AnalyticsTimeseriesPoint, 0, days)
	for rows.Next() {
		var point contracts.AnalyticsTimeseriesPoint
		if err := rows.Scan(&point.Day, &point.WorldCount, &point.PublishedCount, &point.JobCount, &point.FailedJobCount); err != nil {
			return contracts.AnalyticsTimeseriesResponseData{}, err
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return contracts.AnalyticsTimeseriesResponseData{}, err
	}
	return contracts.AnalyticsTimeseriesResponseData{Days: days, Points: points}, nil
}

// ListWorlds pages by keyset on (world_created_at, world_id) DESC. It fetches
// pageSize+1 rows and returns pageSize: the extra row is how "is there a next
// page" is answered without a second query and without a COUNT the client
// would then have to trust.
func (store *PostgresStore) ListWorlds(ctx context.Context, filter models.WorldListFilter) (contracts.AnalyticsWorldListResponseData, error) {
	pageSize := contracts.NormalizePageSize(filter.PageSize)
	conditions := []string{"($1 = '' OR family = $1)", "($2 = '' OR archetype = $2)", "($3 = '' OR world_style = $3)", "($4 = '' OR mood = $4)"}
	arguments := []any{string(filter.Family), filter.Archetype, filter.WorldStyle, filter.Mood}
	if filter.Published != nil {
		arguments = append(arguments, *filter.Published)
		conditions = append(conditions, fmt.Sprintf("is_published = $%d", len(arguments)))
	}
	countCondition := strings.Join(conditions, " AND ")

	pageArguments := append([]any(nil), arguments...)
	if filter.Cursor != "" {
		cursorCreatedAt, cursorWorldID, err := decodeCursor(filter.Cursor)
		if err != nil {
			return contracts.AnalyticsWorldListResponseData{}, err
		}
		pageArguments = append(pageArguments, cursorCreatedAt, cursorWorldID)
		conditions = append(conditions, fmt.Sprintf("(world_created_at, world_id) < ($%d, $%d::uuid)", len(pageArguments)-1, len(pageArguments)))
	}
	pageArguments = append(pageArguments, pageSize+1)

	batch := &pgx.Batch{}
	batch.Queue(`SELECT world_id::text, family, nickname, role, archetype, scene_name, mood, world_style,
			favorite_colors, trait_creativity, trait_discipline, trait_curiosity, trait_energy, trait_focus,
			variant_count, selected_variant_no, is_published, published_at, revision, source_job_id,
			world_created_at, projected_at
		FROM world_projections
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY world_created_at DESC, world_id DESC
		LIMIT $`+fmt.Sprint(len(pageArguments)), pageArguments...)
	batch.Queue(`SELECT COUNT(*) FROM world_projections WHERE `+countCondition, arguments...)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	rows, err := results.Query()
	if err != nil {
		return contracts.AnalyticsWorldListResponseData{}, err
	}
	worlds := make([]contracts.WorldProjectionSummary, 0, pageSize)
	for rows.Next() {
		world, scanError := scanWorldProjection(rows)
		if scanError != nil {
			rows.Close()
			return contracts.AnalyticsWorldListResponseData{}, scanError
		}
		worlds = append(worlds, world)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return contracts.AnalyticsWorldListResponseData{}, err
	}
	rows.Close()

	response := contracts.AnalyticsWorldListResponseData{PageSize: pageSize}
	if len(worlds) > pageSize {
		last := worlds[pageSize-1]
		response.NextCursor = encodeCursor(last.WorldCreatedAt, last.WorldID)
		worlds = worlds[:pageSize]
	}
	response.Worlds = worlds
	if err := results.QueryRow().Scan(&response.TotalCount); err != nil {
		return contracts.AnalyticsWorldListResponseData{}, err
	}
	return response, nil
}

// GetWorld answers the world detail page in one round trip: the projection
// row, and every job that ever touched that world. Both halves travel together
// because they are read together — splitting them into two queries would let
// the page render a world beside a job list that belongs to an older read.
func (store *PostgresStore) GetWorld(ctx context.Context, worldID string) (contracts.AnalyticsWorldGetResponseData, error) {
	batch := &pgx.Batch{}
	batch.Queue(`SELECT world_id::text, family, nickname, role, archetype, scene_name, mood, world_style,
			favorite_colors, trait_creativity, trait_discipline, trait_curiosity, trait_energy, trait_focus,
			variant_count, selected_variant_no, is_published, published_at, revision, source_job_id,
			world_created_at, projected_at, profile_id::text, dna_version_id::text
		FROM world_projections
		WHERE world_id = $1::uuid`, worldID)
	batch.Queue(`SELECT job_id, family, status, error_code, error_message,
			COALESCE(world_id::text, ''), COALESCE(profile_id::text, ''), COALESCE(dna_version_id::text, ''),
			created_at, completed_at, duration_ms
		FROM job_projections
		WHERE world_id = $1::uuid
		ORDER BY created_at DESC, job_id DESC
		LIMIT $2`, worldID, worldJobHistoryLimit)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	detail, err := scanWorldProjectionDetail(results.QueryRow())
	if err != nil {
		return contracts.AnalyticsWorldGetResponseData{}, mapWorldLookupError(err)
	}

	rows, err := results.Query()
	if err != nil {
		return contracts.AnalyticsWorldGetResponseData{}, err
	}
	defer rows.Close()
	jobs := make([]contracts.JobProjectionSummary, 0, 4)
	for rows.Next() {
		job, scanError := scanJobProjection(rows)
		if scanError != nil {
			return contracts.AnalyticsWorldGetResponseData{}, scanError
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return contracts.AnalyticsWorldGetResponseData{}, err
	}
	return contracts.AnalyticsWorldGetResponseData{World: detail, Jobs: jobs}, nil
}

// mapWorldLookupError folds "no such row" and "not a UUID at all" into the
// same ErrNotFound. 22P02 is invalid_text_representation, which is what
// Postgres raises when a hand-typed id reaches the ::uuid cast — surfacing
// that as a 500 would blame the service for a bad URL.
func mapWorldLookupError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == postgresInvalidTextCode {
		return ErrNotFound
	}
	return err
}

// ListJobs is ListWorlds' twin over (created_at, job_id).
func (store *PostgresStore) ListJobs(ctx context.Context, filter models.JobListFilter) (contracts.AnalyticsJobListResponseData, error) {
	pageSize := contracts.NormalizePageSize(filter.PageSize)
	conditions := []string{"($1 = '' OR family = $1)", "($2 = '' OR status = $2)", "($3 = '' OR error_code = $3)"}
	arguments := []any{string(filter.Family), string(filter.Status), filter.ErrorCode}
	countCondition := strings.Join(conditions, " AND ")

	pageArguments := append([]any(nil), arguments...)
	if filter.Cursor != "" {
		cursorCreatedAt, cursorJobID, err := decodeCursor(filter.Cursor)
		if err != nil {
			return contracts.AnalyticsJobListResponseData{}, err
		}
		pageArguments = append(pageArguments, cursorCreatedAt, cursorJobID)
		conditions = append(conditions, fmt.Sprintf("(created_at, job_id) < ($%d, $%d)", len(pageArguments)-1, len(pageArguments)))
	}
	pageArguments = append(pageArguments, pageSize+1)

	batch := &pgx.Batch{}
	batch.Queue(`SELECT job_id, family, status, error_code, error_message,
			COALESCE(world_id::text, ''), COALESCE(profile_id::text, ''), COALESCE(dna_version_id::text, ''),
			created_at, completed_at, duration_ms
		FROM job_projections
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY created_at DESC, job_id DESC
		LIMIT $`+fmt.Sprint(len(pageArguments)), pageArguments...)
	batch.Queue(`SELECT COUNT(*) FROM job_projections WHERE `+countCondition, arguments...)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	rows, err := results.Query()
	if err != nil {
		return contracts.AnalyticsJobListResponseData{}, err
	}
	jobs := make([]contracts.JobProjectionSummary, 0, pageSize)
	for rows.Next() {
		job, scanError := scanJobProjection(rows)
		if scanError != nil {
			rows.Close()
			return contracts.AnalyticsJobListResponseData{}, scanError
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return contracts.AnalyticsJobListResponseData{}, err
	}
	rows.Close()

	response := contracts.AnalyticsJobListResponseData{PageSize: pageSize}
	if len(jobs) > pageSize {
		last := jobs[pageSize-1]
		response.NextCursor = encodeCursor(last.CreatedAt, last.JobID)
		jobs = jobs[:pageSize]
	}
	response.Jobs = jobs
	if err := results.QueryRow().Scan(&response.TotalCount); err != nil {
		return contracts.AnalyticsJobListResponseData{}, err
	}
	return response, nil
}

func distributionQuery(column string) string {
	// The column name is a compile-time constant supplied by this file, never
	// by a caller — no request value is ever interpolated into SQL here.
	return `SELECT ` + column + `, COUNT(*)
		FROM world_projections
		WHERE ($1 = '' OR family = $1) AND world_created_at >= $2 AND ` + column + ` <> ''
		GROUP BY ` + column + `
		ORDER BY COUNT(*) DESC, ` + column + `
		LIMIT $3`
}

type rowScanner interface {
	Scan(destinations ...any) error
}

// scanWorldProjectionDetail reads the summary columns in the same order
// scanWorldProjection does, then the two identifiers appended for the detail
// view. The orders must stay in step with each other and with both SELECT
// lists — that coupling is why the extra columns go last rather than beside
// the ids they relate to.
func scanWorldProjectionDetail(scanner rowScanner) (contracts.WorldProjectionDetail, error) {
	var detail contracts.WorldProjectionDetail
	var favoriteColorsJSON []byte
	if err := scanner.Scan(
		&detail.WorldID, &detail.Family, &detail.Nickname, &detail.Role, &detail.Archetype, &detail.SceneName,
		&detail.Mood, &detail.WorldStyle, &favoriteColorsJSON,
		&detail.TraitScores.Creativity, &detail.TraitScores.Discipline, &detail.TraitScores.Curiosity,
		&detail.TraitScores.Energy, &detail.TraitScores.Focus,
		&detail.VariantCount, &detail.SelectedVariantNo, &detail.IsPublished, &detail.PublishedAt,
		&detail.Revision, &detail.SourceJobID, &detail.WorldCreatedAt, &detail.ProjectedAt,
		&detail.ProfileID, &detail.DNAVersionID,
	); err != nil {
		return contracts.WorldProjectionDetail{}, err
	}
	if err := json.Unmarshal(favoriteColorsJSON, &detail.FavoriteColors); err != nil {
		return contracts.WorldProjectionDetail{}, fmt.Errorf("decode favorite colors for %s: %w", detail.WorldID, err)
	}
	return detail, nil
}

func scanWorldProjection(scanner rowScanner) (contracts.WorldProjectionSummary, error) {
	var world contracts.WorldProjectionSummary
	var favoriteColorsJSON []byte
	if err := scanner.Scan(
		&world.WorldID, &world.Family, &world.Nickname, &world.Role, &world.Archetype, &world.SceneName,
		&world.Mood, &world.WorldStyle, &favoriteColorsJSON,
		&world.TraitScores.Creativity, &world.TraitScores.Discipline, &world.TraitScores.Curiosity,
		&world.TraitScores.Energy, &world.TraitScores.Focus,
		&world.VariantCount, &world.SelectedVariantNo, &world.IsPublished, &world.PublishedAt,
		&world.Revision, &world.SourceJobID, &world.WorldCreatedAt, &world.ProjectedAt,
	); err != nil {
		return contracts.WorldProjectionSummary{}, err
	}
	if err := json.Unmarshal(favoriteColorsJSON, &world.FavoriteColors); err != nil {
		return contracts.WorldProjectionSummary{}, fmt.Errorf("decode favorite colors for %s: %w", world.WorldID, err)
	}
	return world, nil
}

func scanJobProjection(scanner rowScanner) (contracts.JobProjectionSummary, error) {
	var job contracts.JobProjectionSummary
	if err := scanner.Scan(
		&job.JobID, &job.Family, &job.Status, &job.ErrorCode, &job.ErrorMessage,
		&job.WorldID, &job.ProfileID, &job.DNAVersionID,
		&job.CreatedAt, &job.CompletedAt, &job.DurationMs,
	); err != nil {
		return contracts.JobProjectionSummary{}, err
	}
	return job, nil
}

func scanFamilyWorldTotals(results pgx.BatchResults) (map[contracts.WorldFamily]*contracts.AnalyticsFamilyTotals, error) {
	rows, err := results.Query()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	totals := map[contracts.WorldFamily]*contracts.AnalyticsFamilyTotals{}
	for rows.Next() {
		row := &contracts.AnalyticsFamilyTotals{}
		if err := rows.Scan(&row.Family, &row.WorldCount, &row.PublishedCount, &row.VariantCount); err != nil {
			return nil, err
		}
		totals[row.Family] = row
	}
	return totals, rows.Err()
}

func mergeFamilyJobTotals(results pgx.BatchResults, totals map[contracts.WorldFamily]*contracts.AnalyticsFamilyTotals) error {
	rows, err := results.Query()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var family contracts.WorldFamily
		var jobCount, failedJobCount int
		if err := rows.Scan(&family, &jobCount, &failedJobCount); err != nil {
			return err
		}
		row, found := totals[family]
		if !found {
			row = &contracts.AnalyticsFamilyTotals{Family: family}
			totals[family] = row
		}
		row.JobCount = jobCount
		row.FailedJobCount = failedJobCount
	}
	return rows.Err()
}

// orderFamilyTotals returns families in a stable, declared order rather than
// whatever the database happened to group first, so a dashboard's cards do
// not reorder themselves between refreshes.
func orderFamilyTotals(totals map[contracts.WorldFamily]*contracts.AnalyticsFamilyTotals) []contracts.AnalyticsFamilyTotals {
	ordered := make([]contracts.AnalyticsFamilyTotals, 0, len(totals))
	for _, family := range []contracts.WorldFamily{contracts.WorldFamilyUniverse, contracts.WorldFamilyNature} {
		if row, found := totals[family]; found {
			ordered = append(ordered, *row)
			delete(totals, family)
		}
	}
	for _, row := range totals {
		ordered = append(ordered, *row)
	}
	return ordered
}

func scanDistribution(results pgx.BatchResults) ([]contracts.AnalyticsDistributionSlice, error) {
	rows, err := results.Query()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	slices := make([]contracts.AnalyticsDistributionSlice, 0, distributionLimit)
	for rows.Next() {
		var slice contracts.AnalyticsDistributionSlice
		if err := rows.Scan(&slice.Value, &slice.Count); err != nil {
			return nil, err
		}
		slices = append(slices, slice)
	}
	return slices, rows.Err()
}

func percentageOf(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return float64(int(float64(part)/float64(whole)*10000+0.5)) / 100
}

func roundToInt(value float64) int {
	if value < 0 {
		return 0
	}
	return int(value + 0.5)
}

// ListServiceStarts is the same keyset shape as ListJobs, over the one table
// here that is not a projection. Newest first, because the question this
// answers is almost always "what restarted recently".
func (store *PostgresStore) ListServiceStarts(ctx context.Context, filter models.ServiceStartListFilter) (contracts.ServiceStartListResponseData, error) {
	pageSize := contracts.NormalizePageSize(filter.PageSize)
	conditions := []string{"($1 = '' OR service = $1)"}
	arguments := []any{filter.Service}
	countCondition := strings.Join(conditions, " AND ")

	pageArguments := append([]any(nil), arguments...)
	if filter.Cursor != "" {
		cursorStartedAt, cursorInstanceID, err := decodeCursor(filter.Cursor)
		if err != nil {
			return contracts.ServiceStartListResponseData{}, err
		}
		pageArguments = append(pageArguments, cursorStartedAt, cursorInstanceID)
		conditions = append(conditions, fmt.Sprintf("(started_at, instance_id) < ($%d, $%d)", len(pageArguments)-1, len(pageArguments)))
	}
	pageArguments = append(pageArguments, pageSize+1)

	batch := &pgx.Batch{}
	batch.Queue(`SELECT service, instance_id, version, boot_duration_ms, started_at
		FROM service_starts
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY started_at DESC, instance_id DESC
		LIMIT $`+fmt.Sprint(len(pageArguments)), pageArguments...)
	batch.Queue(`SELECT COUNT(*) FROM service_starts WHERE `+countCondition, arguments...)

	results := store.pool.SendBatch(ctx, batch)
	defer results.Close()

	rows, err := results.Query()
	if err != nil {
		return contracts.ServiceStartListResponseData{}, err
	}
	starts := make([]contracts.ServiceStartRecord, 0, pageSize)
	for rows.Next() {
		var start contracts.ServiceStartRecord
		if scanError := rows.Scan(&start.Service, &start.InstanceID, &start.Version, &start.BootDurationMS, &start.StartedAt); scanError != nil {
			rows.Close()
			return contracts.ServiceStartListResponseData{}, scanError
		}
		starts = append(starts, start)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return contracts.ServiceStartListResponseData{}, err
	}
	rows.Close()

	response := contracts.ServiceStartListResponseData{PageSize: pageSize}
	if len(starts) > pageSize {
		last := starts[pageSize-1]
		response.NextCursor = encodeCursor(last.StartedAt, last.InstanceID)
		starts = starts[:pageSize]
	}
	response.Starts = starts
	if err := results.QueryRow().Scan(&response.TotalCount); err != nil {
		return contracts.ServiceStartListResponseData{}, err
	}
	return response, nil
}
