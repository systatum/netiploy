package netiploy

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
)

const StrategyOverwrite = "overwrite"

type DeployResult struct {
	OK        bool
	ErrCode   ErrorCode
	Message   string
	PublicURL string
}

type uploadTask struct {
	absolutePath string
	s3Key        string
}

func Deploy(ctx context.Context, args DeployArgs) DeployResult {
	source := args.Source
	onlyContents := strings.HasSuffix(source, "/*")
	sanitizedSource := strings.TrimSuffix(source, "/*")

	info, err := os.Stat(sanitizedSource)
	if err != nil {
		return DeployResult{OK: false, ErrCode: IOError, Message: fmt.Sprintf("Directory not found: %s", source)}
	}
	if !info.IsDir() {
		return DeployResult{OK: false, ErrCode: IOError, Message: fmt.Sprintf("Not a directory: %s", source)}
	}

	resolved, err := ResolveConfig(args)
	if err != nil {
		return DeployResult{OK: false, ErrCode: InternalError, Message: err.Error()}
	}
	client, err := NewS3Client(resolved)
	if err != nil {
		return DeployResult{OK: false, ErrCode: InternalError, Message: err.Error()}
	}
	if err := client.Warmup(ctx); err != nil {
		return DeployResult{OK: false, ErrCode: classifyError(err), Message: err.Error()}
	}

	PrintInfo("Using strategy: " + args.Strategy)
	switch args.Strategy {
	case "", StrategyOverwrite:
		err = runOverwrite(ctx, client, sanitizedSource, onlyContents, resolved.Prefix, args.Worker)
	default:
		err = fmt.Errorf("Unknown deploy strategy: %s", args.Strategy)
	}
	if err != nil {
		return DeployResult{OK: false, ErrCode: classifyError(err), Message: err.Error()}
	}

	return DeployResult{OK: true, PublicURL: BuildPublicURL(resolved)}
}

func runOverwrite(ctx context.Context, client *S3Client, source string, _ bool, prefix string, workerCount int) error {
	if prefix != "" {
		if err := deleteAllObjects(ctx, client, prefix+"/"); err != nil {
			return err
		}
	}

	files, err := collectFiles(source)
	if err != nil {
		return err
	}
	PrintInfo(fmt.Sprintf("Collected %d files to upload", len(files)))

	tasks := make([]uploadTask, 0, len(files))
	for _, absolutePath := range files {
		rel, err := filepath.Rel(source, absolutePath)
		if err != nil {
			return err
		}
		s3RelPath := filepath.ToSlash(rel)
		s3Key := s3RelPath
		if prefix != "" {
			s3Key = prefix + "/" + s3RelPath
		}
		tasks = append(tasks, uploadTask{absolutePath: absolutePath, s3Key: s3Key})
	}
	return uploadFiles(ctx, client, tasks, workerCount)
}

func collectFiles(root string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type().IsRegular() {
			files = append(files, path)
		}
		return nil
	})
	return files, err
}

func deleteAllObjects(ctx context.Context, client *S3Client, prefix string) error {
	progress := NewProgress(fmt.Sprintf("Clearing existing objects from %s/%s...", client.bucket, prefix))
	count := 0
	total := 0
	token := ""
	for {
		result, err := client.List(ctx, prefix, token, 1000)
		if err != nil {
			progress.Stop("error", fmt.Sprintf("Failed to clear objects from %s/%s", client.bucket, prefix))
			return err
		}
		total += result.KeyCount
		for _, object := range result.Contents {
			if err := client.Delete(ctx, object.Key); err != nil {
				progress.Stop("error", fmt.Sprintf("Failed to clear objects from %s/%s", client.bucket, prefix))
				return err
			}
			count++
			progress.Progress(count, total)
		}
		if !result.IsTruncated || result.NextContinuationToken == "" {
			break
		}
		token = result.NextContinuationToken
	}
	progress.Stop("ok", "")
	return nil
}

func uploadFiles(ctx context.Context, client *S3Client, tasks []uploadTask, workerCount int) error {
	if len(tasks) == 0 {
		return nil
	}
	if workerCount < 1 {
		workerCount = 1
	}
	if workerCount > len(tasks) {
		workerCount = len(tasks)
	}
	if workerCount > runtime.NumCPU()*8 {
		workerCount = runtime.NumCPU() * 8
	}

	progress := NewProgress("Uploading files...")
	taskCh := make(chan uploadTask)
	errCh := make(chan error, len(tasks))
	var completed atomic.Int64
	var failed atomic.Int64
	var wg sync.WaitGroup

	for range workerCount {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for task := range taskCh {
				if err := client.PutFile(ctx, task.absolutePath, task.s3Key); err != nil {
					failed.Add(1)
					errCh <- err
				} else {
					completed.Add(1)
				}
				progress.Progress(int(completed.Load()), len(tasks))
			}
		}()
	}

	for _, task := range tasks {
		select {
		case <-ctx.Done():
			close(taskCh)
			wg.Wait()
			return ctx.Err()
		case taskCh <- task:
		}
	}
	close(taskCh)
	wg.Wait()
	close(errCh)

	if failed.Load() > 0 {
		progress.Stop("partial", "")
		return fmt.Errorf("%d file(s) failed to upload", failed.Load())
	}
	progress.Stop("ok", "")
	return nil
}

func classifyError(err error) ErrorCode {
	var netErr net.Error
	if errors.As(err, &netErr) {
		return Unconnectable
	}
	return InternalError
}
