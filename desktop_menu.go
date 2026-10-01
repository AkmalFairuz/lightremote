//go:build !server

package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const macMenuEvent = "lightremote:mac-menu"

type recentMenuConnection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

func installMacMenu(app *application.App, mainWindow *application.WebviewWindow, service *DesktopService) {
	emit := func(action string) func(*application.Context) {
		return func(*application.Context) {
			mainWindow.Focus()
			mainWindow.EmitEvent(macMenuEvent, action)
		}
	}

	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)

	file := menu.AddSubmenu("File")
	file.Add("Open Connection…").SetAccelerator("CmdOrCtrl+K").OnClick(emit("file:open"))
	file.Add("New Direct Connection…").SetAccelerator("CmdOrCtrl+Shift+K").OnClick(emit("file:direct"))
	file.Add("SSH Keys…").OnClick(emit("file:ssh-keys"))
	service.recentMenu = file.AddSubmenu("Recent Connections")
	service.recentMenu.Add("No recent connections").SetEnabled(false)
	file.AddSeparator()
	file.AddRole(application.CloseWindow)

	menu.AddRole(application.EditMenu)
	view := menu.AddSubmenu("View")
	appearance := view.AddSubmenu("Appearance")
	appearance.Add("System Mode").OnClick(emit("view:appearance:system"))
	appearance.Add("Light Mode").OnClick(emit("view:appearance:light"))
	appearance.Add("Dark Mode").OnClick(emit("view:appearance:dark"))
	terminal := view.AddSubmenu("Terminal Theme")
	for _, option := range []struct{ name, label string }{
		{"auto", "Auto (follow app)"},
		{"ubuntu", "Ubuntu"},
		{"powerShell", "PowerShell Blue"},
		{"dracula", "Dracula"},
		{"oneDark", "One Dark"},
		{"nord", "Nord"},
		{"gruvboxDark", "Gruvbox Dark"},
		{"solarizedDark", "Solarized Dark"},
		{"solarizedLight", "Solarized Light"},
	} {
		terminal.Add(option.label).OnClick(emit("view:terminal:" + option.name))
	}

	menu.AddRole(application.WindowMenu)
	help := menu.AddSubmenu("Help")
	help.Add("About LightRemote").OnClick(emit("help:about"))
	help.Add("Source Code").OnClick(emit("help:source"))
	app.Menu.SetApplicationMenu(menu)
}

// UpdateRecentConnections keeps the native File menu in sync with the app.
func (s *DesktopService) UpdateRecentConnections(encoded string) error {
	if s.recentMenu == nil {
		return nil
	}
	var connections []recentMenuConnection
	if err := json.Unmarshal([]byte(encoded), &connections); err != nil {
		return err
	}
	if len(connections) > 15 {
		connections = connections[:15]
	}

	s.recentMenu.Clear()
	if len(connections) == 0 {
		s.recentMenu.Add("No recent connections").SetEnabled(false)
	}
	for _, connection := range connections {
		if connection.ID == "" {
			continue
		}
		name := strings.ReplaceAll(strings.ReplaceAll(connection.Name, "\n", " "), "\r", " ")
		label := fmt.Sprintf("%s (%s)", name, strings.ToUpper(connection.Kind))
		id := connection.ID
		s.recentMenu.Add(label).OnClick(func(*application.Context) {
			if window, ok := s.app.Window.GetByName("main"); ok {
				window.Focus()
				window.EmitEvent(macMenuEvent, "file:recent:"+id)
			}
		})
	}
	if menu := s.app.Menu.GetApplicationMenu(); menu != nil {
		menu.Update()
	}
	return nil
}
