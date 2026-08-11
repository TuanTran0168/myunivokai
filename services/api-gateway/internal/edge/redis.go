package edge

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

var ErrCacheMiss = errors.New("cache miss")

const (
	rateLimitKeySegment     = "rate"
	cacheKeySegment         = "cache"
	authTokenVersionSegment = "auth:tokenversion"
	wakeKeySegment          = "wake"
	minimumRetryDelay       = time.Millisecond
)

var tokenBucketScript = redis.NewScript(`
local current_time = redis.call('TIME')
local now = tonumber(current_time[1]) + tonumber(current_time[2]) / 1000000
local values = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at')
local tokens = tonumber(values[1])
local updated_at = tonumber(values[2])
local rate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
if tokens == nil then tokens = capacity end
if updated_at == nil then updated_at = now end
tokens = math.min(capacity, tokens + math.max(0, now - updated_at) * rate)
local allowed = 0
local retry_milliseconds = 0
if tokens >= 1 then
  allowed = 1
  tokens = tokens - 1
else
  retry_milliseconds = math.ceil((1 - tokens) / rate * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_at', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 2000))
return {allowed, retry_milliseconds}
`)

type RedisStore struct {
	client    *redis.Client
	keyPrefix string
}

func NewRedisStore(redisURL, keyPrefix string) (*RedisStore, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	return &RedisStore{client: redis.NewClient(options), keyPrefix: strings.TrimSuffix(keyPrefix, ":")}, nil
}

func (store *RedisStore) Allow(ctx context.Context, route, clientIdentifier string, requestsPerSecond float64, burst int) (bool, time.Duration, error) {
	key := store.key(rateLimitKeySegment, sanitizeKeyPart(route), sanitizeKeyPart(clientIdentifier))
	result, err := tokenBucketScript.Run(ctx, store.client, []string{key}, requestsPerSecond, burst).Slice()
	if err != nil {
		return false, 0, err
	}
	if len(result) != 2 {
		return false, 0, errors.New("unexpected Redis rate limit result")
	}
	allowed, allowedValid := result[0].(int64)
	retryMilliseconds, retryValid := result[1].(int64)
	if !allowedValid || !retryValid {
		return false, 0, errors.New("invalid Redis rate limit result")
	}
	retryDelay := time.Duration(retryMilliseconds) * time.Millisecond
	if retryDelay > 0 && retryDelay < minimumRetryDelay {
		retryDelay = minimumRetryDelay
	}
	return allowed == 1, retryDelay, nil
}

func (store *RedisStore) Get(ctx context.Context, namespace, identifier string) ([]byte, error) {
	payload, err := store.client.Get(ctx, store.key(cacheKeySegment, namespace, identifier)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrCacheMiss
	}
	return payload, err
}

func (store *RedisStore) Set(ctx context.Context, namespace, identifier string, payload []byte, timeToLive time.Duration) error {
	return store.client.Set(ctx, store.key(cacheKeySegment, namespace, identifier), payload, timeToLive).Err()
}

func (store *RedisStore) Delete(ctx context.Context, namespace, identifier string) error {
	return store.client.Del(ctx, store.key(cacheKeySegment, namespace, identifier)).Err()
}

// GetTokenVersion and SetTokenVersion read/write the same
// <prefix>:auth:tokenversion:<accountId> key auth-service writes on disable
// or password change — a plain key, not under the "cache:" namespace the
// rest of this store uses, so both processes agree on it without either
// hardcoding the other's prefix. See
// notes/vision/auth-and-admin-plan.md#how-b-works and
// services/auth-service/internal/redis/client.go.
func (store *RedisStore) GetTokenVersion(ctx context.Context, accountID string) (int, error) {
	raw, err := store.client.Get(ctx, store.key(authTokenVersionSegment, accountID)).Result()
	if errors.Is(err, redis.Nil) {
		return 0, ErrCacheMiss
	}
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(raw)
}

func (store *RedisStore) SetTokenVersion(ctx context.Context, accountID string, tokenVersion int, timeToLive time.Duration) error {
	return store.client.Set(ctx, store.key(authTokenVersionSegment, accountID), strconv.Itoa(tokenVersion), timeToLive).Err()
}

// AcquireWakeLock reports whether the caller is the one that should wake a
// sleeping service, collapsing a burst of requests into a single outbound
// wake (wake.SingleFlightLock).
//
// It is deliberately a plain SET NX EX and not a released lock: the key is
// meant to stay held for its whole TTL, because the point is to stay quiet
// for roughly one cold start, not to guard a critical section. Nothing here
// is a correctness requirement - a lost lock costs one redundant call.
func (store *RedisStore) AcquireWakeLock(ctx context.Context, service string, timeToLive time.Duration) (bool, error) {
	return store.client.SetNX(ctx, store.key(wakeKeySegment, sanitizeKeyPart(service)), "1", timeToLive).Result()
}

func (store *RedisStore) Ping(ctx context.Context) error {
	return store.client.Ping(ctx).Err()
}

func (store *RedisStore) Close() error {
	return store.client.Close()
}

func (store *RedisStore) key(parts ...string) string {
	return store.keyPrefix + ":" + strings.Join(parts, ":")
}

func sanitizeKeyPart(value string) string {
	replacer := strings.NewReplacer(":", "_", " ", "_", "\n", "_", "\r", "_")
	return replacer.Replace(value)
}

func RetryAfterSeconds(delay time.Duration) int {
	seconds := int(math.Ceil(delay.Seconds()))
	if seconds < 1 {
		return 1
	}
	return seconds
}

func WorldCacheIdentifier(family, worldID string) string {
	return fmt.Sprintf("%s:%s", family, worldID)
}

func ShareCacheIdentifier(family, shareSlug string) string {
	return fmt.Sprintf("%s:%s", family, shareSlug)
}
