// Package cache guarda listagens no Redis com invalidação por "geração" de bucket.
package cache

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

type Cache struct {
	rdb *redis.Client
	ttl time.Duration
}

func New(rdb *redis.Client, ttl time.Duration) *Cache { return &Cache{rdb: rdb, ttl: ttl} }

func genKey(conn, bucket string) string { return "lsgen:" + conn + ":" + bucket }

func (c *Cache) gen(ctx context.Context, conn, bucket string) string {
	v, err := c.rdb.Get(ctx, genKey(conn, bucket)).Int64()
	if err != nil {
		return "0"
	}
	return strconv.FormatInt(v, 10)
}

func (c *Cache) key(ctx context.Context, conn, bucket, prefix, cursor string, limit int32) string {
	return "ls:" + conn + ":" + bucket + ":" + c.gen(ctx, conn, bucket) + ":" + strconv.Itoa(int(limit)) + ":" + cursor + ":" + prefix
}

// GetListing tenta ler a listagem do cache. Falhas do Redis são tratadas como cache miss.
func (c *Cache) GetListing(ctx context.Context, conn, bucket, prefix, cursor string, limit int32, out any) bool {
	if c.ttl <= 0 {
		return false
	}
	b, err := c.rdb.Get(ctx, c.key(ctx, conn, bucket, prefix, cursor, limit)).Bytes()
	if err != nil {
		return false
	}
	return json.Unmarshal(b, out) == nil
}

func (c *Cache) SetListing(ctx context.Context, conn, bucket, prefix, cursor string, limit int32, v any) {
	if c.ttl <= 0 {
		return
	}
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.rdb.Set(ctx, c.key(ctx, conn, bucket, prefix, cursor, limit), b, c.ttl)
}

// Invalidate faz todas as listagens do bucket expirarem logicamente.
func (c *Cache) Invalidate(ctx context.Context, conn, bucket string) {
	c.rdb.Incr(ctx, genKey(conn, bucket))
}
