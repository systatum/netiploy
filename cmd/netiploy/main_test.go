package main

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/systatum/netiploy/internal/netiploy"
)

func TestParseAPIToken(t *testing.T) {
	token, err := parseAPIToken("access:secret:with:colons")
	if err != nil {
		t.Fatal(err)
	}
	if token.AccessKeyID != "access" {
		t.Fatalf("unexpected access key: %q", token.AccessKeyID)
	}
	if token.SecretAccessKey != "secret:with:colons" {
		t.Fatalf("unexpected secret key: %q", token.SecretAccessKey)
	}
}

func TestParseAPITokenRejectsInvalidToken(t *testing.T) {
	_, err := parseAPIToken("missing-colon")
	if err == nil {
		t.Fatal("expected token parser to fail")
	}
	if !strings.Contains(err.Error(), "accessKeyId:secretAccessKey") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestParseDestinationArgs(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "with to keyword", args: []string{"to", "r2/bucket/prefix"}, want: "r2/bucket/prefix"},
		{name: "without to keyword", args: []string{"s3/bucket"}, want: "s3/bucket"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseDestinationArgs(tt.args)
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}

func TestParseDestinationArgsRejectsInvalidShapes(t *testing.T) {
	tests := [][]string{
		{"to"},
		{"to", "r2/bucket", "extra"},
		{"r2/bucket", "extra"},
	}

	for _, args := range tests {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			_, err := parseDestinationArgs(args)
			if err == nil {
				t.Fatal("expected destination parser to fail")
			}
		})
	}
}

func TestParseDeployOptions(t *testing.T) {
	opts, positional, err := parseDeployOptions([]string{
		"to",
		"r2/bucket/site",
		"--token=access:secret",
		"--account-id",
		"account",
		"--worker",
		"7",
		"--subfolder",
		"hash:pr-123",
		"--strategy=overwrite",
		"--public-url",
		"https://cdn.example.com",
	})
	if err != nil {
		t.Fatal(err)
	}

	if len(positional) != 2 || positional[0] != "to" || positional[1] != "r2/bucket/site" {
		t.Fatalf("unexpected positional args: %#v", positional)
	}
	if opts.token == nil || opts.token.AccessKeyID != "access" || opts.token.SecretAccessKey != "secret" {
		t.Fatalf("unexpected token: %#v", opts.token)
	}
	if opts.accountID != "account" {
		t.Fatalf("unexpected account ID: %q", opts.accountID)
	}
	if opts.worker != 7 {
		t.Fatalf("unexpected worker count: %d", opts.worker)
	}
	if opts.subfolder != "hash:pr-123" {
		t.Fatalf("unexpected subfolder: %q", opts.subfolder)
	}
	if opts.strategy != netiploy.StrategyOverwrite {
		t.Fatalf("unexpected strategy: %q", opts.strategy)
	}
	if opts.publicURL != "https://cdn.example.com" {
		t.Fatalf("unexpected public URL: %q", opts.publicURL)
	}
}

func TestParseDeployOptionsDefaults(t *testing.T) {
	opts, positional, err := parseDeployOptions([]string{"s3/bucket"})
	if err != nil {
		t.Fatal(err)
	}
	if len(positional) != 1 || positional[0] != "s3/bucket" {
		t.Fatalf("unexpected positional args: %#v", positional)
	}
	if opts.worker != 5 {
		t.Fatalf("unexpected worker default: %d", opts.worker)
	}
	if opts.subfolder != netiploy.SubfolderNone {
		t.Fatalf("unexpected subfolder default: %q", opts.subfolder)
	}
	if opts.strategy != netiploy.StrategyOverwrite {
		t.Fatalf("unexpected strategy default: %q", opts.strategy)
	}
}

func TestParseDeployOptionsRejectsInvalidValues(t *testing.T) {
	tests := [][]string{
		{"--token"},
		{"--token=invalid"},
		{"--worker=0"},
		{"--worker=abc"},
		{"--strategy=merge"},
		{"--unknown=value"},
	}

	for _, args := range tests {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			_, _, err := parseDeployOptions(args)
			if err == nil {
				t.Fatal("expected option parser to fail")
			}
		})
	}
}

func TestResolveSource(t *testing.T) {
	source, err := resolveSource("example")
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(source) {
		t.Fatalf("expected absolute source, got %q", source)
	}
	if strings.HasSuffix(source, "/*") {
		t.Fatalf("did not expect wildcard suffix: %q", source)
	}
}

func TestResolveSourcePreservesWildcardIntent(t *testing.T) {
	source, err := resolveSource("example/*")
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(strings.TrimSuffix(source, "/*")) {
		t.Fatalf("expected absolute wildcard base, got %q", source)
	}
	if !strings.HasSuffix(source, "/*") {
		t.Fatalf("expected wildcard suffix, got %q", source)
	}
}

func TestResolveTokenPrefersExplicitToken(t *testing.T) {
	t.Setenv("NETIPLOY_ACCESS_KEY_ID", "env-access")
	t.Setenv("NETIPLOY_SECRET_ACCESS_KEY", "env-secret")

	token := resolveToken(&netiploy.ClientToken{
		AccessKeyID:     "explicit-access",
		SecretAccessKey: "explicit-secret",
	})
	if token.AccessKeyID != "explicit-access" || token.SecretAccessKey != "explicit-secret" {
		t.Fatalf("unexpected token: %#v", token)
	}
}

func TestResolveTokenUsesEnvironmentAliases(t *testing.T) {
	t.Setenv("NETIPLOY_ACCESS_KEY_ID", "")
	t.Setenv("NETIPLOY_SECRET_ACCESS_KEY", "")
	t.Setenv("S3_ACCESS_KEY_ID", "s3-access")
	t.Setenv("S3_SECRET_ACCESS_KEY", "s3-secret")

	token := resolveToken(nil)
	if token.AccessKeyID != "s3-access" || token.SecretAccessKey != "s3-secret" {
		t.Fatalf("unexpected token: %#v", token)
	}
}
