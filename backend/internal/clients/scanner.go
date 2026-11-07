package clients

import (
	"context"
	"errors"
	"log/slog"
	"path"
	"sort"
	"time"

	"storage-ioh/internal/audit"
	"storage-ioh/internal/connections"
	"storage-ioh/internal/objects"
	"storage-ioh/internal/storage"
)

// Notifier recebe transições de status (implementado por alerts.Service).
type Notifier interface {
	Notify(ctx context.Context, clientID, from, to, message string) error
}

type Scanner struct {
	Store  *Store
	Conns  *connections.Store
	Pool   *storage.Pool
	Notify Notifier
	Audit  *audit.Log
	Log    *slog.Logger
	Now    func() time.Time
}

func (s *Scanner) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Target resolve o cliente de storage para o local do cliente.
func (s *Scanner) Target(ctx context.Context, c *Client) (*storage.Client, error) {
	conn, err := s.Conns.Get(ctx, c.ConnectionID)
	if err != nil {
		return nil, err
	}
	return s.Pool.For(conn), nil
}

// List lê do storage todos os backups do cliente (filtrados pela política), do mais novo para o mais antigo.
func (s *Scanner) List(ctx context.Context, c *Client) ([]Backup, error) {
	cl, err := s.Target(ctx, c)
	if err != nil {
		return nil, err
	}
	var out []Backup
	err = cl.Walk(ctx, c.Bucket, c.Prefix, func(items []objects.Item) error {
		for _, it := range items {
			if c.Policy.Matches(it.Key) {
				out = append(out, Backup{Key: it.Key, Name: path.Base(it.Key), Size: it.Size, LastModified: it.LastModified, ETag: it.ETag})
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastModified.Equal(out[j].LastModified) {
			return out[i].Key > out[j].Key
		}
		return out[i].LastModified.After(out[j].LastModified)
	})
	return out, nil
}

// Scan varre o local do cliente, atualiza histórico/status, aplica retenção automática e dispara alertas.
func (s *Scanner) Scan(ctx context.Context, clientID string) error {
	c, err := s.Store.Get(ctx, clientID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if !c.Active {
		return nil
	}
	all, listErr := s.List(ctx, c)
	scanErr := ""
	if listErr != nil {
		if errors.Is(listErr, context.Canceled) {
			return listErr
		}
		scanErr = listErr.Error()
	}
	if scanErr == "" && c.Policy.RetentionAuto {
		if cands := RetentionCandidates(s.now(), c.Policy, all); len(cands) > 0 {
			deleted, bytes, err := s.deleteBackups(ctx, c, cands)
			if err != nil {
				s.Log.Error("retenção automática falhou", "client", c.Name, "err", err)
			}
			if deleted > 0 {
				s.Audit.Record(ctx, audit.Event{UserEmail: "sistema", Action: "retention.apply", ClientID: c.ID, ClientName: c.Name,
					ConnectionID: c.ConnectionID, Bucket: c.Bucket, Detail: map[string]any{"deleted": deleted, "bytes": bytes, "auto": true}})
				gone := map[string]bool{}
				for _, b := range cands[:deleted] {
					gone[b.Key] = true
				}
				kept := all[:0]
				for _, b := range all {
					if !gone[b.Key] {
						kept = append(kept, b)
					}
				}
				all = kept
			}
		}
	}
	recent := all
	if len(recent) > 8 {
		recent = recent[:8]
	}
	if scanErr != "" {
		// mantém o histórico anterior; avalia só o erro
		recent = nil
	}
	status, reason := Evaluate(s.now(), c, recent, scanErr)
	prev, err := s.Store.ReplaceBackups(ctx, c, all, status, reason, scanErr)
	if err != nil {
		return err
	}
	if prev != status && s.Notify != nil {
		if err := s.Notify.Notify(ctx, c.ID, prev, status, reason); err != nil {
			s.Log.Error("falha ao registrar alerta", "client", c.Name, "err", err)
		}
	}
	return nil
}

// deleteBackups apaga do storage, na ordem dada. Devolve quantos apagou (prefixo da lista) e bytes liberados.
func (s *Scanner) deleteBackups(ctx context.Context, c *Client, list []Backup) (int, int64, error) {
	cl, err := s.Target(ctx, c)
	if err != nil {
		return 0, 0, err
	}
	keys := make([]string, len(list))
	for i, b := range list {
		keys[i] = b.Key
	}
	n, err := cl.DeleteKeys(ctx, c.Bucket, keys)
	var bytes int64
	for _, b := range list[:n] {
		bytes += b.Size
	}
	return n, bytes, err
}

// ApplyRetention aplica a retenção manualmente (admin) e re-varre o cliente.
func (s *Scanner) ApplyRetention(ctx context.Context, c *Client) (int, int64, error) {
	all, err := s.Store.AllBackups(ctx, c.ID)
	if err != nil {
		return 0, 0, err
	}
	cands := RetentionCandidates(s.now(), c.Policy, all)
	if len(cands) == 0 {
		return 0, 0, nil
	}
	n, bytes, err := s.deleteBackups(ctx, c, cands)
	if serr := s.Scan(ctx, c.ID); serr != nil {
		s.Log.Error("re-varredura após retenção falhou", "client", c.Name, "err", serr)
	}
	return n, bytes, err
}

// Preview mostra o que a retenção apagaria.
func (s *Scanner) Preview(ctx context.Context, c *Client) ([]Backup, int64, int, error) {
	all, err := s.Store.AllBackups(ctx, c.ID)
	if err != nil {
		return nil, 0, 0, err
	}
	cands := RetentionCandidates(s.now(), c.Policy, all)
	var bytes int64
	for _, b := range cands {
		bytes += b.Size
	}
	if cands == nil {
		cands = []Backup{}
	}
	return cands, bytes, len(all) - len(cands), nil
}
