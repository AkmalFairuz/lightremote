package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jmoiron/sqlx"
)

type Routes struct {
	Auth        *AuthHandler
	Users       *UserHandler
	Folders     *FolderHandler
	Connections *ConnectionHandler
	SSHKeys     *SSHKeyHandler
	Files       *FileHandler
	Work        *WorkHandler
	Middleware  *AuthMiddleware
	Database    *sqlx.DB
}

// Router registers the REST and WebSocket endpoints.
func Router(routes Routes) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestID, middleware.Recoverer)
	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := routes.Database.PingContext(r.Context()); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	router.Route("/api", func(api chi.Router) {
		if !routes.Middleware.LocalMode() {
			api.Post("/auth/login", routes.Auth.Login)
		}
		api.Group(func(authenticated chi.Router) {
			authenticated.Use(routes.Middleware.RequireAuth)
			authenticated.Get("/auth/me", routes.Auth.Me)
			if !routes.Middleware.LocalMode() {
				authenticated.Post("/auth/logout", routes.Auth.Logout)
				authenticated.Put("/auth/password", routes.Auth.ChangePassword)

				authenticated.Route("/users", func(users chi.Router) {
					users.Use(routes.Middleware.RequireAdmin)
					users.Get("/", routes.Users.List)
					users.Post("/", routes.Users.Create)
					users.Patch("/{userID}", routes.Users.Update)
				})
			}

			authenticated.Get("/folders", routes.Folders.List)
			authenticated.Post("/folders", routes.Folders.Create)
			authenticated.Put("/folders/{folderID}", routes.Folders.Update)
			authenticated.Delete("/folders/{folderID}", routes.Folders.Delete)
			if routes.SSHKeys != nil {
				authenticated.Get("/ssh-keys", routes.SSHKeys.List)
				authenticated.Post("/ssh-keys", routes.SSHKeys.Create)
				authenticated.Post("/ssh-keys/generate", routes.SSHKeys.Generate)
				authenticated.Patch("/ssh-keys/{keyID}", routes.SSHKeys.Rename)
				authenticated.Delete("/ssh-keys/{keyID}", routes.SSHKeys.Delete)
			}

			authenticated.Get("/connections", routes.Connections.List)
			authenticated.Get("/connections/recent", routes.Connections.Recent)
			authenticated.Post("/connections", routes.Connections.Create)
			authenticated.Post("/direct-connections", routes.Connections.CreateDirect)
			authenticated.Delete("/direct-connections/{connectionID}", routes.Connections.DeleteDirect)
			authenticated.Get("/connections/{connectionID}", routes.Connections.Get)
			authenticated.Put("/connections/{connectionID}", routes.Connections.Update)
			authenticated.Post("/connections/{connectionID}/duplicate", routes.Connections.Duplicate)
			authenticated.Post("/connections/{connectionID}/recent", routes.Connections.RecordOpen)
			authenticated.Patch("/connections/{connectionID}/folder", routes.Connections.MoveToFolder)
			authenticated.Patch("/connections/{connectionID}/name", routes.Connections.Rename)
			authenticated.Delete("/connections/{connectionID}", routes.Connections.Delete)
			authenticated.Post("/connections/{connectionID}/host-key/inspect", routes.Connections.InspectHostKey)
			authenticated.Post("/connections/{connectionID}/host-key/approve", routes.Connections.ApproveHostKey)

			authenticated.Post("/connections/{connectionID}/sessions", routes.Work.Create)
			authenticated.Get("/sessions", routes.Work.List)
			authenticated.Get("/sessions/{sessionID}", routes.Work.Get)
			authenticated.Delete("/sessions/{sessionID}", routes.Work.Delete)
			authenticated.Get("/sessions/{sessionID}/ws", routes.Work.WebSocket)

			authenticated.Get("/connections/{connectionID}/files", routes.Files.List)
			authenticated.Get("/connections/{connectionID}/files/home", routes.Files.Home)
			authenticated.Get("/connections/{connectionID}/files/download", routes.Files.Download)
			authenticated.Get("/connections/{connectionID}/files/upload/progress", routes.Files.UploadProgress)
			authenticated.Put("/connections/{connectionID}/files/upload", routes.Files.Upload)
			authenticated.Post("/connections/{connectionID}/files/mkdir", routes.Files.Mkdir)
			authenticated.Post("/connections/{connectionID}/files/rename", routes.Files.Rename)
			authenticated.Delete("/connections/{connectionID}/files", routes.Files.Delete)
		})
	})
	return router
}
