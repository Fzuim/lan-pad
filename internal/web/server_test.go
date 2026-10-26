package web

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Fzuim/lan-pad/internal/collab"
	"github.com/Fzuim/lan-pad/internal/config"
	"github.com/Fzuim/lan-pad/internal/docstore"
)

type testApp struct {
	base  string
	store *docstore.Store
}

func newTestApp(t *testing.T) *testApp {
	t.Helper()
	root := t.TempDir()
	clientDir := filepath.Join(root, "dist", "client")
	if err := os.MkdirAll(filepath.Join(clientDir, "static"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(clientDir, "index.html"),
		[]byte("<!doctype html><title>LAN Pad</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(clientDir, "static", "app.js"),
		[]byte("console.log('lanpad')"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{
		Root:      root,
		Port:      8788,
		Host:      "127.0.0.1",
		DataDir:   filepath.Join(root, "data"),
		ClientDir: clientDir,
		DBFile:    filepath.Join(root, "data", "lanpad.db"),
		AssetsDir: filepath.Join(root, "data", "assets"),
		HostKey:   "secret",
	}
	if err := os.MkdirAll(cfg.AssetsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	store, err := docstore.Open(cfg.DBFile)
	if err != nil {
		t.Fatal(err)
	}
	manager := collab.New(store)
	server := httptest.NewServer(New(cfg, store, manager).Handler())

	t.Cleanup(func() {
		server.Close()
		_ = manager.Close(t.Context())
		_ = store.Close()
	})
	return &testApp{base: server.URL, store: store}
}

func (a *testApp) request(t *testing.T, method, path string, body io.Reader, headers map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, a.base+path, body)
	if err != nil {
		t.Fatal(err)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp, data
}

func TestDocumentLifecycle(t *testing.T) {
	app := newTestApp(t)

	resp, data := app.request(t, http.MethodGet, "/api/health", nil, nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), `"ok":true`) {
		t.Fatalf("health = %d %s", resp.StatusCode, data)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing security headers")
	}

	resp, data = app.request(t, http.MethodPost, "/api/docs",
		strings.NewReader(`{"title":"中文文档"}`),
		map[string]string{"Content-Type": "application/json"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d %s", resp.StatusCode, data)
	}
	var created docResponse
	if err := json.Unmarshal(data, &created); err != nil {
		t.Fatal(err)
	}
	if created.Title != "中文文档" || created.Online != 0 || created.URL == "" {
		t.Fatalf("created = %+v", created)
	}

	resp, data = app.request(t, http.MethodGet, "/api/docs/"+created.ID, nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get = %d %s", resp.StatusCode, data)
	}

	resp, data = app.request(t, http.MethodGet,
		"/api/docs?base=http://192.168.1.10:8788", nil, nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), "/d/"+created.ID) {
		t.Fatalf("list = %d %s", resp.StatusCode, data)
	}

	resp, _ = app.request(t, http.MethodDelete, "/api/docs/"+created.ID, nil,
		map[string]string{"X-Host-Key": "wrong"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("delete wrong key = %d", resp.StatusCode)
	}
	resp, _ = app.request(t, http.MethodDelete, "/api/docs/"+created.ID, nil,
		map[string]string{"X-Host-Key": "secret"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	resp, _ = app.request(t, http.MethodGet, "/api/docs/"+created.ID, nil, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("get after delete = %d", resp.StatusCode)
	}
}

func TestAssetUploadAndServing(t *testing.T) {
	app := newTestApp(t)
	_, data := app.request(t, http.MethodPost, "/api/docs",
		strings.NewReader(`{"title":"图片"}`),
		map[string]string{"Content-Type": "application/json"})
	var doc docResponse
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatal(err)
	}

	png := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "shot.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(png); err != nil {
		t.Fatal(err)
	}
	_ = writer.WriteField("width", "640")
	_ = writer.WriteField("height", "480")
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	resp, data := app.request(t, http.MethodPost, "/api/docs/"+doc.ID+"/assets", &body,
		map[string]string{"Content-Type": writer.FormDataContentType()})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload = %d %s", resp.StatusCode, data)
	}
	var result struct {
		URL    string `json:"url"`
		Width  *int   `json:"width"`
		Height *int   `json:"height"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.Width == nil || *result.Width != 640 || result.Height == nil || *result.Height != 480 {
		t.Fatalf("dimensions = %v x %v", result.Width, result.Height)
	}

	resp, data = app.request(t, http.MethodGet, result.URL, nil, nil)
	if resp.StatusCode != http.StatusOK || !bytes.Equal(data, png) {
		t.Fatalf("asset = %d, %d bytes", resp.StatusCode, len(data))
	}
	if got := resp.Header.Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Fatalf("cache-control = %q", got)
	}

	resp, _ = app.request(t, http.MethodGet, result.URL+"/../../etc/passwd", nil, nil)
	if resp.StatusCode == http.StatusOK {
		t.Fatal("path traversal returned 200")
	}
}

func TestStaticSPAAndNotFound(t *testing.T) {
	app := newTestApp(t)

	resp, data := app.request(t, http.MethodGet, "/", nil, nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), "LAN Pad") {
		t.Fatalf("index = %d %s", resp.StatusCode, data)
	}
	resp, data = app.request(t, http.MethodGet, "/d/abcdefghijkl", nil, nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(data), "LAN Pad") {
		t.Fatalf("spa fallback = %d %s", resp.StatusCode, data)
	}
	resp, _ = app.request(t, http.MethodGet, "/static/app.js", nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("static js = %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Fatalf("static cache-control = %q", got)
	}

	resp, data = app.request(t, http.MethodGet, "/api/nope", nil, nil)
	if resp.StatusCode != http.StatusNotFound || !strings.Contains(string(data), "接口不存在") {
		t.Fatalf("api 404 = %d %s", resp.StatusCode, data)
	}
	resp, data = app.request(t, http.MethodGet, "/assets/nope.png", nil, nil)
	if resp.StatusCode != http.StatusNotFound || !strings.Contains(string(data), "图片不存在") {
		t.Fatalf("assets 404 = %d %s", resp.StatusCode, data)
	}
}
