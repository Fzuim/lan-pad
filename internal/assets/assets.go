// Package assets validates and stores pasted screenshots.
package assets

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/Fzuim/lan-pad/internal/docstore"
)

// ErrUnsupported is returned for bytes that are not a supported image.
var ErrUnsupported = errors.New("只支持 PNG / JPEG / GIF / WebP 图片")

// MaxUploadBytes matches the Node server's 15 MiB multer limit.
const MaxUploadBytes = 15 * 1024 * 1024

// ImageInfo describes a recognised image format.
type ImageInfo struct {
	MIME string
	Ext  string
}

// Result is the JSON payload returned by the upload endpoint.
type Result struct {
	URL    string `json:"url"`
	Width  *int   `json:"width"`
	Height *int   `json:"height"`
	MIME   string `json:"mime"`
}

// DetectImage sniffs PNG, JPEG, GIF and WebP magic bytes.
func DetectImage(buf []byte) (ImageInfo, bool) {
	switch {
	case len(buf) >= 8 &&
		buf[0] == 0x89 && buf[1] == 'P' && buf[2] == 'N' && buf[3] == 'G' &&
		buf[4] == 0x0d && buf[5] == 0x0a && buf[6] == 0x1a && buf[7] == 0x0a:
		return ImageInfo{MIME: "image/png", Ext: "png"}, true
	case len(buf) >= 3 && buf[0] == 0xff && buf[1] == 0xd8 && buf[2] == 0xff:
		return ImageInfo{MIME: "image/jpeg", Ext: "jpg"}, true
	}

	head6 := string(buf[:min(6, len(buf))])
	if head6 == "GIF87a" || head6 == "GIF89a" {
		return ImageInfo{MIME: "image/gif", Ext: "gif"}, true
	}
	if len(buf) >= 12 && string(buf[0:4]) == "RIFF" && string(buf[8:12]) == "WEBP" {
		return ImageInfo{MIME: "image/webp", Ext: "webp"}, true
	}
	return ImageInfo{}, false
}

// Save validates buf, writes it under assetsDir/<docID>/ and records its
// metadata. Duplicate content is deduplicated by SHA-256.
func Save(
	store *docstore.Store,
	assetsDir string,
	docID string,
	buf []byte,
	widthRaw string,
	heightRaw string,
) (Result, error) {
	info, ok := DetectImage(buf)
	if !ok {
		return Result{}, ErrUnsupported
	}

	sum := sha256.Sum256(buf)
	hash := hex.EncodeToString(sum[:])
	filename := hash + "." + info.Ext
	dir := filepath.Join(assetsDir, docID)

	existing, err := store.GetAssetByFilename(docID, filename)
	if err != nil {
		return Result{}, err
	}
	if existing != nil {
		return Result{
			URL:    "/assets/" + docID + "/" + filename,
			Width:  existing.Width,
			Height: existing.Height,
			MIME:   existing.MIME,
		}, nil
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Result{}, fmt.Errorf("创建图片目录失败: %w", err)
	}
	full := filepath.Join(dir, filename)
	if _, err := os.Stat(full); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(full, buf, 0o644); err != nil {
			return Result{}, fmt.Errorf("保存图片失败: %w", err)
		}
	}

	idBuf := make([]byte, 8)
	if _, err := rand.Read(idBuf); err != nil {
		return Result{}, err
	}
	width := parseDimension(widthRaw)
	height := parseDimension(heightRaw)

	asset, err := store.AddAsset(docstore.Asset{
		ID:        hex.EncodeToString(idBuf),
		DocID:     docID,
		SHA256:    hash,
		Filename:  filename,
		MIME:      info.MIME,
		Size:      int64(len(buf)),
		Width:     width,
		Height:    height,
		CreatedAt: nowMillis(),
	})
	if err != nil {
		return Result{}, err
	}

	return Result{
		URL:    "/assets/" + docID + "/" + filename,
		Width:  asset.Width,
		Height: asset.Height,
		MIME:   asset.MIME,
	}, nil
}

func parseDimension(raw string) *int {
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 || value > 10000 {
		return nil
	}
	rounded := int(math.Round(value))
	return &rounded
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}
