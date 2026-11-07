package httpapi

import "testing"

func TestCleanUploadName(t *testing.T) {
	ok := map[string]string{"a.txt": "a.txt", "dir/sub/a.txt": "dir/sub/a.txt", "/abs//x.png": "abs/x.png", `win\path\f.txt`: "win/path/f.txt", "./a": "a"}
	for in, want := range ok {
		if got, valid := cleanUploadName(in); !valid || got != want {
			t.Errorf("cleanUploadName(%q) = %q,%v want %q", in, got, valid, want)
		}
	}
	for _, bad := range []string{"../etc/passwd", "a/../../b", "", "/", "."} {
		if _, valid := cleanUploadName(bad); valid {
			t.Errorf("cleanUploadName(%q) deveria ser inválido", bad)
		}
	}
}

func TestContentDisposition(t *testing.T) {
	got := contentDisposition("attachment", `relatório "final".pdf`)
	want := `attachment; filename="relat_rio _final_.pdf"; filename*=UTF-8''relat%C3%B3rio%20%22final%22.pdf`
	if got != want {
		t.Fatalf("got %s", got)
	}
}
