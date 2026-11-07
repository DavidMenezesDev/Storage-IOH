package secret

import "testing"

func TestRoundTrip(t *testing.T) {
	b, _ := New("0123456789abcdef")
	sealed, err := b.Seal("s3cr3t")
	if err != nil {
		t.Fatal(err)
	}
	got, err := b.Open(sealed)
	if err != nil || got != "s3cr3t" {
		t.Fatalf("got %q err %v", got, err)
	}
	other, _ := New("fedcba9876543210")
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("deveria falhar com outra chave")
	}
}
