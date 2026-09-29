//go:build !windows && !server

package main

func showStartupError(_ error, _ string) {
	// Other platforms already expose stderr while launching from a terminal.
}
