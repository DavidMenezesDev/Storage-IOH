// Package objects contém o modelo de objeto compartilhado entre navegação, busca e indexação.
package objects

import (
	"crypto/sha1"
	"encoding/hex"
	"mime"
	"path"
	"strings"
	"time"
)

type Item struct {
	Key          string    `json:"key"`
	Name         string    `json:"name"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"lastModified"`
	ETag         string    `json:"etag"`
	Category     string    `json:"category"`
	Ext          string    `json:"ext"`
	ContentType  string    `json:"contentType,omitempty"`
}

type Folder struct {
	Name   string `json:"name"`
	Prefix string `json:"prefix"`
}

func NewItem(key string, size int64, modified time.Time, etag string) Item {
	ext := Ext(key)
	return Item{
		Key:          key,
		Name:         path.Base(strings.TrimSuffix(key, "/")),
		Size:         size,
		LastModified: modified.UTC(),
		ETag:         strings.Trim(etag, `"`),
		Category:     CategoryOf(ext),
		Ext:          ext,
		ContentType:  ContentTypeOf(ext),
	}
}

func Ext(key string) string {
	base := path.Base(key)
	i := strings.LastIndexByte(base, '.')
	if i <= 0 || i == len(base)-1 {
		return ""
	}
	return strings.ToLower(base[i+1:])
}

// DocID é o id estável de um objeto no índice de busca.
func DocID(connectionID, bucket, key string) string {
	h := sha1.Sum([]byte(connectionID + "|" + bucket + "|" + key))
	return hex.EncodeToString(h[:])
}

var categories = map[string][]string{
	"image":    {"jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "ico", "tif", "tiff", "heic", "heif"},
	"video":    {"mp4", "webm", "mov", "mkv", "avi", "m4v", "ogv", "mpeg", "mpg", "3gp"},
	"audio":    {"mp3", "wav", "ogg", "oga", "flac", "aac", "m4a", "opus", "weba"},
	"document": {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "epub", "pages", "numbers", "key"},
	"code": {"txt", "md", "markdown", "json", "csv", "tsv", "xml", "yaml", "yml", "toml", "ini", "log", "html", "htm", "css", "scss",
		"js", "mjs", "cjs", "ts", "tsx", "jsx", "go", "py", "rb", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cs", "php", "sh",
		"bash", "zsh", "sql", "swift", "dart", "lua", "r", "vue", "svelte", "graphql", "proto", "env", "conf", "dockerfile", "tf"},
	"archive": {"zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst", "iso", "dmg"},
}

var extCategory = func() map[string]string {
	m := map[string]string{}
	for cat, exts := range categories {
		for _, e := range exts {
			m[e] = cat
		}
	}
	return m
}()

func CategoryOf(ext string) string {
	if c, ok := extCategory[ext]; ok {
		return c
	}
	return "other"
}

var extraTypes = map[string]string{
	"md": "text/markdown", "markdown": "text/markdown", "yaml": "text/yaml", "yml": "text/yaml",
	"toml": "text/plain", "log": "text/plain", "go": "text/plain", "py": "text/plain", "rs": "text/plain",
	"ts": "text/plain", "tsx": "text/plain", "jsx": "text/plain", "sql": "text/plain", "sh": "text/plain",
	"heic": "image/heic", "mkv": "video/x-matroska", "mov": "video/quicktime", "m4a": "audio/mp4",
	"flac": "audio/flac", "opus": "audio/ogg", "csv": "text/csv", "tsv": "text/tab-separated-values",
}

func ContentTypeOf(ext string) string {
	if ext == "" {
		return "application/octet-stream"
	}
	if t, ok := extraTypes[ext]; ok {
		return t
	}
	if t := mime.TypeByExtension("." + ext); t != "" {
		return t
	}
	if CategoryOf(ext) == "code" {
		return "text/plain"
	}
	return "application/octet-stream"
}
