package security

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
	"github.com/akmalfairuz/lightremote/internal/store"
)

const localUserID = "00000000-0000-0000-0000-000000000001"
const localUserEmail = "local@lightremote.invalid"

// IsLocalUserID identifies the reserved owner used outside account mode.
func IsLocalUserID(id string) bool {
	return id == localUserID
}

// BootstrapLocalUser creates a stable owner for connections in local mode.
func BootstrapLocalUser(ctx context.Context, users *store.UserRepository) (model.User, error) {
	user, err := users.ByID(ctx, localUserID)
	if err == nil {
		if user.Email != localUserEmail {
			return model.User{}, fmt.Errorf("reserved local user ID is already in use")
		}
		return user, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return model.User{}, err
	}
	user = model.User{
		ID:           localUserID,
		Email:        localUserEmail,
		PasswordHash: "local-mode-no-password",
		Role:         "user",
		CreatedAt:    time.Now().UTC(),
	}
	if err := users.Create(ctx, user); err != nil {
		return model.User{}, err
	}
	return user, nil
}
