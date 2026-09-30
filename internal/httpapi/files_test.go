package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUploadBodyValidation(t *testing.T) {
	for _, tc := range []struct {
		name, size, body string
		length, limit    int64
		wantStatus       int
	}{
		{"desktop binary", "4", "\x00\xff\x01\x02", 0, 10, 204},
		{"empty file", "0", "", 0, 10, 204},
		{"legacy unknown length", "", "data", -1, 10, 204},
		{"truncated body", "4", "ab", 0, 10, 400},
		{"extra bytes", "2", "abcd", 0, 10, 400},
		{"stream limit", "", "12345678901", -1, 10, 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(tc.body))
			r.ContentLength = tc.length
			if tc.size != "" {
				r.Header.Set("X-Upload-Size", tc.size)
			}
			defer r.Body.Close()
			w := httptest.NewRecorder()
			reader, err := prepareUpload(w, r, tc.limit)
			var data []byte
			if err == nil {
				data, err = io.ReadAll(reader)
			}
			if err != nil {
				writeUploadError(w, err)
			} else {
				w.WriteHeader(http.StatusNoContent)
				if !bytes.Equal(data, []byte(tc.body)) {
					t.Fatal("upload bytes changed")
				}
			}
			if w.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d: %s", w.Code, tc.wantStatus, w.Body.String())
			}
		})
	}
}

func TestUploadLostBodyRejectedBeforeOpeningRemote(t *testing.T) {
	r := httptest.NewRequest(http.MethodPut, "/?path=C:/file.bin", nil)
	r.Header.Set("X-Upload-Size", "42")
	w := httptest.NewRecorder()
	// No connection service: attempting to open a remote client would panic.
	h := &FileHandler{maxUpload: 1024}
	h.Upload(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

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
