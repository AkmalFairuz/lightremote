package connections

import (
	"sync"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
)

const (
	maxCachedConnections = 512
	connectionCacheTTL   = time.Minute
)

type metadataCache struct {
	mu    sync.Mutex
	items map[string]cacheEntry
}

type cacheEntry struct {
	connection model.Connection
	expires    time.Time
}

// newMetadataCache creates a bounded, non-secret connection cache.
func newMetadataCache() *metadataCache {
	return &metadataCache{items: make(map[string]cacheEntry)}
}

// get returns a current metadata entry, if present.
func (c *metadataCache) get(id string) (model.Connection, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.items[id]
	if !ok || time.Now().After(entry.expires) {
		delete(c.items, id)
		return model.Connection{}, false
	}
	return entry.connection, true
}

// put drops encrypted credentials before caching metadata.
func (c *metadataCache) put(connection model.Connection) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.items) >= maxCachedConnections {
		for key := range c.items {
			delete(c.items, key)
			break
		}
	}
	connection.Secret = nil
	connection.ProxySecret = nil
	c.items[connection.ID] = cacheEntry{
		connection: connection,
		expires:    time.Now().Add(connectionCacheTTL),
	}
}

// delete invalidates metadata after a connection change.
func (c *metadataCache) delete(id string) {
	c.mu.Lock()
	delete(c.items, id)
	c.mu.Unlock()
}
