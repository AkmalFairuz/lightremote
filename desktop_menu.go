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

	service.menuLabels = make(map[string]func(string))
	service.menuText = make(map[string]string)
	addMenu := func(parent *application.Menu, key, label string) *application.Menu {
		submenu := parent.AddSubmenu(label)
		item := parent.FindByLabel(label)
		service.menuLabels[key] = func(value string) {
			item.SetLabel(value)
			submenu.SetLabel(value)
		}
		return submenu
	}
	addItem := func(parent *application.Menu, key, label string) *application.MenuItem {
		item := parent.Add(label)
		service.menuLabels[key] = func(value string) { item.SetLabel(value) }
		return item
	}
	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)

	file := addMenu(menu, "file", "File")
	addItem(file, "open", "Open Connection…").SetAccelerator("CmdOrCtrl+K").OnClick(emit("file:open"))
	addItem(file, "direct", "New Direct Connection…").SetAccelerator("CmdOrCtrl+Shift+K").OnClick(emit("file:direct"))
	addItem(file, "keys", "SSH Keys…").OnClick(emit("file:ssh-keys"))
	service.recentMenu = addMenu(file, "recent", "Recent Connections")
	service.emptyRecentItem = service.recentMenu.Add("No recent connections").SetEnabled(false)
	file.AddSeparator()
	file.AddRole(application.CloseWindow)

	menu.AddRole(application.EditMenu)
	view := addMenu(menu, "view", "View")
	appearance := addMenu(view, "appearance", "Appearance")
	addItem(appearance, "system", "System Mode").OnClick(emit("view:appearance:system"))
	addItem(appearance, "light", "Light Mode").OnClick(emit("view:appearance:light"))
	addItem(appearance, "dark", "Dark Mode").OnClick(emit("view:appearance:dark"))
	terminal := addMenu(view, "terminal", "Terminal Theme")
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
		addItem(terminal, "terminal:"+option.name, option.label).OnClick(emit("view:terminal:" + option.name))
	}

	menu.AddRole(application.WindowMenu)
	help := addMenu(menu, "help", "Help")
	addItem(help, "about", "About LightRemote").OnClick(emit("help:about"))
	addItem(help, "source", "Source Code").OnClick(emit("help:source"))
	app.Menu.SetApplicationMenu(menu)
}

// UpdateRecentConnections keeps the native File menu in sync with the app.
func (s *DesktopService) UpdateRecentConnections(encoded string) error {
	s.menuMutex.Lock()
	defer s.menuMutex.Unlock()
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
	s.emptyRecentItem = nil
	if len(connections) == 0 {
		s.emptyRecentItem = s.recentMenu.Add(s.emptyRecentLabel()).SetEnabled(false)
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

// UpdateMenuLabels updates only app-owned labels. OS menu roles keep system localization.
func (s *DesktopService) UpdateMenuLabels(encoded string) error {
	if s.menuLabels == nil {
		return nil
	}
	var labels map[string]string
	if err := json.Unmarshal([]byte(encoded), &labels); err != nil {
		return err
	}
	s.menuMutex.Lock()
	defer s.menuMutex.Unlock()
	for key, label := range labels {
		if label == "" || len(label) > 512 {
			continue
		}
		s.menuText[key] = label
		if setLabel, ok := s.menuLabels[key]; ok {
			setLabel(label)
		}
	}
	if s.emptyRecentItem != nil {
		s.emptyRecentItem.SetLabel(s.emptyRecentLabel())
	}
	if menu := s.app.Menu.GetApplicationMenu(); menu != nil {
		menu.Update()
	}
	return nil
}

func (s *DesktopService) emptyRecentLabel() string {
	if label := s.menuText["emptyRecent"]; label != "" {
		return label
	}
	return "No recent connections"
}
