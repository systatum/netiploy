package netiploy

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"path/filepath"
	"strings"
)

const (
	ProviderR2 = "r2"
	ProviderS3 = "s3"

	SubfolderNone     = "none"
	SubfolderGenerate = "generate"
)

type ClientToken struct {
	AccessKeyID     string
	SecretAccessKey string
}

type ClientConfig struct {
	Token     ClientToken
	Provider  string
	AccountID string
	Endpoint  string
	Region    string
	Bucket    string
	Prefix    string
	PublicURL string
}

type DeployArgs struct {
	Strategy     string
	Source       string
	Subfolder    string
	Worker       int
	ClientConfig ClientConfig
	PublicURL    string
}

type ResolvedConfig struct {
	ClientConfig
}

func ResolveSubfolder(mode string) (string, error) {
	switch mode {
	case "", SubfolderNone:
		return "", nil
	case SubfolderGenerate:
		return randomID(8)
	default:
		if strings.HasPrefix(mode, "hash:") {
			word := strings.TrimPrefix(mode, "hash:")
			if strings.Contains(word, " ") {
				return "", fmt.Errorf("String to hash must not contain spaces")
			}
			return fmt.Sprintf("%x", XXH32String(word, 0)), nil
		}
		return "", fmt.Errorf("Unknown mode is given: %s", mode)
	}
}

func ResolveConfig(args DeployArgs) (ResolvedConfig, error) {
	sourceName := filepath.Base(args.Source)
	subfolder, err := ResolveSubfolder(args.Subfolder)
	if err != nil {
		return ResolvedConfig{}, err
	}

	rawPrefix := joinPath(args.ClientConfig.Prefix, subfolder, sourceName)
	prefix := rawPrefix
	if rawPrefix == "*" {
		prefix = ""
	} else if strings.HasSuffix(rawPrefix, "/*") {
		prefix = strings.TrimSuffix(rawPrefix, "/*")
	}

	cfg := args.ClientConfig
	cfg.PublicURL = args.PublicURL
	cfg.Prefix = prefix
	if cfg.AccountID == "" {
		cfg.AccountID = "default-account"
	}

	switch cfg.Provider {
	case ProviderR2:
		cfg.Endpoint = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfg.AccountID)
		cfg.Region = "auto"
	case ProviderS3:
		if cfg.Endpoint == "" {
			cfg.Endpoint = "http://localhost:4566"
		}
		if cfg.Region == "" {
			cfg.Region = "us-east-1"
		}
	default:
		return ResolvedConfig{}, fmt.Errorf("Unsupported provider: %s", cfg.Provider)
	}

	return ResolvedConfig{ClientConfig: cfg}, nil
}

func BuildPublicURL(config ResolvedConfig) string {
	pathSegment := ""
	if config.Prefix != "" {
		pathSegment = "/" + config.Prefix
	}
	if config.PublicURL != "" {
		return strings.TrimRight(config.PublicURL, "/") + pathSegment
	}
	if config.Provider == ProviderR2 {
		return fmt.Sprintf("https://%s.r2.dev%s", config.Bucket, pathSegment)
	}
	return strings.TrimRight(config.Endpoint, "/") + "/" + config.Bucket + pathSegment
}

func joinPath(parts ...string) string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.Trim(part, "/")
		if part != "" {
			out = append(out, part)
		}
	}
	return strings.Join(out, "/")
}

func randomID(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(buf)
	if len(id) > n {
		id = id[:n]
	}
	return id, nil
}
