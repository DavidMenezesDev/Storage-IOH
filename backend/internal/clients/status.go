package clients

import (
	"fmt"
	"math"
	"strings"
	"time"
)

type Backup struct {
	Key          string    `json:"key"`
	Name         string    `json:"name"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"lastModified"`
	ETag         string    `json:"etag"`
}

// Evaluate calcula o status do cliente. recent deve vir do mais novo para o mais antigo (bastam ~8).
func Evaluate(now time.Time, c *Client, recent []Backup, scanErr string) (status, reason string) {
	p := c.Policy
	if !c.Active {
		return StatusInactive, "Cliente desativado"
	}
	if scanErr != "" {
		return StatusError, "Falha ao ler o local do backup: " + scanErr
	}
	window := time.Duration(p.ExpectedEveryHours+p.GraceHours) * time.Hour
	if len(recent) == 0 {
		if now.Sub(c.CreatedAt) < window {
			return StatusPending, "Aguardando o primeiro backup"
		}
		loc := c.Bucket + "/" + c.Prefix
		return StatusMissing, fmt.Sprintf("Nenhum backup encontrado em %s (padrão %s)", loc, p.FilePattern)
	}
	latest := recent[0]
	age := now.Sub(latest.LastModified)
	if age > window {
		return StatusLate, fmt.Sprintf("Último backup há %s; esperado a cada %s", HumanDuration(age), HumanDuration(time.Duration(p.ExpectedEveryHours)*time.Hour))
	}
	if latest.Size < p.MinSizeBytes {
		return StatusSuspicious, fmt.Sprintf("Último backup tem %s, abaixo do mínimo de %s", HumanBytes(latest.Size), HumanBytes(p.MinSizeBytes))
	}
	if p.SizeDropPct > 0 && len(recent) >= 2 {
		prev := recent[1:min(len(recent), 8)]
		var sum int64
		for _, b := range prev {
			sum += b.Size
		}
		avg := float64(sum) / float64(len(prev))
		if avg > 0 && float64(latest.Size) < avg*float64(100-p.SizeDropPct)/100 {
			drop := int(math.Round((1 - float64(latest.Size)/avg) * 100))
			return StatusSuspicious, fmt.Sprintf("Último backup (%s) é %d%% menor que a média recente (%s)",
				HumanBytes(latest.Size), drop, HumanBytes(int64(avg)))
		}
	}
	return StatusOK, fmt.Sprintf("Último backup há %s (%s)", HumanDuration(age), HumanBytes(latest.Size))
}

// RetentionCandidates devolve os backups que a política manda apagar. all: do mais novo para o mais antigo.
func RetentionCandidates(now time.Time, p Policy, all []Backup) []Backup {
	if p.RetentionDays <= 0 {
		return nil
	}
	keep := max(p.RetentionMinKeep, 1)
	limit := time.Duration(p.RetentionDays) * 24 * time.Hour
	var out []Backup
	for i, b := range all {
		if i < keep {
			continue
		}
		if now.Sub(b.LastModified) > limit {
			out = append(out, b)
		}
	}
	return out
}

func HumanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	s := fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
	return strings.Replace(s, ".", ",", 1)
}

func HumanDuration(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "menos de 1 minuto"
	case d < time.Hour:
		return plural(int(d.Minutes()), "minuto", "minutos")
	case d < 48*time.Hour:
		return plural(int(d.Hours()), "hora", "horas")
	default:
		return plural(int(d.Hours()/24), "dia", "dias")
	}
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}
