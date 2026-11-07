package search

import "testing"

func TestQuote(t *testing.T) {
	if got := Quote(`a"b\c`); got != `"a\"b\\c"` {
		t.Fatalf("got %s", got)
	}
}
