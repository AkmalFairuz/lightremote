package config

import "testing"

func TestLocalModeRequiresLoopbackListenAddress(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "test-key")
	t.Setenv("DATABASE_DRIVER", "sqlite")
	t.Setenv("LOCAL_MODE", "true")

	for _, address := range []string{":8080", "0.0.0.0:8080", "example.com:8080"} {
		t.Setenv("LISTEN_ADDR", address)
		if _, err := LoadConfig(); err == nil {
			t.Fatalf("accepted non-loopback address %q", address)
		}
	}
	for _, address := range []string{"127.0.0.1:8080", "[::1]:8080"} {
		t.Setenv("LISTEN_ADDR", address)
		if _, err := LoadConfig(); err != nil {
			t.Fatalf("rejected loopback address %q: %v", address, err)
		}
	}
}
