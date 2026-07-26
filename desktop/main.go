package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"strings"

	"github.com/webview/webview_go"
)

//go:embed all:dist
var distFS embed.FS

const bridgeJS = `(function () {
  async function postJSON(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (response.status === 204) return null;
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response;
  }

  window.viperDesktopFiles = {
    open: async (options) => {
      const response = await postJSON('/__viper/files/open', options);
      if (!response) return null;
      return {
        name: response.headers.get('X-Viper-File-Name') ?? 'untitled',
        type: response.headers.get('X-Viper-File-Type') ?? undefined,
        token: response.headers.get('X-Viper-File-Token') ?? '',
        bytes: await response.arrayBuffer(),
      };
    },
    chooseSave: async (options) => {
      const response = await postJSON('/__viper/files/choose-save', options);
      if (!response) return null;
      return response.json();
    },
    write: async (token, bytes) => {
      const response = await fetch('/__viper/files/write?token=' + encodeURIComponent(token), {
        method: 'POST',
        body: bytes,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    },
  };
})();`

func main() {
	store := newFileStore()
	mux := http.NewServeMux()

	mux.HandleFunc("/__viper/bridge.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		_, _ = w.Write([]byte(bridgeJS))
	})
	mux.HandleFunc("/__viper/files/open", store.handleOpen)
	mux.HandleFunc("/__viper/files/choose-save", store.handleChooseSave)
	mux.HandleFunc("/__viper/files/write", store.handleWrite)

	staticFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err)
	}

	fileServer := http.FileServer(http.FS(staticFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			serveIndex(w, staticFS)
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	addr := listener.Addr().String()

	server := &http.Server{Handler: mux}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			panic(err)
		}
	}()

	url := fmt.Sprintf("http://%s/", addr)
	w := webview.New(false)
	defer w.Destroy()
	w.SetTitle("ViperCAD")
	w.SetSize(1440, 900, webview.HintNone)
	w.Navigate(url)
	w.Run()
}

func serveIndex(w http.ResponseWriter, staticFS fs.FS) {
	bytes, err := fs.ReadFile(staticFS, "index.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	html := string(bytes)
	injection := `<script src="/__viper/bridge.js"></script>`
	if strings.Contains(html, "</head>") {
		html = strings.Replace(html, "</head>", injection+"</head>", 1)
	} else {
		html = injection + html
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(html))
}
