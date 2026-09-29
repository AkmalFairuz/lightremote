package store

import (
	"context"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/jmoiron/sqlx"
)

type UserRepository struct {
	db *sqlx.DB
}

// NewUserRepository creates a database-backed account repository.
func NewUserRepository(db *sqlx.DB) *UserRepository {
	return &UserRepository{db: db}
}

// AdminCount counts enabled administrators for initial bootstrap.
func (r *UserRepository) AdminCount(ctx context.Context) (int, error) {
	var count int
	err := r.db.GetContext(ctx, &count,
		"SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = FALSE")
	return count, err
}

// Create inserts an account.
func (r *UserRepository) Create(ctx context.Context, user model.User) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO users(id, email, password_hash, role, disabled, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		user.ID, user.Email, user.PasswordHash, user.Role, user.Disabled, user.CreatedAt)
	return err
}

// ByEmail looks up an account for login.
func (r *UserRepository) ByEmail(ctx context.Context, email string) (model.User, error) {
	var user model.User
	err := r.db.GetContext(ctx, &user,
		"SELECT * FROM users WHERE email = ?", email)
	return user, err
}

// ByID loads current account state for an authenticated session.
func (r *UserRepository) ByID(ctx context.Context, id string) (model.User, error) {
	var user model.User
	err := r.db.GetContext(ctx, &user,
		"SELECT * FROM users WHERE id = ?", id)
	return user, err
}

// List returns accounts in creation order.
func (r *UserRepository) List(ctx context.Context) ([]model.User, error) {
	users := []model.User{}
	err := r.db.SelectContext(ctx, &users,
		"SELECT * FROM users ORDER BY created_at")
	return users, err
}

// Update persists administrator-controlled account fields.
func (r *UserRepository) Update(ctx context.Context, user model.User) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE users SET email = ?, role = ?, disabled = ?, password_hash = ? WHERE id = ?`,
		user.Email, user.Role, user.Disabled, user.PasswordHash, user.ID)
	return err
}

// UpdatePassword replaces one account's password hash.
func (r *UserRepository) UpdatePassword(ctx context.Context, id, hash string) error {
	_, err := r.db.ExecContext(ctx,
		"UPDATE users SET password_hash = ? WHERE id = ?", hash, id)
	return err
}

type LoginSession struct {
	UserID    string    `db:"user_id"`
	CSRFToken string    `db:"csrf_token"`
	ExpiresAt time.Time `db:"expires_at"`
}

type LoginSessionRepository struct {
	db *sqlx.DB
}

// NewLoginSessionRepository creates persistent browser-session storage.
func NewLoginSessionRepository(db *sqlx.DB) *LoginSessionRepository {
	return &LoginSessionRepository{db: db}
}

// Create stores a hashed browser token and its CSRF value.
func (r *LoginSessionRepository) Create(ctx context.Context, tokenHash []byte, session LoginSession) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO login_sessions(token_hash, user_id, csrf_token, expires_at)
		VALUES (?, ?, ?, ?)`,
		tokenHash, session.UserID, session.CSRFToken, session.ExpiresAt)
	return err
}

// Get loads an unexpired browser session by token digest.
func (r *LoginSessionRepository) Get(ctx context.Context, tokenHash []byte) (LoginSession, error) {
	var session LoginSession
	err := r.db.GetContext(ctx, &session, `
		SELECT user_id, csrf_token, expires_at
		FROM login_sessions WHERE token_hash = ? AND expires_at > ?`,
		tokenHash, time.Now().UTC())
	return session, err
}

// Delete revokes one browser token.
func (r *LoginSessionRepository) Delete(ctx context.Context, tokenHash []byte) error {
	_, err := r.db.ExecContext(ctx,
		"DELETE FROM login_sessions WHERE token_hash = ?", tokenHash)
	return err
}

// DeleteUserExcept revokes a user's tokens, optionally preserving the current token.
func (r *LoginSessionRepository) DeleteUserExcept(ctx context.Context, userID string, except []byte) error {
	if except == nil {
		_, err := r.db.ExecContext(ctx,
			"DELETE FROM login_sessions WHERE user_id = ?", userID)
		return err
	}
	_, err := r.db.ExecContext(ctx,
		"DELETE FROM login_sessions WHERE user_id = ? AND token_hash <> ?",
		userID, except)
	return err
}

// DeleteExpired removes browser sessions whose lifetime has elapsed.
func (r *LoginSessionRepository) DeleteExpired(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx,
		"DELETE FROM login_sessions WHERE expires_at <= ?", time.Now().UTC())
	return err
}
