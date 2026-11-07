package clients

import (
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)

func client() *Client {
	return &Client{Active: true, Bucket: "b", Prefix: "c/", Policy: DefaultPolicy(), CreatedAt: now.Add(-30 * 24 * time.Hour)}
}

func bk(hoursAgo int, size int64) Backup {
	return Backup{Key: "k", Size: size, LastModified: now.Add(-time.Duration(hoursAgo) * time.Hour)}
}

func TestEvaluate(t *testing.T) {
	cases := []struct {
		name   string
		mod    func(c *Client)
		recent []Backup
		err    string
		want   string
		reason string
	}{
		{"inativo", func(c *Client) { c.Active = false }, nil, "", StatusInactive, "desativado"},
		{"erro", nil, nil, "AccessDenied", StatusError, "AccessDenied"},
		{"novo sem backup", func(c *Client) { c.CreatedAt = now.Add(-time.Hour) }, nil, "", StatusPending, "primeiro"},
		{"sem backup", nil, nil, "", StatusMissing, "Nenhum backup"},
		{"ok", nil, []Backup{bk(2, 5000), bk(26, 5000)}, "", StatusOK, "2 horas"},
		{"atrasado", nil, []Backup{bk(31, 5000)}, "", StatusLate, "31 horas"},
		{"dentro da tolerância", nil, []Backup{bk(29, 5000)}, "", StatusOK, ""},
		{"pequeno", nil, []Backup{bk(1, 100)}, "", StatusSuspicious, "abaixo do mínimo"},
		{"queda", nil, []Backup{bk(1, 4000), bk(25, 10000), bk(49, 10000)}, "", StatusSuspicious, "60% menor"},
		{"queda desligada", func(c *Client) { c.Policy.SizeDropPct = 0 }, []Backup{bk(1, 4000), bk(25, 10000)}, "", StatusOK, ""},
		{"atraso vence suspeito", nil, []Backup{bk(40, 10)}, "", StatusLate, ""},
	}
	for _, tc := range cases {
		c := client()
		if tc.mod != nil {
			tc.mod(c)
		}
		got, reason := Evaluate(now, c, tc.recent, tc.err)
		if got != tc.want || !strings.Contains(reason, tc.reason) {
			t.Errorf("%s: got %s (%q), want %s containing %q", tc.name, got, reason, tc.want, tc.reason)
		}
	}
}

func TestRetention(t *testing.T) {
	p := DefaultPolicy()
	p.RetentionDays = 10
	p.RetentionMinKeep = 2
	all := []Backup{bk(24*20, 1), bk(24*30, 1), bk(24*5, 1), bk(24*40, 1)}
	// ordem esperada é do mais novo para o mais antigo; reordenar como o store faria
	all = []Backup{all[2], all[0], all[1], all[3]}
	got := RetentionCandidates(now, p, all)
	if len(got) != 2 || got[0].LastModified != all[2].LastModified {
		t.Fatalf("got %+v", got)
	}
	p.RetentionMinKeep = 10
	if len(RetentionCandidates(now, p, all)) != 0 {
		t.Fatal("minKeep deveria proteger tudo")
	}
	p.RetentionDays = 0
	if RetentionCandidates(now, p, all) != nil {
		t.Fatal("retenção 0 não apaga nada")
	}
}

func TestPatterns(t *testing.T) {
	p := Policy{FilePattern: "*.bak, *.FBK ,dump-*.sql.gz"}
	for k, want := range map[string]bool{"a/b/Base.BAK": true, "x.fbk": true, "dump-2026.sql.gz": true, "x.zip": false, "pasta/": false} {
		if p.Matches(k) != want {
			t.Errorf("Matches(%q) != %v", k, want)
		}
	}
	if (Policy{FilePattern: "[x"}).validate() == nil {
		t.Error("padrão inválido deveria falhar")
	}
}

func TestApply(t *testing.T) {
	c := &Client{Policy: DefaultPolicy(), Active: true}
	name, doc, conn, bucket, prefix := "Padaria", "12.345.678/0001-99", "id", "bk", "/clientes/123"
	rescan, err := Input{Name: &name, Document: &doc, ConnectionID: &conn, Bucket: &bucket, Prefix: &prefix}.Apply(c)
	if err != nil || !rescan || c.Document != "12345678000199" || c.Prefix != "clientes/123/" {
		t.Fatalf("%v %v %+v", rescan, err, c)
	}
	bad := "123"
	if _, err := (Input{Document: &bad}).Apply(c); err == nil {
		t.Fatal("documento inválido deveria falhar")
	}
}

func TestHuman(t *testing.T) {
	if HumanBytes(1536) != "1,5 KB" || HumanBytes(10) != "10 B" || HumanDuration(26*time.Hour) != "26 horas" || HumanDuration(72*time.Hour) != "3 dias" {
		t.Fatal(HumanBytes(1536), HumanDuration(26*time.Hour))
	}
}
