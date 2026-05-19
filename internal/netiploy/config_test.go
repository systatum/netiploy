package netiploy

import "testing"

func TestResolveSubfolderHashMatchesPreviousImplementation(t *testing.T) {
	got, err := ResolveSubfolder("hash:pr-123")
	if err != nil {
		t.Fatal(err)
	}
	if got != "ce1506b9" {
		t.Fatalf("expected ce1506b9, got %s", got)
	}
}

func TestResolveConfigPreservesDirectoryName(t *testing.T) {
	cfg, err := ResolveConfig(DeployArgs{
		Source:    "/tmp/site",
		Subfolder: SubfolderNone,
		ClientConfig: ClientConfig{
			Provider: ProviderS3,
			Bucket:   "bucket",
			Prefix:   "",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Prefix != "site" {
		t.Fatalf("expected site prefix, got %q", cfg.Prefix)
	}
}

func TestResolveConfigUploadsDirectoryContents(t *testing.T) {
	cfg, err := ResolveConfig(DeployArgs{
		Source:    "/tmp/site/*",
		Subfolder: SubfolderNone,
		ClientConfig: ClientConfig{
			Provider: ProviderS3,
			Bucket:   "bucket",
			Prefix:   "",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Prefix != "" {
		t.Fatalf("expected empty prefix, got %q", cfg.Prefix)
	}
}

func TestResolveConfigUploadsDirectoryContentsWithSubfolder(t *testing.T) {
	cfg, err := ResolveConfig(DeployArgs{
		Source:    "/tmp/site/*",
		Subfolder: "hash:pr-123",
		ClientConfig: ClientConfig{
			Provider: ProviderS3,
			Bucket:   "bucket",
			Prefix:   "prs",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Prefix != "prs/ce1506b9" {
		t.Fatalf("expected prs/ce1506b9 prefix, got %q", cfg.Prefix)
	}
}
