package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/sqweek/dialog"
)

type fileDialogType struct {
	Description string              `json:"description"`
	Accept      map[string][]string `json:"accept"`
}

type openFileOptions struct {
	Types    []fileDialogType `json:"types"`
	Multiple bool             `json:"multiple"`
}

type saveFileOptions struct {
	SuggestedName  string           `json:"suggestedName"`
	Types          []fileDialogType `json:"types"`
	ExistingToken  string           `json:"existingToken"`
}

type fileStore struct {
	mu    sync.Mutex
	paths map[string]string
}

func newFileStore() *fileStore {
	return &fileStore{paths: make(map[string]string)}
}

func (s *fileStore) put(path string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	token := uuid.NewString()
	s.paths[token] = path
	return token
}

func (s *fileStore) get(token string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	path, ok := s.paths[token]
	return path, ok
}

func dialogFilters(types []fileDialogType) []dialog.FileFilter {
	if len(types) == 0 {
		return nil
	}
	filters := make([]dialog.FileFilter, 0, len(types))
	for _, t := range types {
		var patterns []string
		for _, exts := range t.Accept {
			for _, ext := range exts {
				ext = strings.TrimPrefix(ext, ".")
				if ext != "" {
					patterns = append(patterns, ext)
				}
			}
		}
		name := t.Description
		if name == "" {
			name = "Files"
		}
		filters = append(filters, dialog.FileFilter{
			Desc:       name,
			Extensions: patterns,
		})
	}
	return filters
}

func applyDialogFilters(builder *dialog.FileBuilder, types []fileDialogType) *dialog.FileBuilder {
	filters := dialogFilters(types)
	if len(filters) == 0 {
		return builder.Filter("All files", "*")
	}
	for _, filter := range filters {
		builder = builder.Filter(filter.Desc, filter.Extensions...)
	}
	return builder
}

func mimeFromName(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".viper", ".json":
		return "application/json"
	case ".obj":
		return "text/plain"
	case ".gltf":
		return "model/gltf+json"
	case ".glb":
		return "model/gltf-binary"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".bmp":
		return "image/bmp"
	default:
		return "application/octet-stream"
	}
}

func (s *fileStore) handleOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var options openFileOptions
	if err := json.NewDecoder(r.Body).Decode(&options); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	path, err := applyDialogFilters(dialog.File().Title("Open File"), options.Types).Load()
	if err != nil {
		if err == dialog.ErrCancelled {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if path == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	bytes, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	name := filepath.Base(path)
	token := s.put(path)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Viper-File-Name", name)
	w.Header().Set("X-Viper-File-Type", mimeFromName(name))
	w.Header().Set("X-Viper-File-Token", token)
	w.Write(bytes)
}

func (s *fileStore) handleChooseSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var options saveFileOptions
	if err := json.NewDecoder(r.Body).Decode(&options); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	path, err := applyDialogFilters(dialog.File().Title("Save File").SetStartFile(options.SuggestedName), options.Types).Save()
	if err != nil {
		if err == dialog.ErrCancelled {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if path == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	name := filepath.Base(path)
	if options.SuggestedName != "" && filepath.Ext(path) == "" {
		path = path + filepath.Ext(options.SuggestedName)
		name = filepath.Base(path)
	}

	token := s.put(path)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"name":  name,
		"token": token,
	})
}

func (s *fileStore) handleWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusBadRequest)
		return
	}

	path, ok := s.get(token)
	if !ok {
		http.Error(w, "unknown file token", http.StatusBadRequest)
		return
	}

	bytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := os.WriteFile(path, bytes, 0o644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
