package work

import "testing"

func TestSessionLimitIsPerUser(t *testing.T) {
	manager := NewManager()
	for index := 0; index < 32; index++ {
		if _, err := manager.Create("user-a", "connection", "ssh"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := manager.Create("user-a", "connection", "ssh"); err != ErrLimit {
		t.Fatalf("expected 32-session limit, got %v", err)
	}
	if _, err := manager.Create("user-b", "connection", "ssh"); err != nil {
		t.Fatalf("another user should have an independent limit: %v", err)
	}
}
