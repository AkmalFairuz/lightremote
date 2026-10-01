package security

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/google/uuid"
)

const (
	loginAttemptWindow   = 10 * time.Minute
	maxLoginAttemptKeys  = 4096
	maxAttemptsPerWindow = 10
)

var ErrInvalidCredentials = errors.New("invalid credentials")
var ErrRateLimited = errors.New("too many login attempts")
var ErrSetupComplete = errors.New("installation is already complete; sign in to continue")
var ErrInvalidSetup = errors.New("enter a valid administrator email")

type LoginResult struct {
	Token     string
	CSRFToken string
	ExpiresAt time.Time
	User      model.User
}

type Principal struct {
	User      model.User
	CSRFToken string
	TokenHash []byte
	ExpiresAt time.Time
}

type AuthService struct {
	users    *store.UserRepository
	sessions *store.LoginSessionRepository
	ttl      time.Duration

	mu       sync.Mutex
	attempts map[string][]time.Time
}

// NewAuthService creates account authentication backed by user and session repositories.
func NewAuthService(users *store.UserRepository, sessions *store.LoginSessionRepository, ttl time.Duration) *AuthService {
	return &AuthService{
		users:    users,
		sessions: sessions,
		ttl:      ttl,
		attempts: make(map[string][]time.Time),
	}
}

// BootstrapAdmin optionally preconfigures the administrator instead of browser installation.
func (s *AuthService) BootstrapAdmin(ctx context.Context, email, password string) error {
	if password == "" {
		return nil
	}
	err := s.SetupAdmin(ctx, email, password)
	if errors.Is(err, ErrSetupComplete) {
		return nil
	}
	return err
}

// SetupRequired reports whether any account exists besides the local-mode owner.
func (s *AuthService) SetupRequired(ctx context.Context) (bool, error) {
	count, err := s.users.AccountCount(ctx, localUserID)
	return count == 0, err
}

// AllowSetupAttempt bounds unauthenticated installation requests before password hashing.
func (s *AuthService) AllowSetupAttempt(clientKey string) bool {
	return s.allowAttempt("setup:" + clientKey)
}

// SetupAdmin creates the first administrator and rejects repeated installation requests.
func (s *AuthService) SetupAdmin(ctx context.Context, email, password string) error {
	required, err := s.SetupRequired(ctx)
	if err != nil {
		return err
	}
	if !required {
		return ErrSetupComplete
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if len(email) <= 3 || len(email) > 255 || !strings.Contains(email, "@") || strings.ContainsAny(email, " \t\r\n") || email == localUserEmail {
		return ErrInvalidSetup
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	created, err := s.users.CreateInitialAdmin(ctx, model.User{
		ID:           uuid.NewString(),
		Email:        email,
		PasswordHash: hash,
		Role:         "admin",
		CreatedAt:    time.Now().UTC(),
	}, localUserID)
	if err != nil {
		return err
	}
	if !created {
		return ErrSetupComplete
	}
	return nil
}

// Login verifies credentials and creates a revocable browser session.
func (s *AuthService) Login(ctx context.Context, clientKey, email, password string) (LoginResult, error) {
	if !s.allowAttempt(clientKey) {
		return LoginResult{}, ErrRateLimited
	}
	user, err := s.users.ByEmail(ctx, strings.ToLower(email))
	if err != nil || user.Disabled || !VerifyPassword(user.PasswordHash, password) {
		return LoginResult{}, ErrInvalidCredentials
	}
	token, err := RandomToken()
	if err != nil {
		return LoginResult{}, err
	}
	csrf, err := RandomToken()
	if err != nil {
		return LoginResult{}, err
	}
	expires := time.Now().UTC().Add(s.ttl)
	err = s.sessions.Create(ctx, TokenDigest(token), store.LoginSession{
		UserID:    user.ID,
		CSRFToken: csrf,
		ExpiresAt: expires,
	})
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{
		Token:     token,
		CSRFToken: csrf,
		ExpiresAt: expires,
		User:      user,
	}, nil
}

// Authenticate resolves a session token to the current account state.
func (s *AuthService) Authenticate(ctx context.Context, token string) (Principal, error) {
	digest := TokenDigest(token)
	session, err := s.sessions.Get(ctx, digest)
	if err != nil {
		return Principal{}, ErrInvalidCredentials
	}
	user, err := s.users.ByID(ctx, session.UserID)
	if err != nil || user.Disabled {
		return Principal{}, ErrInvalidCredentials
	}
	return Principal{
		User:      user,
		CSRFToken: session.CSRFToken,
		TokenHash: digest,
		ExpiresAt: session.ExpiresAt,
	}, nil
}

// Logout removes one login session.
func (s *AuthService) Logout(ctx context.Context, digest []byte) error {
	return s.sessions.Delete(ctx, digest)
}

// ChangePassword replaces the password and revokes other browser sessions.
func (s *AuthService) ChangePassword(ctx context.Context, principal Principal, current, next string) error {
	if !VerifyPassword(principal.User.PasswordHash, current) {
		return ErrInvalidCredentials
	}
	hash, err := HashPassword(next)
	if err != nil {
		return err
	}
	if err := s.users.UpdatePassword(ctx, principal.User.ID, hash); err != nil {
		return err
	}
	return s.sessions.DeleteUserExcept(ctx, principal.User.ID, principal.TokenHash)
}

// RevokeUser removes all browser sessions for a disabled or reset account.
func (s *AuthService) RevokeUser(ctx context.Context, userID string) error {
	return s.sessions.DeleteUserExcept(ctx, userID, nil)
}

// allowAttempt bounds all login attempts and its in-memory key map.
func (s *AuthService) allowAttempt(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().Add(-loginAttemptWindow)
	if len(s.attempts) >= maxLoginAttemptKeys {
		for address, attempts := range s.attempts {
			if len(attempts) == 0 || attempts[len(attempts)-1].Before(cutoff) {
				delete(s.attempts, address)
			}
		}
		if len(s.attempts) >= maxLoginAttemptKeys {
			for address := range s.attempts {
				delete(s.attempts, address)
				break
			}
		}
	}
	recent := make([]time.Time, 0, maxAttemptsPerWindow)
	for _, attempt := range s.attempts[key] {
		if attempt.After(cutoff) {
			recent = append(recent, attempt)
		}
	}
	if len(recent) >= maxAttemptsPerWindow {
		s.attempts[key] = recent
		return false
	}
	s.attempts[key] = append(recent, time.Now())
	return true
}
