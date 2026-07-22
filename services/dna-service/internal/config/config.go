package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

const (
	defaultDatabaseMaximumConnections = 10
	defaultAITimeout                  = 35 * time.Second
	defaultAITotalBudget              = 105 * time.Second
	defaultAIRepairAttempts           = 2
	defaultConsumerAckWait            = 2 * time.Minute
	defaultConsumerMaximumDeliveries  = 5
	defaultQueryTimeout               = 2500 * time.Millisecond
	defaultShutdownTimeout            = 15 * time.Second
	defaultOutboxPollInterval         = 500 * time.Millisecond
	defaultOutboxBatchSize            = 50
)

type Config struct {
	AppEnvironment             string
	DatabaseURL                string
	DatabaseDirectURL          string
	DatabaseMaximumConnections int
	NATSURL                    string
	NATSUsername               string
	NATSPassword               string
	NATSCredentialsFile        string
	ConsumerAckWait            time.Duration
	ConsumerMaximumDeliveries  int
	QueryTimeout               time.Duration
	ShutdownTimeout            time.Duration
	OutboxPollInterval         time.Duration
	OutboxBatchSize            int
	AIProvider                 string
	AIFallbackProvider         string
	AIEnableFallback           bool
	AITimeout                  time.Duration
	AITotalBudget              time.Duration
	AIRepairAttempts           int
	AIPromptVersion            string
	GeminiAPIKey               string
	GeminiModel                string
	OpenAIAPIKey               string
	OpenAIModel                string
}

func Load() (Config, error) {
	loadEnvironmentFiles()
	loadedConfig := Config{
		AppEnvironment:             get("APP_ENV", "development"),
		DatabaseURL:                get("DATABASE_URL", ""),
		DatabaseDirectURL:          get("DATABASE_DIRECT_URL", ""),
		DatabaseMaximumConnections: getInt("DATABASE_MAX_CONNS", defaultDatabaseMaximumConnections),
		NATSURL:                    get("NATS_URL", "nats://localhost:4222"),
		NATSUsername:               get("NATS_USERNAME", ""),
		NATSPassword:               get("NATS_PASSWORD", ""),
		NATSCredentialsFile:        get("NATS_CREDENTIALS", ""),
		ConsumerAckWait:            getDuration("NATS_ACK_WAIT", defaultConsumerAckWait),
		ConsumerMaximumDeliveries:  getInt("NATS_MAX_DELIVER", defaultConsumerMaximumDeliveries),
		QueryTimeout:               getDuration("NATS_QUERY_TIMEOUT", defaultQueryTimeout),
		ShutdownTimeout:            getDuration("SERVICE_SHUTDOWN_TIMEOUT", defaultShutdownTimeout),
		OutboxPollInterval:         getDuration("OUTBOX_POLL_INTERVAL", defaultOutboxPollInterval),
		OutboxBatchSize:            getInt("OUTBOX_BATCH_SIZE", defaultOutboxBatchSize),
		AIProvider:                 get("AI_PROVIDER", "mock"),
		AIFallbackProvider:         get("AI_FALLBACK_PROVIDER", "mock"),
		AIEnableFallback:           getBool("AI_ENABLE_FALLBACK", true),
		AITimeout:                  getDuration("AI_TIMEOUT", defaultAITimeout),
		AITotalBudget:              getDuration("AI_TOTAL_BUDGET", defaultAITotalBudget),
		AIRepairAttempts:           getInt("AI_MAX_RETRIES", defaultAIRepairAttempts),
		AIPromptVersion:            get("AI_PROMPT_VERSION", "profile-dna-v1"),
		GeminiAPIKey:               get("GEMINI_API_KEY", ""),
		GeminiModel:                get("GEMINI_MODEL", "gemini-2.5-flash"),
		OpenAIAPIKey:               get("OPENAI_API_KEY", ""),
		OpenAIModel:                get("OPENAI_MODEL", "gpt-4.1-mini"),
	}
	if err := loadedConfig.Validate(); err != nil {
		return Config{}, err
	}
	return loadedConfig, nil
}

func (loadedConfig Config) Validate() error {
	if strings.TrimSpace(loadedConfig.DatabaseURL) == "" {
		return errors.New("DATABASE_URL is required")
	}
	if strings.TrimSpace(loadedConfig.NATSURL) == "" {
		return errors.New("NATS_URL is required")
	}
	if loadedConfig.DatabaseMaximumConnections <= 0 || loadedConfig.ConsumerAckWait <= 0 || loadedConfig.ConsumerMaximumDeliveries <= 0 {
		return errors.New("database and consumer limits must be positive")
	}
	if loadedConfig.QueryTimeout <= 0 || loadedConfig.ShutdownTimeout <= 0 || loadedConfig.OutboxPollInterval <= 0 || loadedConfig.OutboxBatchSize <= 0 {
		return errors.New("query, shutdown, and outbox values must be positive")
	}
	if loadedConfig.AITimeout <= 0 || loadedConfig.AITotalBudget <= 0 || loadedConfig.AIRepairAttempts < 0 {
		return errors.New("AI timeout, budget, and retry values are invalid")
	}
	return nil
}

func loadEnvironmentFiles() {
	originalEnvironment := snapshotEnvironment()
	explicitFile := strings.TrimSpace(os.Getenv("MYUNIVOKAI_ENV_FILE"))
	if explicitFile != "" {
		_ = godotenv.Overload(explicitFile)
		restoreEnvironment(originalEnvironment)
		return
	}
	_ = godotenv.Overload(".env", ".env.local")
	restoreEnvironment(originalEnvironment)
}

func snapshotEnvironment() map[string]string {
	values := make(map[string]string)
	for _, pair := range os.Environ() {
		key, value, found := strings.Cut(pair, "=")
		if found {
			values[key] = value
		}
	}
	return values
}

func restoreEnvironment(values map[string]string) {
	for key, value := range values {
		_ = os.Setenv(key, value)
	}
}

func get(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func getInt(key string, fallback int) int {
	value, err := strconv.Atoi(get(key, ""))
	if err != nil {
		return fallback
	}
	return value
}

func getDuration(key string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(get(key, ""))
	if err != nil {
		return fallback
	}
	return value
}

func getBool(key string, fallback bool) bool {
	value := strings.ToLower(get(key, ""))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes"
}
