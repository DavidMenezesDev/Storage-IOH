package alerts

import "testing"

func TestShouldAlert(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{"pending", "ok", false},
		{"ok", "ok", false},
		{"ok", "late", true},
		{"late", "missing", true},
		{"late", "ok", true},
		{"pending", "error", true},
		{"ok", "inactive", false},
		{"error", "inactive", false},
	}
	for _, c := range cases {
		if got := ShouldAlert(c.from, c.to); got != c.want {
			t.Errorf("%s -> %s = %v", c.from, c.to, got)
		}
	}
}

func TestChannelValidation(t *testing.T) {
	ty, name := "webhook", "x"
	for target, ok := range map[string]bool{"https://hooks.slack.com/x": true, "ftp://x": false, "nao-e-url": false} {
		tg := target
		err := ChannelInput{Type: &ty, Name: &name, Target: &tg}.apply(&Channel{})
		if (err == nil) != ok {
			t.Errorf("webhook %q: err=%v", target, err)
		}
	}
	em := "email"
	for target, ok := range map[string]bool{"a@b.com, c@d.com": true, "": false, "a@b.com, ruim": false} {
		tg := target
		err := ChannelInput{Type: &em, Name: &name, Target: &tg}.apply(&Channel{})
		if (err == nil) != ok {
			t.Errorf("email %q: err=%v", target, err)
		}
	}
}
