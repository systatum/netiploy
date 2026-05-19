//go:build e2e

package netiploy

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

const (
	e2eEndpoint = "http://localhost:4566"
	e2eBucket   = "netiploy-test"
)

var e2eToken = ClientToken{
	AccessKeyID:     "test",
	SecretAccessKey: "test",
}

func TestUploadDirectoryToS3(t *testing.T) {
	ctx := e2eContext(t)
	client := e2eClient(t)
	purgePrefix(t, ctx, client, "")

	fixtureDir := buildFixtureDir(t)
	result := Deploy(ctx, e2eDeployArgs(fixtureDir, "", SubfolderNone, ""))

	if !result.OK {
		t.Fatalf("deploy failed: %s", result.Message)
	}
	if result.PublicURL != e2eEndpoint+"/"+e2eBucket+"/site" {
		t.Fatalf("unexpected public URL: %s", result.PublicURL)
	}

	assertKeys(t, ctx, client, "", []string{
		"site/assets/logo.svg",
		"site/index.html",
		"site/style.css",
	})
}

func TestUploadsDirContentsToS3(t *testing.T) {
	ctx := e2eContext(t)
	client := e2eClient(t)
	purgePrefix(t, ctx, client, "")

	fixtureDir := buildFixtureDir(t)
	result := Deploy(ctx, e2eDeployArgs(fixtureDir+"/*", "", SubfolderNone, ""))

	if !result.OK {
		t.Fatalf("deploy failed: %s", result.Message)
	}

	assertKeys(t, ctx, client, "", []string{
		"assets/logo.svg",
		"index.html",
		"style.css",
	})
}

func TestOverwriteDeletesExistingObjects(t *testing.T) {
	ctx := e2eContext(t)
	client := e2eClient(t)
	purgePrefix(t, ctx, client, "")

	staleFile := filepath.Join(t.TempDir(), "stale.txt")
	if err := os.WriteFile(staleFile, []byte("old content"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := client.PutFile(ctx, staleFile, "site/stale.txt"); err != nil {
		t.Fatal(err)
	}

	fixtureDir := buildFixtureDir(t)
	result := Deploy(ctx, e2eDeployArgs(fixtureDir, "", SubfolderNone, ""))

	if !result.OK {
		t.Fatalf("deploy failed: %s", result.Message)
	}

	assertKeys(t, ctx, client, "site/", []string{
		"site/assets/logo.svg",
		"site/index.html",
		"site/style.css",
	})
}

func TestUploadDirToGenerateSubfolder(t *testing.T) {
	ctx := e2eContext(t)
	client := e2eClient(t)
	purgePrefix(t, ctx, client, "")

	fixtureDir := buildFixtureDir(t)
	result := Deploy(ctx, e2eDeployArgs(fixtureDir, "previews", SubfolderGenerate, ""))

	if !result.OK {
		t.Fatalf("deploy failed: %s", result.Message)
	}

	prefix := publicURLPrefix(t, result.PublicURL)
	parts := strings.Split(prefix, "/")
	if len(parts) != 3 || parts[0] != "previews" || len(parts[1]) != 8 || parts[2] != "site" {
		t.Fatalf("unexpected generated prefix: %s", prefix)
	}

	assertKeys(t, ctx, client, prefix+"/", []string{
		prefix + "/assets/logo.svg",
		prefix + "/index.html",
		prefix + "/style.css",
	})
}

func TestUploadDirContentsToGenerateSubfolder(t *testing.T) {
	ctx := e2eContext(t)
	client := e2eClient(t)
	purgePrefix(t, ctx, client, "")

	fixtureDir := buildFixtureDir(t)
	result := Deploy(ctx, e2eDeployArgs(fixtureDir+"/*", "previews", SubfolderGenerate, ""))

	if !result.OK {
		t.Fatalf("deploy failed: %s", result.Message)
	}

	prefix := publicURLPrefix(t, result.PublicURL)
	parts := strings.Split(prefix, "/")
	if len(parts) != 2 || parts[0] != "previews" || len(parts[1]) != 8 {
		t.Fatalf("unexpected generated prefix: %s", prefix)
	}

	assertKeys(t, ctx, client, prefix+"/", []string{
		prefix + "/assets/logo.svg",
		prefix + "/index.html",
		prefix + "/style.css",
	})
}

func TestDeployToGeneratedDeterministicGSubfolder(t *testing.T) {
	ctx := e2eContext(t)
	client := e2eClient(t)
	purgePrefix(t, ctx, client, "")

	fixtureDir := buildFixtureDir(t)
	result1 := Deploy(ctx, e2eDeployArgs(fixtureDir, "prs", "hash:pr-123", ""))
	result2 := Deploy(ctx, e2eDeployArgs(fixtureDir, "prs", "hash:pr-123", ""))

	if !result1.OK {
		t.Fatalf("first deploy failed: %s", result1.Message)
	}
	if !result2.OK {
		t.Fatalf("second deploy failed: %s", result2.Message)
	}
	if result1.PublicURL != result2.PublicURL {
		t.Fatalf("expected same public URL, got %q and %q", result1.PublicURL, result2.PublicURL)
	}
	if result1.PublicURL != e2eEndpoint+"/"+e2eBucket+"/prs/ce1506b9/site" {
		t.Fatalf("unexpected public URL: %s", result1.PublicURL)
	}

	assertKeys(t, ctx, client, "prs/ce1506b9/site/", []string{
		"prs/ce1506b9/site/assets/logo.svg",
		"prs/ce1506b9/site/index.html",
		"prs/ce1506b9/site/style.css",
	})
}

func TestDeployDirContentsToGeneratedDeterministicGSubfolder(t *testing.T) {
	ctx := e2eContext(t)
	client := e2eClient(t)
	purgePrefix(t, ctx, client, "")

	fixtureDir := buildFixtureDir(t)
	result1 := Deploy(ctx, e2eDeployArgs(fixtureDir+"/*", "prs", "hash:pr-123", ""))
	result2 := Deploy(ctx, e2eDeployArgs(fixtureDir+"/*", "prs", "hash:pr-123", ""))

	if !result1.OK {
		t.Fatalf("first deploy failed: %s", result1.Message)
	}
	if !result2.OK {
		t.Fatalf("second deploy failed: %s", result2.Message)
	}
	if result1.PublicURL != result2.PublicURL {
		t.Fatalf("expected same public URL, got %q and %q", result1.PublicURL, result2.PublicURL)
	}
	if result1.PublicURL != e2eEndpoint+"/"+e2eBucket+"/prs/ce1506b9" {
		t.Fatalf("unexpected public URL: %s", result1.PublicURL)
	}

	assertKeys(t, ctx, client, "", []string{
		"prs/ce1506b9/assets/logo.svg",
		"prs/ce1506b9/index.html",
		"prs/ce1506b9/style.css",
	})
}

func TestHashRejectsSpaces(t *testing.T) {
	ctx := e2eContext(t)
	client := e2eClient(t)
	purgePrefix(t, ctx, client, "")

	fixtureDir := buildFixtureDir(t)
	result := Deploy(ctx, e2eDeployArgs(fixtureDir, "prs", "hash:pr 123", ""))

	if result.OK {
		t.Fatal("expected deploy to fail")
	}
	if result.ErrCode != InternalError {
		t.Fatalf("expected error code %d, got %d", InternalError, result.ErrCode)
	}
	if !strings.Contains(result.Message, "String to hash must not contain spaces") {
		t.Fatalf("unexpected error message: %s", result.Message)
	}
}

func TestDeployPublicURLOverride(t *testing.T) {
	ctx := e2eContext(t)
	client := e2eClient(t)
	purgePrefix(t, ctx, client, "")

	fixtureDir := buildFixtureDir(t)
	result := Deploy(ctx, e2eDeployArgs(fixtureDir, "", SubfolderNone, "https://coneto.systatum.com"))

	if !result.OK {
		t.Fatalf("deploy failed: %s", result.Message)
	}
	if result.PublicURL != "https://coneto.systatum.com/site" {
		t.Fatalf("unexpected public URL: %s", result.PublicURL)
	}

	assertKeys(t, ctx, client, "", []string{
		"site/assets/logo.svg",
		"site/index.html",
		"site/style.css",
	})
}

func TestDeployMissingSourceDir(t *testing.T) {
	ctx := e2eContext(t)

	result := Deploy(ctx, e2eDeployArgs(filepath.Join(t.TempDir(), "does-not-exist-netiploy"), "", SubfolderNone, ""))

	if result.OK {
		t.Fatal("expected deploy to fail")
	}
	if result.ErrCode != IOError {
		t.Fatalf("expected error code %d, got %d", IOError, result.ErrCode)
	}
}

func e2eContext(t *testing.T) context.Context {
	t.Helper()
	if os.Getenv("NETIPLOY_E2E") != "1" {
		t.Skip("set NETIPLOY_E2E=1 and run LocalStack to enable E2E tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func publicURLPrefix(t *testing.T, publicURL string) string {
	t.Helper()
	base := e2eEndpoint + "/" + e2eBucket + "/"
	prefix, ok := strings.CutPrefix(publicURL, base)
	if !ok {
		t.Fatalf("public URL %q does not start with %q", publicURL, base)
	}
	return prefix
}

func e2eClient(t *testing.T) *S3Client {
	t.Helper()
	client, err := NewS3Client(ResolvedConfig{ClientConfig: ClientConfig{
		Token:    e2eToken,
		Provider: ProviderS3,
		Endpoint: e2eEndpoint,
		Region:   "us-east-1",
		Bucket:   e2eBucket,
	}})
	if err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(20 * time.Second)
	for {
		if err := client.Warmup(context.Background()); err == nil {
			return client
		}
		if time.Now().After(deadline) {
			t.Fatalf("LocalStack S3 bucket %q is not ready", e2eBucket)
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func e2eDeployArgs(source, prefix, subfolder, publicURL string) DeployArgs {
	return DeployArgs{
		Strategy:  StrategyOverwrite,
		Source:    source,
		Subfolder: subfolder,
		Worker:    3,
		PublicURL: publicURL,
		ClientConfig: ClientConfig{
			Token:    e2eToken,
			Provider: ProviderS3,
			Endpoint: e2eEndpoint,
			Region:   "us-east-1",
			Bucket:   e2eBucket,
			Prefix:   prefix,
		},
	}
}

func buildFixtureDir(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "site")
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"index.html":      "<html><body>Hello</body></html>",
		"style.css":       "body { margin: 0; }",
		"assets/logo.svg": "<svg/>",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func purgePrefix(t *testing.T, ctx context.Context, client *S3Client, prefix string) {
	t.Helper()
	for {
		result, err := client.List(ctx, prefix, "", 1000)
		if err != nil {
			t.Fatal(err)
		}
		for _, object := range result.Contents {
			if err := client.Delete(ctx, object.Key); err != nil {
				t.Fatal(err)
			}
		}
		if !result.IsTruncated {
			return
		}
	}
}

func assertKeys(t *testing.T, ctx context.Context, client *S3Client, prefix string, expected []string) {
	t.Helper()
	result, err := client.List(ctx, prefix, "", 1000)
	if err != nil {
		t.Fatal(err)
	}
	actual := make([]string, 0, len(result.Contents))
	for _, object := range result.Contents {
		actual = append(actual, object.Key)
	}
	sort.Strings(actual)
	sort.Strings(expected)
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("unexpected keys:\nwant: %#v\n got: %#v", expected, actual)
	}
}
