package objects

import (
	"testing"
	"time"
)

func TestNewItem(t *testing.T) {
	it := NewItem("fotos/2025/Praia.JPG", 10, time.Unix(0, 0), `"abc"`)
	if it.Name != "Praia.JPG" || it.Ext != "jpg" || it.Category != "image" || it.ETag != "abc" || it.ContentType != "image/jpeg" {
		t.Fatalf("item inesperado: %+v", it)
	}
}

func TestExt(t *testing.T) {
	cases := map[string]string{"a/b.tar.gz": "gz", ".env": "", "README": "", "x.": "", "dir/": "", "Main.GO": "go"}
	for in, want := range cases {
		if got := Ext(in); got != want {
			t.Errorf("Ext(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCategoryAndType(t *testing.T) {
	if CategoryOf("mp4") != "video" || CategoryOf("pdf") != "document" || CategoryOf("xyz") != "other" {
		t.Fatal("categorias erradas")
	}
	if ContentTypeOf("md") != "text/markdown" || ContentTypeOf("") != "application/octet-stream" {
		t.Fatal("content-type errado")
	}
}

func TestDocIDStable(t *testing.T) {
	if DocID("c", "b", "k") != DocID("c", "b", "k") || DocID("c", "b", "k") == DocID("c", "b", "k2") {
		t.Fatal("DocID instável")
	}
}
