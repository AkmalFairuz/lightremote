package httpapi

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFileErrorIncludesRemoteCause(t *testing.T) {
	response := httptest.NewRecorder()
	writeRemoteError(response, errors.New("access denied\r\nfor this \x1bdrive"), "could not list remote directory")
	if response.Code != 502 {
		t.Fatalf("status = %d, want 502", response.Code)
	}
	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Message != "could not list remote directory: access denied for this drive" {
		t.Fatalf("unexpected file error: %q", body.Error.Message)
	}
	if got := remoteErrorMessage("could not list", errors.New(strings.Repeat("x", 1000))); len([]rune(got)) > 420 {
		t.Fatal("remote error detail was not bounded")
	}
}
