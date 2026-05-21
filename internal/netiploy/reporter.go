package netiploy

import (
	"fmt"
	"os"
	"strings"
	"time"
)

func FormatDuration(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	return fmt.Sprintf("%.2fs", d.Seconds())
}

func PrintBanner(title string) {
	line := strings.Repeat("-", max(30, len(title)+8))
	fmt.Println(line)
	fmt.Printf("  %s\n", title)
	fmt.Println(line)
}

func PrintInfo(message string) {
	fmt.Printf("i %s\n", message)
}

func PrintError(message string) {
	fmt.Fprintf(os.Stderr, "X %s\n", message)
}

func PrintSummary(message string) {
	fmt.Println(message)
}

func PrintMeta(label, value string) {
	fmt.Printf("  %-12s%s\n", label+":", value)
}

type Progress struct {
	label string
	start time.Time
	last  int
	total int
}

func NewProgress(label string) *Progress {
	fmt.Printf("o %s\n", label)
	return &Progress{label: label, start: time.Now()}
}

func (p *Progress) Progress(current, total int) {
	p.last = current
	p.total = total
}

func (p *Progress) Stop(status, finalMessage string) {
	tag := "✓"
	if status == "error" {
		tag = "X"
	} else if status == "partial" {
		tag = "!"
	}
	if finalMessage == "" {
		if p.total > 0 {
			finalMessage = fmt.Sprintf("%s [%d/%d] (%s)", p.label, p.last, p.total, FormatDuration(time.Since(p.start)))
		} else {
			finalMessage = p.label
		}
	}
	fmt.Printf("%s %s\n", tag, finalMessage)
}
