// Package clients: clientes do ERP, política de backup, histórico, status, retenção e links de compartilhamento.
package clients

import (
	"context"
	"errors"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("cliente não encontrado")

const (
	StatusOK         = "ok"
	StatusLate       = "late"
	StatusSuspicious = "suspicious"
	StatusMissing    = "missing"
	StatusError      = "error"
	StatusPending    = "pending"
	StatusInactive   = "inactive"
)

var AllStatuses = []string{StatusOK, StatusLate, StatusSuspicious, StatusMissing, StatusError, StatusPending, StatusInactive}

// Severity ordena "precisa de atenção": maior = pior.
func Severity(s string) int {
	switch s {
	case StatusError:
		return 5
	case StatusMissing:
		return 4
	case StatusLate:
		return 3
	case StatusSuspicious:
		return 2
	}
	return 0
}

func IsProblem(s string) bool { return Severity(s) > 0 }

type Policy struct {
	ExpectedEveryHours int    `json:"expectedEveryHours"`
	GraceHours         int    `json:"graceHours"`
	MinSizeBytes       int64  `json:"minSizeBytes"`
	SizeDropPct        int    `json:"sizeDropPct"`
	FilePattern        string `json:"filePattern"`
	RetentionDays      int    `json:"retentionDays"`
	RetentionMinKeep   int    `json:"retentionMinKeep"`
	RetentionAuto      bool   `json:"retentionAuto"`
}

func DefaultPolicy() Policy {
	return Policy{ExpectedEveryHours: 24, GraceHours: 6, MinSizeBytes: 1024, SizeDropPct: 50, FilePattern: "*", RetentionMinKeep: 7}
}

// Patterns devolve os globs normalizados (minúsculos).
func (p Policy) Patterns() []string {
	var out []string
	for _, g := range strings.Split(p.FilePattern, ",") {
		if g = strings.ToLower(strings.TrimSpace(g)); g != "" {
			out = append(out, g)
		}
	}
	if len(out) == 0 {
		out = []string{"*"}
	}
	return out
}

// Matches testa o nome do arquivo (sem diretórios) contra os globs.
func (p Policy) Matches(key string) bool {
	if strings.HasSuffix(key, "/") {
		return false
	}
	name := strings.ToLower(path.Base(key))
	for _, g := range p.Patterns() {
		if ok, _ := path.Match(g, name); ok {
			return true
		}
	}
	return false
}

func (p Policy) validate() error {
	switch {
	case p.ExpectedEveryHours < 1 || p.ExpectedEveryHours > 24*90:
		return errors.New("frequência esperada deve estar entre 1 hora e 90 dias")
	case p.GraceHours < 0 || p.GraceHours > 24*30:
		return errors.New("tolerância inválida")
	case p.MinSizeBytes < 0:
		return errors.New("tamanho mínimo inválido")
	case p.SizeDropPct < 0 || p.SizeDropPct > 100:
		return errors.New("queda de tamanho deve estar entre 0 e 100%")
	case p.RetentionDays < 0:
		return errors.New("retenção inválida")
	case p.RetentionMinKeep < 1:
		return errors.New("é preciso manter pelo menos 1 backup")
	}
	for _, g := range p.Patterns() {
		if _, err := path.Match(g, "x"); err != nil {
			return errors.New("padrão de arquivo inválido: " + g)
		}
	}
	return nil
}

type Client struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Document       string     `json:"document"`
	ContactName    string     `json:"contactName"`
	ContactEmail   string     `json:"contactEmail"`
	ContactPhone   string     `json:"contactPhone"`
	Notes          string     `json:"notes"`
	Tags           []string   `json:"tags"`
	Active         bool       `json:"active"`
	ConnectionID   string     `json:"connectionId"`
	ConnectionName string     `json:"connectionName"`
	Bucket         string     `json:"bucket"`
	Prefix         string     `json:"prefix"`
	Policy         Policy     `json:"policy"`
	Status         string     `json:"status"`
	StatusReason   string     `json:"statusReason"`
	StatusChanged  *time.Time `json:"statusChangedAt"`
	LastBackupAt   *time.Time `json:"lastBackupAt"`
	LastBackupKey  *string    `json:"lastBackupKey"`
	LastBackupSize *int64     `json:"lastBackupSize"`
	BackupCount    int        `json:"backupCount"`
	TotalBytes     int64      `json:"totalBytes"`
	LastScanAt     *time.Time `json:"lastScanAt"`
	LastScanError  *string    `json:"lastScanError"`
	IngestPrefix   *string    `json:"ingestTokenPrefix"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type PolicyInput struct {
	ExpectedEveryHours *int    `json:"expectedEveryHours"`
	GraceHours         *int    `json:"graceHours"`
	MinSizeBytes       *int64  `json:"minSizeBytes"`
	SizeDropPct        *int    `json:"sizeDropPct"`
	FilePattern        *string `json:"filePattern"`
	RetentionDays      *int    `json:"retentionDays"`
	RetentionMinKeep   *int    `json:"retentionMinKeep"`
	RetentionAuto      *bool   `json:"retentionAuto"`
}

type Input struct {
	Name         *string      `json:"name"`
	Document     *string      `json:"document"`
	ContactName  *string      `json:"contactName"`
	ContactEmail *string      `json:"contactEmail"`
	ContactPhone *string      `json:"contactPhone"`
	Notes        *string      `json:"notes"`
	Tags         *[]string    `json:"tags"`
	Active       *bool        `json:"active"`
	ConnectionID *string      `json:"connectionId"`
	Bucket       *string      `json:"bucket"`
	Prefix       *string      `json:"prefix"`
	Policy       *PolicyInput `json:"policy"`
}

func digits(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, s)
}

// NormalizePrefix remove "/" inicial e garante "/" final (ou vazio = bucket inteiro).
func NormalizePrefix(p string) string {
	p = strings.TrimLeft(strings.TrimSpace(p), "/")
	if p != "" && !strings.HasSuffix(p, "/") {
		p += "/"
	}
	return p
}

// Apply aplica o input e valida. Retorna se o local ou a política mudaram (exige nova varredura).
func (in Input) Apply(c *Client) (rescan bool, err error) {
	str := func(dst *string, src *string) {
		if src != nil {
			*dst = strings.TrimSpace(*src)
		}
	}
	str(&c.Name, in.Name)
	str(&c.ContactName, in.ContactName)
	str(&c.ContactEmail, in.ContactEmail)
	str(&c.ContactPhone, in.ContactPhone)
	str(&c.Notes, in.Notes)
	if in.Document != nil {
		c.Document = digits(*in.Document)
	}
	if in.Tags != nil {
		seen := map[string]bool{}
		c.Tags = []string{}
		for _, t := range *in.Tags {
			if t = strings.TrimSpace(t); t != "" && !seen[strings.ToLower(t)] {
				seen[strings.ToLower(t)] = true
				c.Tags = append(c.Tags, t)
			}
		}
	}
	if in.Active != nil && *in.Active != c.Active {
		c.Active = *in.Active
		rescan = true
	}
	before := c.ConnectionID + "|" + c.Bucket + "|" + c.Prefix
	str(&c.ConnectionID, in.ConnectionID)
	str(&c.Bucket, in.Bucket)
	if in.Prefix != nil {
		c.Prefix = NormalizePrefix(*in.Prefix)
	}
	if c.ConnectionID+"|"+c.Bucket+"|"+c.Prefix != before {
		rescan = true
	}
	if p := in.Policy; p != nil {
		old := c.Policy
		if p.ExpectedEveryHours != nil {
			c.Policy.ExpectedEveryHours = *p.ExpectedEveryHours
		}
		if p.GraceHours != nil {
			c.Policy.GraceHours = *p.GraceHours
		}
		if p.MinSizeBytes != nil {
			c.Policy.MinSizeBytes = *p.MinSizeBytes
		}
		if p.SizeDropPct != nil {
			c.Policy.SizeDropPct = *p.SizeDropPct
		}
		if p.FilePattern != nil {
			c.Policy.FilePattern = strings.TrimSpace(*p.FilePattern)
			if c.Policy.FilePattern == "" {
				c.Policy.FilePattern = "*"
			}
		}
		if p.RetentionDays != nil {
			c.Policy.RetentionDays = *p.RetentionDays
		}
		if p.RetentionMinKeep != nil {
			c.Policy.RetentionMinKeep = *p.RetentionMinKeep
		}
		if p.RetentionAuto != nil {
			c.Policy.RetentionAuto = *p.RetentionAuto
		}
		if c.Policy != old {
			rescan = true
		}
	}
	if c.Name == "" {
		return false, errors.New("nome é obrigatório")
	}
	if n := len(c.Document); n != 0 && n != 11 && n != 14 {
		return false, errors.New("documento deve ser um CPF (11 dígitos) ou CNPJ (14 dígitos)")
	}
	if c.ConnectionID == "" || c.Bucket == "" {
		return false, errors.New("conexão e bucket são obrigatórios")
	}
	if strings.Contains(c.Prefix, "..") {
		return false, errors.New("prefixo inválido")
	}
	if c.Tags == nil {
		c.Tags = []string{}
	}
	return rescan, c.Policy.validate()
}

type Store struct{ db *pgxpool.Pool }

func NewStore(db *pgxpool.Pool) *Store { return &Store{db: db} }

const clientCols = `c.id, c.name, c.document, c.contact_name, c.contact_email, c.contact_phone, c.notes, c.tags, c.active,
	c.connection_id, COALESCE(k.name, ''), c.bucket, c.prefix,
	c.expected_every_hours, c.grace_hours, c.min_size_bytes, c.size_drop_pct, c.file_pattern,
	c.retention_days, c.retention_min_keep, c.retention_auto,
	c.status, c.status_reason, c.status_changed_at, c.last_backup_at, c.last_backup_key, c.last_backup_size,
	c.backup_count, c.total_bytes, c.last_scan_at, c.last_scan_error, c.ingest_token_prefix, c.created_at, c.updated_at`

const clientFrom = ` FROM clients c LEFT JOIN connections k ON k.id = c.connection_id`

func scanClient(row pgx.Row) (*Client, error) {
	var c Client
	p := &c.Policy
	err := row.Scan(&c.ID, &c.Name, &c.Document, &c.ContactName, &c.ContactEmail, &c.ContactPhone, &c.Notes, &c.Tags, &c.Active,
		&c.ConnectionID, &c.ConnectionName, &c.Bucket, &c.Prefix,
		&p.ExpectedEveryHours, &p.GraceHours, &p.MinSizeBytes, &p.SizeDropPct, &p.FilePattern,
		&p.RetentionDays, &p.RetentionMinKeep, &p.RetentionAuto,
		&c.Status, &c.StatusReason, &c.StatusChanged, &c.LastBackupAt, &c.LastBackupKey, &c.LastBackupSize,
		&c.BackupCount, &c.TotalBytes, &c.LastScanAt, &c.LastScanError, &c.IngestPrefix, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if c.Tags == nil {
		c.Tags = []string{}
	}
	return &c, err
}

type ListFilter struct {
	Q        string
	Statuses []string
	Active   *bool
	Problems bool // só ativos com status de problema, piores primeiro
	Limit    int
}

func (s *Store) List(ctx context.Context, f ListFilter) ([]*Client, error) {
	q := `SELECT ` + clientCols + clientFrom + ` WHERE true`
	args := []any{}
	arg := func(v any) string {
		args = append(args, v)
		return "$" + itoa(len(args))
	}
	if f.Q != "" {
		like := arg("%" + f.Q + "%")
		d := digits(f.Q)
		cond := `(c.name ILIKE ` + like + ` OR c.contact_name ILIKE ` + like + ` OR EXISTS (SELECT 1 FROM unnest(c.tags) t WHERE t ILIKE ` + like + `)`
		if d != "" {
			cond += ` OR c.document LIKE ` + arg("%"+d+"%")
		}
		q += " AND " + cond + ")"
	}
	if len(f.Statuses) > 0 {
		q += " AND c.status = ANY(" + arg(f.Statuses) + ")"
	}
	if f.Active != nil {
		q += " AND c.active = " + arg(*f.Active)
	}
	if f.Problems {
		q += ` AND c.active AND c.status IN ('error','missing','late','suspicious')
			ORDER BY CASE c.status WHEN 'error' THEN 1 WHEN 'missing' THEN 2 WHEN 'late' THEN 3 ELSE 4 END,
			c.last_backup_at ASC NULLS FIRST, c.name`
	} else {
		q += " ORDER BY c.name"
	}
	if f.Limit > 0 {
		q += " LIMIT " + arg(f.Limit)
	}
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Client{}
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) Get(ctx context.Context, id string) (*Client, error) {
	return scanClient(s.db.QueryRow(ctx, `SELECT `+clientCols+clientFrom+` WHERE c.id::text = $1`, id))
}

func (s *Store) Create(ctx context.Context, c *Client) (*Client, error) {
	var id string
	p := c.Policy
	status, reason := StatusPending, "Aguardando primeira varredura"
	if !c.Active {
		status, reason = StatusInactive, "Cliente desativado"
	}
	err := s.db.QueryRow(ctx, `INSERT INTO clients (name, document, contact_name, contact_email, contact_phone, notes, tags, active,
		connection_id, bucket, prefix, expected_every_hours, grace_hours, min_size_bytes, size_drop_pct, file_pattern,
		retention_days, retention_min_keep, retention_auto, status, status_reason, status_changed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now()) RETURNING id`,
		c.Name, c.Document, c.ContactName, c.ContactEmail, c.ContactPhone, c.Notes, c.Tags, c.Active,
		c.ConnectionID, c.Bucket, c.Prefix, p.ExpectedEveryHours, p.GraceHours, p.MinSizeBytes, p.SizeDropPct, p.FilePattern,
		p.RetentionDays, p.RetentionMinKeep, p.RetentionAuto, status, reason).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

func (s *Store) Update(ctx context.Context, c *Client) (*Client, error) {
	p := c.Policy
	tag, err := s.db.Exec(ctx, `UPDATE clients SET name=$2, document=$3, contact_name=$4, contact_email=$5, contact_phone=$6,
		notes=$7, tags=$8, active=$9, connection_id=$10, bucket=$11, prefix=$12, expected_every_hours=$13, grace_hours=$14,
		min_size_bytes=$15, size_drop_pct=$16, file_pattern=$17, retention_days=$18, retention_min_keep=$19, retention_auto=$20,
		status = CASE WHEN NOT $9 THEN 'inactive' WHEN status = 'inactive' THEN 'pending' ELSE status END,
		status_reason = CASE WHEN NOT $9 THEN 'Cliente desativado' WHEN status = 'inactive' THEN 'Aguardando varredura' ELSE status_reason END,
		status_changed_at = CASE WHEN (NOT $9) <> (status = 'inactive') THEN now() ELSE status_changed_at END,
		updated_at=now() WHERE id=$1`,
		c.ID, c.Name, c.Document, c.ContactName, c.ContactEmail, c.ContactPhone, c.Notes, c.Tags, c.Active,
		c.ConnectionID, c.Bucket, c.Prefix, p.ExpectedEveryHours, p.GraceHours, p.MinSizeBytes, p.SizeDropPct, p.FilePattern,
		p.RetentionDays, p.RetentionMinKeep, p.RetentionAuto)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, c.ID)
}

func (s *Store) Delete(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM clients WHERE id::text=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CountByConnection(ctx context.Context, connID string) (int, error) {
	var n int
	err := s.db.QueryRow(ctx, `SELECT count(*) FROM clients WHERE connection_id::text=$1`, connID).Scan(&n)
	return n, err
}

// DueForScan devolve clientes ativos cuja última varredura é mais antiga que interval.
func (s *Store) DueForScan(ctx context.Context, interval time.Duration) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT id FROM clients WHERE active AND (last_scan_at IS NULL OR last_scan_at < now() - make_interval(secs => $1))`,
		interval.Seconds())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	return itoa(i/10) + string(rune('0'+i%10))
}
