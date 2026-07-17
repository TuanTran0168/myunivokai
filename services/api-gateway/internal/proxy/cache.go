package proxy

import (
	"net/http"
	"sync"
	"time"
)

type cacheEntry struct {
	status    int
	headers   http.Header
	body      []byte
	expiresAt time.Time
}

type ResponseCache struct {
	timeToLive     time.Duration
	maximumEntries int
	mutex          sync.Mutex
	entries        map[string]cacheEntry
	now            func() time.Time
}

func NewResponseCache(timeToLive time.Duration, maximumEntries int) *ResponseCache {
	return &ResponseCache{
		timeToLive:     timeToLive,
		maximumEntries: maximumEntries,
		entries:        make(map[string]cacheEntry),
		now:            time.Now,
	}
}

func (cache *ResponseCache) Get(key string) (cacheEntry, bool) {
	cache.mutex.Lock()
	defer cache.mutex.Unlock()
	entry, exists := cache.entries[key]
	if !exists {
		return cacheEntry{}, false
	}
	if !cache.now().Before(entry.expiresAt) {
		delete(cache.entries, key)
		return cacheEntry{}, false
	}
	entry.headers = entry.headers.Clone()
	entry.body = append([]byte(nil), entry.body...)
	return entry, true
}

func (cache *ResponseCache) Set(key string, status int, headers http.Header, body []byte) {
	if cache.timeToLive <= 0 {
		return
	}
	cache.mutex.Lock()
	defer cache.mutex.Unlock()
	now := cache.now()
	for existingKey, entry := range cache.entries {
		if !now.Before(entry.expiresAt) {
			delete(cache.entries, existingKey)
		}
	}
	if len(cache.entries) >= cache.maximumEntries {
		for existingKey := range cache.entries {
			delete(cache.entries, existingKey)
			break
		}
	}
	cache.entries[key] = cacheEntry{
		status:    status,
		headers:   headers.Clone(),
		body:      append([]byte(nil), body...),
		expiresAt: now.Add(cache.timeToLive),
	}
}
