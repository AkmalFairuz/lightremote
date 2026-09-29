package sshkeys

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"strings"

	"golang.org/x/crypto/ssh"
)

type GenerateInput struct {
	Name       string `json:"name"`
	Algorithm  string `json:"algorithm"`
	Passphrase string `json:"passphrase"`
}

type GeneratedKey struct {
	PrivateKey string `json:"privateKey"`
	PublicKey  string `json:"publicKey"`
}

// Generate creates a key pair without saving either key.
func Generate(input GenerateInput) (GeneratedKey, error) {
	if !validName(input.Name) {
		return GeneratedKey{}, ErrInvalid
	}

	var privateKey crypto.PrivateKey
	var publicKey crypto.PublicKey
	switch input.Algorithm {
	case "ed25519":
		public, private, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return GeneratedKey{}, err
		}
		privateKey = private
		publicKey = public
	case "ecdsa_p256":
		private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return GeneratedKey{}, err
		}
		privateKey = private
		publicKey = &private.PublicKey
	case "rsa4096":
		private, err := rsa.GenerateKey(rand.Reader, 4096)
		if err != nil {
			return GeneratedKey{}, err
		}
		privateKey = private
		publicKey = &private.PublicKey
	default:
		return GeneratedKey{}, ErrInvalid
	}

	var block *pem.Block
	var err error
	if input.Passphrase == "" {
		block, err = ssh.MarshalPrivateKey(privateKey, input.Name)
	} else {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(privateKey, input.Name, []byte(input.Passphrase))
	}
	if err != nil {
		return GeneratedKey{}, err
	}
	public, err := ssh.NewPublicKey(publicKey)
	if err != nil {
		return GeneratedKey{}, err
	}
	privateText := string(pem.EncodeToMemory(block))
	publicText := strings.TrimSuffix(string(ssh.MarshalAuthorizedKey(public)), "\n") + " " + input.Name + "\n"

	return GeneratedKey{
		PrivateKey: privateText,
		PublicKey:  publicText,
	}, nil
}
