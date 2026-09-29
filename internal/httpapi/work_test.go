package httpapi

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

// TestVNCCloseReason keeps detailed failure text valid for a WebSocket close frame.
func TestVNCCloseReason(t *testing.T) {
	reason := vncCloseReason(errors.New(strings.Repeat("é", 100)))
	if len(reason) > 123 || !utf8.ValidString(reason) {
		t.Fatalf("invalid WebSocket close reason: %q", reason)
	}
	if reason == "" {
		t.Fatal("connection failure detail was lost")
	}
}
