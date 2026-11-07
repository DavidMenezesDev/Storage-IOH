// Package auth: usuários com papéis (bcrypt) e sessões em Redis.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

const CookieName = "ioh_session"

const (
	RoleAdmin    = "admin"
	RoleOperator = "operator"
	RoleViewer   = "viewer"
)

var roleRank = map[string]int{RoleViewer: 1, RoleOperator: 2, RoleAdmin: 3}

var (
	ErrInvalid   = errors.New("e-mail ou senha inválidos")
	ErrNotFound  = errors.New("usuário não encontrado")
	ErrLastAdmin = errors.New("é preciso manter pelo menos um administrador ativo")
	ErrDuplicate = errors.New("já existe um usuário com este e-mail")
)

var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("storage-ioh-dummy"), bcrypt.DefaultCost)

type User struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	Name        string     `json:"name"`
	Role        string     `json:"role"`
	Active      bool       `json:"active"`
	CreatedAt   time.Time  `json:"createdAt"`
	LastLoginAt *time.Time `json:"lastLoginAt"`
}

// Can informa se o usuário tem pelo menos o papel pedido.
func (u *User) Can(role string) bool { return u != nil && roleRank[u.Role] >= roleRank[role] }

type Service struct {
	db     *pgxpool.Pool
	rdb    *redis.Client
	ttl    time.Duration
	secure bool
}

func New(db *pgxpool.Pool, rdb *redis.Client, ttl time.Duration, secure bool) *Service {
	return &Service{db: db, rdb: rdb, ttl: ttl, secure: secure}
}

const userCols = `id, email, name, role, active, created_at, last_login_at`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.Active, &u.CreatedAt, &u.LastLoginAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

// Bootstrap cria o admin inicial se ainda não existir nenhum usuário.
func (s *Service) Bootstrap(ctx context.Context, email, password string) (created bool, err error) {
	var n int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
		return false, err
	}
	if n > 0 {
		return false, nil
	}
	if len(password) < 8 {
		return false, errors.New("ADMIN_PASSWORD precisa ter pelo menos 8 caracteres para criar o usuário inicial")
	}
	_, err = s.Create(ctx, email, "Administrador", RoleAdmin, password)
	return err == nil, err
}

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func validate(email, role, password string, needPassword bool) error {
	if _, err := mail.ParseAddress(email); err != nil && !strings.HasSuffix(email, "@local") {
		return errors.New("e-mail inválido")
	}
	if _, ok := roleRank[role]; !ok {
		return errors.New("papel deve ser admin, operator ou viewer")
	}
	if (needPassword || password != "") && len(password) < 8 {
		return errors.New("a senha precisa ter pelo menos 8 caracteres")
	}
	return nil
}

func (s *Service) Create(ctx context.Context, email, name, role, password string) (*User, error) {
	email = normEmail(email)
	if err := validate(email, role, password, true); err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	u, err := scanUser(s.db.QueryRow(ctx, `INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING `+userCols,
		email, strings.TrimSpace(name), role, string(hash)))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return nil, ErrDuplicate
	}
	return u, err
}

func (s *Service) List(ctx context.Context) ([]*User, error) {
	rows, err := s.db.Query(ctx, `SELECT `+userCols+` FROM users ORDER BY name, email`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Service) Get(ctx context.Context, id string) (*User, error) {
	u, err := scanUser(s.db.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id::text = $1`, id))
	return u, err
}

type UserPatch struct {
	Name     *string `json:"name"`
	Role     *string `json:"role"`
	Active   *bool   `json:"active"`
	Password *string `json:"password"`
}

func (s *Service) Update(ctx context.Context, id string, p UserPatch) (*User, error) {
	u, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		u.Name = strings.TrimSpace(*p.Name)
	}
	if p.Role != nil {
		u.Role = *p.Role
	}
	if p.Active != nil {
		u.Active = *p.Active
	}
	pw := ""
	if p.Password != nil {
		pw = *p.Password
	}
	if err := validate(u.Email, u.Role, pw, false); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE users SET name=$2, role=$3, active=$4 WHERE id=$1`, id, u.Name, u.Role, u.Active); err != nil {
		return nil, err
	}
	if pw != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash=$2 WHERE id=$1`, id, string(hash)); err != nil {
			return nil, err
		}
	}
	var admins int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE role='admin' AND active`).Scan(&admins); err != nil {
		return nil, err
	}
	if admins == 0 {
		return nil, ErrLastAdmin
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if !u.Active || pw != "" {
		s.dropSessions(ctx, id)
	}
	return u, nil
}

func (s *Service) Delete(ctx context.Context, id string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `DELETE FROM users WHERE id::text=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	var admins int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE role='admin' AND active`).Scan(&admins); err != nil {
		return err
	}
	if admins == 0 {
		return ErrLastAdmin
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.dropSessions(ctx, id)
	return nil
}

func (s *Service) ChangePassword(ctx context.Context, id, current, next string) error {
	var hash string
	if err := s.db.QueryRow(ctx, `SELECT password_hash FROM users WHERE id=$1`, id).Scan(&hash); err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(current)) != nil {
		return errors.New("senha atual incorreta")
	}
	if len(next) < 8 {
		return errors.New("a nova senha precisa ter pelo menos 8 caracteres")
	}
	nh, err := bcrypt.GenerateFromPassword([]byte(next), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE users SET password_hash=$2 WHERE id=$1`, id, string(nh))
	return err
}

func (s *Service) Login(ctx context.Context, email, password string) (*User, string, error) {
	var hash string
	var id string
	var active bool
	err := s.db.QueryRow(ctx, `SELECT id, password_hash, active FROM users WHERE email = $1`, normEmail(email)).Scan(&id, &hash, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password)) // custo constante
		return nil, "", ErrInvalid
	}
	if err != nil {
		return nil, "", err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil || !active {
		return nil, "", ErrInvalid
	}
	u, err := scanUser(s.db.QueryRow(ctx, `UPDATE users SET last_login_at=now() WHERE id=$1 RETURNING `+userCols, id))
	if err != nil {
		return nil, "", err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, "", err
	}
	token := hex.EncodeToString(raw)
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, sessKey(token), u.ID, s.ttl)
	pipe.SAdd(ctx, userSessKey(u.ID), sessKey(token))
	pipe.Expire(ctx, userSessKey(u.ID), s.ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, "", err
	}
	return u, token, nil
}

func (s *Service) Logout(ctx context.Context, token string) {
	s.rdb.Del(ctx, sessKey(token))
}

func (s *Service) dropSessions(ctx context.Context, userID string) {
	keys, _ := s.rdb.SMembers(ctx, userSessKey(userID)).Result()
	if len(keys) > 0 {
		s.rdb.Del(ctx, keys...)
	}
	s.rdb.Del(ctx, userSessKey(userID))
}

// Resolve carrega o usuário da sessão a cada requisição (papel/desativação valem na hora).
func (s *Service) Resolve(ctx context.Context, token string) (*User, error) {
	if token == "" {
		return nil, ErrInvalid
	}
	v, err := s.rdb.Get(ctx, sessKey(token)).Result()
	if err != nil {
		return nil, ErrInvalid
	}
	id, _, _ := strings.Cut(v, "|") // formato antigo "id|email"
	u, err := s.Get(ctx, id)
	if err != nil || !u.Active {
		return nil, ErrInvalid
	}
	return u, nil
}

// AllowLogin limita tentativas por chave (IP) em janela de 15 minutos.
func (s *Service) AllowLogin(ctx context.Context, key string) bool {
	k := "loginrl:" + key
	n, err := s.rdb.Incr(ctx, k).Result()
	if err != nil {
		return true
	}
	if n == 1 {
		s.rdb.Expire(ctx, k, 15*time.Minute)
	}
	return n <= 10
}

func (s *Service) ResetLoginLimit(ctx context.Context, key string) { s.rdb.Del(ctx, "loginrl:"+key) }

func (s *Service) SetCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: token, Path: "/", HttpOnly: true, Secure: s.secure,
		SameSite: http.SameSiteLaxMode, MaxAge: int(s.ttl.Seconds()),
	})
}

func (s *Service) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", HttpOnly: true, Secure: s.secure,
		SameSite: http.SameSiteLaxMode, MaxAge: -1})
}

func sessKey(token string) string {
	h := sha256.Sum256([]byte(token))
	return "sess:" + hex.EncodeToString(h[:])
}

func userSessKey(id string) string { return "usess:" + id }

type ctxKey struct{}

func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

func UserFrom(ctx context.Context) *User {
	u, _ := ctx.Value(ctxKey{}).(*User)
	return u
}
