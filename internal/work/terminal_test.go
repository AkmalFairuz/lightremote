package work

import (
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
)

func TestTelnetSurvivesViewerHandoffAndClosesWithSession(t *testing.T) {
	client, server := net.Pipe()
	defer server.Close()
	_ = server.SetDeadline(time.Now().Add(3 * time.Second))
	manager := NewManager()
	session, err := manager.Create("owner", "connection", "telnet")
	if err != nil {
		t.Fatal(err)
	}
	defer manager.CloseUser("owner")
	runtime := newTelnetRuntime(client)
	session.terminal = runtime
	firstCtx, finish, err := session.Attach(func() {}, func() {})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := server.Write([]byte("login: ")); err != nil {
		t.Fatal(err)
	}
	chunk, _, ok := runtime.Output(firstCtx, 0)
	if !ok || string(chunk) != "login: " {
		t.Fatalf("initial output %q, %v", chunk, ok)
	}
	finish()
	if _, err := server.Write([]byte("welcome")); err != nil {
		t.Fatal(err)
	}
	secondCtx, secondFinish, err := session.Attach(func() {}, func() {})
	if err != nil {
		t.Fatal(err)
	}
	defer secondFinish()
	preserved, err := session.EnsureTerminal(secondCtx, model.Connection{Kind: "telnet"}, model.RemoteSecret{}, time.Second)
	if err != nil || preserved != runtime {
		t.Fatalf("handoff did not preserve runtime: %v", err)
	}
	var sequence uint64
	for _, want := range []string{"login: ", "welcome"} {
		chunk, next, ok := preserved.Output(secondCtx, sequence)
		if !ok || string(chunk) != want {
			t.Fatalf("replayed %q, want %q", chunk, want)
		}
		sequence = next
	}
	manager.Delete("owner", session.ID)
	if _, err := server.Write([]byte("after close")); err == nil {
		t.Fatal("session close left upstream socket open")
	}
}

func TestTerminalReplayDropsOldOutputAtHistoryLimit(t *testing.T) {
	output := newTerminalOutput()
	output.record(strings.NewReader(strings.Repeat("x", terminalHistoryLimit+32*1024)))
	close(output.done)
	if output.bytes > terminalHistoryLimit || output.first == 0 {
		t.Fatalf("output history was not bounded: %d bytes, first %d", output.bytes, output.first)
	}
	chunk, next, ok := output.Output(context.Background(), 0)
	if !ok || len(chunk) == 0 || next != output.first+1 {
		t.Fatal("viewer could not resume at oldest retained output")
	}
}

func TestTelnetEOFDrainsOutput(t *testing.T) {
	client, server := net.Pipe()
	runtime := newTelnetRuntime(client)
	defer runtime.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() {
		_, _ = io.WriteString(server, "final output")
		_ = server.Close()
	}()
	chunk, next, ok := runtime.Output(ctx, 0)
	if !ok || string(chunk) != "final output" {
		t.Fatalf("final output lost: %q, %v", chunk, ok)
	}
	if _, _, ok := runtime.Output(ctx, next); ok || ctx.Err() != nil {
		t.Fatal("EOF did not end output promptly")
	}
}
