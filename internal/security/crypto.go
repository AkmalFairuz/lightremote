package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/akmalfairuz/lightremote/internal/model"
	"golang.org/x/crypto/argon2"
)

const (
	vaultKeyBytes       = 32
	secretFormatVersion = 1
	minimumPasswordSize = 6
	passwordSaltBytes   = 16
	passwordHashBytes   = 32
	passwordIterations  = 3
	passwordMemoryKiB   = 64 * 1024
	passwordThreads     = 4
	randomTokenBytes    = 32
)

const passwordHashAlgorithm = "argon2id"

type Vault struct {
	aead cipher.AEAD
}

// NewVault builds a credential vault from a base64-encoded 32-byte key.
func NewVault(encoded string) (*Vault, error) {
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(key) != vaultKeyBytes {
		return nil, errors.New("ENCRYPTION_KEY must be a base64 encoded 32-byte key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	return &Vault{aead: aead}, err
}

// Seal encrypts data and binds it to an associated record identifier.
func (v *Vault) Seal(data []byte, associated string) ([]byte, error) {
	nonce := make([]byte, v.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return append([]byte{secretFormatVersion}, v.aead.Seal(nonce, nonce, data, []byte(associated))...), nil
}

// Open decrypts data only when its associated identifier matches.
func (v *Vault) Open(data []byte, associated string) ([]byte, error) {
	if len(data) < 1+v.aead.NonceSize() || data[0] != secretFormatVersion {
		return nil, errors.New("invalid secret envelope")
	}
	data = data[1:]
	return v.aead.Open(nil, data[:v.aead.NonceSize()], data[v.aead.NonceSize():], []byte(associated))
}

// HashPassword derives a salted Argon2id password hash.
func HashPassword(password string) (string, error) {
	if len(password) < minimumPasswordSize {
		return "", errors.New("password must be at least 6 characters")
	}
	salt := make([]byte, passwordSaltBytes)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", err
	}
	// The stored hash has no parameter fields. Keep these values stable so
	// existing passwords remain verifiable until the format is versioned.
	hash := derivePasswordHash(password, salt)
	encodedSalt := base64.RawStdEncoding.EncodeToString(salt)
	encodedHash := base64.RawStdEncoding.EncodeToString(hash)
	return passwordHashAlgorithm + "$" + encodedSalt + "$" + encodedHash, nil
}

// VerifyPassword compares a password with an encoded Argon2id hash.
func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 3 || parts[0] != passwordHashAlgorithm {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil || len(salt) != passwordSaltBytes {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil || len(want) != passwordHashBytes {
		return false
	}
	got := derivePasswordHash(password, salt)
	return subtle.ConstantTimeCompare(got, want) == 1
}

func derivePasswordHash(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, passwordIterations, passwordMemoryKiB, passwordThreads, passwordHashBytes)
}

// RandomToken creates a URL-safe cryptographic token.
func RandomToken() (string, error) {
	b := make([]byte, randomTokenBytes)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// TokenDigest stores a non-reversible representation of a browser token.
func TokenDigest(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// SealCredentials encrypts a connection's remote authentication material.
func (v *Vault) SealCredentials(id string, secret model.RemoteSecret) ([]byte, error) {
	data, err := json.Marshal(secret)
	if err != nil {
		return nil, err
	}
	return v.Seal(data, id)
}

// OpenCredentials decrypts saved remote authentication material.
func (v *Vault) OpenCredentials(connection model.Connection) (model.RemoteSecret, error) {
	var secret model.RemoteSecret
	if len(connection.Secret) == 0 {
		return secret, nil
	}
	data, err := v.Open(connection.Secret, connection.ID)
	if err != nil {
		return secret, err
	}
	err = json.Unmarshal(data, &secret)
	return secret, err
}

// SealProxyPassword encrypts proxy authentication separately from remote credentials.
func (v *Vault) SealProxyPassword(id, password string) ([]byte, error) {
	return v.Seal([]byte(password), id+":proxy")
}

// OpenProxyPassword decrypts a saved proxy password for one connection.
func (v *Vault) OpenProxyPassword(connection model.Connection) (string, error) {
	if len(connection.ProxySecret) == 0 {
		return "", nil
	}
	plain, err := v.Open(connection.ProxySecret, connection.ID+":proxy")
	return string(plain), err
}
