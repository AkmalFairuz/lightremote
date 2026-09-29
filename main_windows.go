//go:build windows && !server

package main

import "golang.org/x/sys/windows"

func showStartupError(startupErr error, logPath string) {
	message := "LightRemote could not start:\n\n" + startupErr.Error()
	if logPath != "" {
		message += "\n\nLog: " + logPath
	}
	text, err := windows.UTF16PtrFromString(message)
	if err != nil {
		text, _ = windows.UTF16PtrFromString("LightRemote could not start.")
	}
	title, _ := windows.UTF16PtrFromString("LightRemote")
	_, _ = windows.MessageBox(0, text, title, windows.MB_OK|windows.MB_ICONERROR)
}
