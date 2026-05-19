package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/systatum/netiploy/internal/netiploy"
)

var version = "1.1.1"

type deployOptions struct {
	token     *netiploy.ClientToken
	accountID string
	worker    int
	subfolder string
	strategy  string
	publicURL string
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		var coded netiploy.CodedError
		if errors.As(err, &coded) {
			netiploy.PrintError(netiploy.BuildErrorMessage(coded.Code, coded.Error()))
			os.Exit(coded.Code.ExitCode())
		}
		netiploy.PrintError(netiploy.BuildErrorMessage(netiploy.InternalError, err.Error()))
		os.Exit(netiploy.InternalError.ExitCode())
	}
}

func run(args []string) error {
	if len(args) == 0 {
		printUsage()
		return nil
	}
	switch args[0] {
	case "-v", "--version", "version":
		fmt.Printf("Systatum Netiploy %s\n", version)
		return nil
	case "-h", "--help", "help":
		printUsage()
		return nil
	case "deploy":
		return runDeploy(args[1:])
	default:
		return netiploy.CodedError{Code: netiploy.CmdLineError, Err: fmt.Errorf("Unknown command: %s", args[0])}
	}
}

func runDeploy(args []string) error {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		printDeployUsage()
		return nil
	}

	source := args[0]
	opts, positional, err := parseDeployOptions(args[1:])
	if err != nil {
		return netiploy.CodedError{Code: netiploy.CmdLineError, Err: err}
	}
	destination, err := parseDestinationArgs(positional)
	if err != nil {
		return netiploy.CodedError{Code: netiploy.CmdLineError, Err: err}
	}

	source, err = resolveSource(source)
	if err != nil {
		return netiploy.CodedError{Code: netiploy.CmdLineError, Err: err}
	}

	parts := strings.Split(destination, "/")
	if len(parts) < 2 {
		return netiploy.CodedError{Code: netiploy.CmdLineError, Err: fmt.Errorf("Destination must be in format '{provider}/{bucket}' or '{provider}/{bucket}/{prefix}'")}
	}
	provider, bucket := parts[0], parts[1]
	prefix := strings.Join(parts[2:], "/")
	if provider != netiploy.ProviderR2 && provider != netiploy.ProviderS3 {
		return netiploy.CodedError{Code: netiploy.CmdLineError, Err: fmt.Errorf("Unsupported provider %q. Supported providers: r2, s3", provider)}
	}
	if bucket == "" {
		return netiploy.CodedError{Code: netiploy.CmdLineError, Err: fmt.Errorf("Bucket name is required in destination")}
	}

	token := resolveToken(opts.token)
	if token.AccessKeyID == "" || token.SecretAccessKey == "" {
		return netiploy.CodedError{Code: netiploy.CmdLineError, Err: fmt.Errorf("Missing or invalid credentials. Provide via --token or environment variables.")}
	}
	if provider == netiploy.ProviderR2 && opts.accountID == "" && os.Getenv("R2_ACCOUNT_ID") == "" {
		return netiploy.CodedError{Code: netiploy.CmdLineError, Err: fmt.Errorf("Missing Cloudflare R2 account ID. Provide via --account-id or R2_ACCOUNT_ID env var.")}
	}
	if opts.accountID == "" {
		opts.accountID = os.Getenv("R2_ACCOUNT_ID")
	}

	netiploy.PrintBanner(fmt.Sprintf("Netiploy Deploy v%s", version))
	netiploy.PrintInfo(fmt.Sprintf("Deploying %s to %s/%s/%s", source, provider, bucket, prefix))

	started := time.Now()
	result := netiploy.Deploy(context.Background(), netiploy.DeployArgs{
		Strategy:  opts.strategy,
		Source:    source,
		Subfolder: opts.subfolder,
		Worker:    opts.worker,
		PublicURL: opts.publicURL,
		ClientConfig: netiploy.ClientConfig{
			Token:     token,
			Provider:  provider,
			Bucket:    bucket,
			AccountID: opts.accountID,
			Prefix:    prefix,
		},
	})
	elapsed := netiploy.FormatDuration(time.Since(started))
	if result.OK {
		netiploy.PrintSummary(fmt.Sprintf("Deployment successful! (%s)", elapsed))
		netiploy.PrintMeta("Public URL", fallback(result.PublicURL, "N/A"))
		return nil
	}

	netiploy.PrintSummary(fmt.Sprintf("Deployment failed! (%s)", elapsed))
	code := result.ErrCode
	if code == 0 {
		code = netiploy.InternalError
	}
	return netiploy.CodedError{Code: code, Err: errors.New(result.Message)}
}

func parseDeployOptions(args []string) (deployOptions, []string, error) {
	opts := deployOptions{worker: 5, subfolder: netiploy.SubfolderNone, strategy: netiploy.StrategyOverwrite}
	var positional []string

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !strings.HasPrefix(arg, "-") {
			positional = append(positional, arg)
			continue
		}
		name, value, hasValue := strings.Cut(arg, "=")
		readValue := func() (string, error) {
			if hasValue {
				return value, nil
			}
			if i+1 >= len(args) {
				return "", fmt.Errorf("missing value for %s", name)
			}
			i++
			return args[i], nil
		}

		switch name {
		case "--token":
			raw, err := readValue()
			if err != nil {
				return opts, nil, err
			}
			token, err := parseAPIToken(raw)
			if err != nil {
				return opts, nil, err
			}
			opts.token = &token
		case "--account-id":
			value, err := readValue()
			if err != nil {
				return opts, nil, err
			}
			opts.accountID = value
		case "--worker":
			raw, err := readValue()
			if err != nil {
				return opts, nil, err
			}
			worker, err := strconv.Atoi(raw)
			if err != nil || worker < 1 {
				return opts, nil, fmt.Errorf("--worker must be a positive integer, got %q", raw)
			}
			opts.worker = worker
		case "--subfolder":
			value, err := readValue()
			if err != nil {
				return opts, nil, err
			}
			opts.subfolder = value
		case "--strategy":
			value, err := readValue()
			if err != nil {
				return opts, nil, err
			}
			if value != netiploy.StrategyOverwrite {
				return opts, nil, fmt.Errorf("unsupported strategy %q", value)
			}
			opts.strategy = value
		case "--public-url":
			value, err := readValue()
			if err != nil {
				return opts, nil, err
			}
			opts.publicURL = value
		default:
			return opts, nil, fmt.Errorf("unknown option: %s", name)
		}
	}

	return opts, positional, nil
}

func parseAPIToken(value string) (netiploy.ClientToken, error) {
	accessKeyID, secretAccessKey, ok := strings.Cut(value, ":")
	if !ok {
		return netiploy.ClientToken{}, fmt.Errorf("Token must be in format 'accessKeyId:secretAccessKey'")
	}
	return netiploy.ClientToken{AccessKeyID: accessKeyID, SecretAccessKey: secretAccessKey}, nil
}

func parseDestinationArgs(args []string) (string, error) {
	if len(args) == 2 && args[0] == "to" {
		return args[1], nil
	}
	if len(args) == 1 && args[0] != "to" {
		return args[0], nil
	}
	if len(args) == 1 {
		return "", fmt.Errorf("Missing destination. Usage: netiploy deploy <source> [to] <provider>/<bucket>[/<prefix>]")
	}
	return "", fmt.Errorf("Unexpected arguments: %s. Usage: netiploy deploy <source> [to] <provider>/<bucket>[/<prefix>]", strings.Join(args, " "))
}

func resolveSource(source string) (string, error) {
	if strings.HasSuffix(source, "/*") {
		base := strings.TrimSuffix(source, "/*")
		abs, err := filepath.Abs(base)
		if err != nil {
			return "", err
		}
		return abs + "/*", nil
	}
	return filepath.Abs(source)
}

func resolveToken(token *netiploy.ClientToken) netiploy.ClientToken {
	if token != nil {
		return *token
	}
	return netiploy.ClientToken{
		AccessKeyID:     fallback(os.Getenv("NETIPLOY_ACCESS_KEY_ID"), os.Getenv("S3_ACCESS_KEY_ID")),
		SecretAccessKey: fallback(os.Getenv("NETIPLOY_SECRET_ACCESS_KEY"), os.Getenv("S3_SECRET_ACCESS_KEY")),
	}
}

func fallback(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func printUsage() {
	fmt.Println(`Usage:
  netiploy deploy <source> [to] <provider>/<bucket>[/<prefix>] [options]
  netiploy --version`)
}

func printDeployUsage() {
	fs := flag.NewFlagSet("deploy", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	fs.String("token", "", "Auth token in accessKeyId:secretAccessKey format")
	fs.String("account-id", "", "Cloudflare R2 account ID")
	fs.Int("worker", 5, "Number of concurrent upload workers")
	fs.String("subfolder", "none", "Subfolder mode: none | generate | hash:<word>")
	fs.String("strategy", "overwrite", "Deploy strategy")
	fs.String("public-url", "", "Public URL to print in place of the bucket URL")
	fmt.Println("Usage: netiploy deploy <source> [to] <provider>/<bucket>[/<prefix>] [options]")
	fs.PrintDefaults()
}
