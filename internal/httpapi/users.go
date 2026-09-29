package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/security"
	"github.com/akmalfairuz/lightremote/internal/store"
	"github.com/akmalfairuz/lightremote/internal/work"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type UserHandler struct {
	users    *store.UserRepository
	auth     *security.AuthService
	sessions *work.Manager
}

// NewUserHandler wires administrator account management.
func NewUserHandler(users *store.UserRepository, auth *security.AuthService, sessions *work.Manager) *UserHandler {
	return &UserHandler{users: users, auth: auth, sessions: sessions}
}

// List returns login accounts to an administrator.
func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	users, err := h.users.List(r.Context())
	if err != nil {
		writeError(w, 500, "internal", "could not list users")
		return
	}
	accounts := make([]model.User, 0, len(users))
	for _, user := range users {
		if !security.IsLocalUserID(user.ID) {
			accounts = append(accounts, user)
		}
	}
	writeJSON(w, 200, accounts)
}

// Create adds an administrator-created account.
func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	if !validEmail(input.Email) || !validRole(input.Role) {
		writeError(w, 400, "invalid_user", "valid email and role are required")
		return
	}
	hash, err := security.HashPassword(input.Password)
	if err != nil {
		writeError(w, 400, "invalid_password", err.Error())
		return
	}
	user := model.User{
		ID:           uuid.NewString(),
		Email:        strings.ToLower(input.Email),
		PasswordHash: hash,
		Role:         input.Role,
		CreatedAt:    time.Now().UTC(),
	}
	if err := h.users.Create(r.Context(), user); err != nil {
		writeError(w, 409, "user_exists", "could not create user")
		return
	}
	writeJSON(w, 201, user)
}

// Update changes administrator-controlled account fields.
func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Disabled *bool   `json:"disabled"`
		Email    *string `json:"email"`
		Password *string `json:"password"`
		Role     *string `json:"role"`
	}
	if !readJSON(w, r, &input) {
		return
	}
	user, err := h.users.ByID(r.Context(), chi.URLParam(r, "userID"))
	if err != nil {
		writeError(w, 404, "not_found", "user not found")
		return
	}
	if security.IsLocalUserID(user.ID) {
		writeError(w, 404, "not_found", "user not found")
		return
	}
	emailChanged := false
	if input.Email != nil {
		if !validEmail(*input.Email) {
			writeError(w, 400, "invalid_email", "enter a valid email address")
			return
		}
		email := strings.ToLower(*input.Email)
		emailChanged = email != user.Email
		if emailChanged {
			existing, lookupErr := h.users.ByEmail(r.Context(), email)
			if lookupErr == nil && existing.ID != user.ID {
				writeError(w, 409, "email_taken", "email is already in use")
				return
			}
			if lookupErr != nil && !errors.Is(lookupErr, sql.ErrNoRows) {
				writeError(w, 500, "internal", "could not check email")
				return
			}
		}
		user.Email = email
	}
	if input.Role != nil {
		if !validRole(*input.Role) {
			writeError(w, 400, "invalid_role", "invalid role")
			return
		}
		user.Role = *input.Role
	}
	if input.Disabled != nil {
		user.Disabled = *input.Disabled
	}
	if user.ID == principal(r).User.ID && (user.Disabled || user.Role != "admin") {
		writeError(w, 400, "invalid_user", "cannot remove your own admin access")
		return
	}
	if input.Password != nil {
		hash, err := security.HashPassword(*input.Password)
		if err != nil {
			writeError(w, 400, "invalid_password", err.Error())
			return
		}
		user.PasswordHash = hash
	}
	if err := h.users.Update(r.Context(), user); err != nil {
		if emailChanged {
			existing, lookupErr := h.users.ByEmail(r.Context(), user.Email)
			if lookupErr == nil && existing.ID != user.ID {
				writeError(w, 409, "email_taken", "email is already in use")
				return
			}
		}
		writeError(w, 500, "internal", "could not update user")
		return
	}
	if user.Disabled || input.Password != nil {
		_ = h.auth.RevokeUser(r.Context(), user.ID)
		h.sessions.CloseUser(user.ID)
	}
	writeJSON(w, 200, user)
}

// validRole accepts the two account roles supported by this release.
func validRole(role string) bool {
	return role == "admin" || role == "user"
}

// validEmail rejects empty or control-bearing account identifiers.
func validEmail(email string) bool {
	return len(email) > 3 && len(email) <= 255 &&
		!strings.ContainsAny(email, " \t\r\n") && strings.Contains(email, "@")
}
