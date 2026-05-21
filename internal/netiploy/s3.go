package netiploy

import (
	"context"
	"mime"
	"os"
	"path/filepath"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type S3Client struct {
	bucket string
	client *s3.Client
}

type Object struct {
	Key string
}

type listBucketResult struct {
	KeyCount              int
	IsTruncated           bool
	NextContinuationToken string
	Contents              []Object
}

func NewS3Client(config ResolvedConfig) (*S3Client, error) {
	cfg := aws.Config{
		Region:      config.Region,
		Credentials: credentials.NewStaticCredentialsProvider(config.Token.AccessKeyID, config.Token.SecretAccessKey, ""),
	}

	client := s3.NewFromConfig(cfg, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(config.Endpoint)
		options.UsePathStyle = true
	})

	return &S3Client{
		bucket: config.Bucket,
		client: client,
	}, nil
}

func (c *S3Client) Warmup(ctx context.Context) error {
	_, err := c.List(ctx, "", "", 0)
	return err
}

func (c *S3Client) List(ctx context.Context, prefix, continuationToken string, maxKeys int) (listBucketResult, error) {
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(c.bucket),
		Prefix: aws.String(prefix),
	}
	if continuationToken != "" {
		input.ContinuationToken = aws.String(continuationToken)
	}
	if maxKeys >= 0 {
		input.MaxKeys = aws.Int32(int32(maxKeys))
	}

	output, err := c.client.ListObjectsV2(ctx, input)
	if err != nil {
		return listBucketResult{}, err
	}

	result := listBucketResult{
		KeyCount:    int(aws.ToInt32(output.KeyCount)),
		IsTruncated: aws.ToBool(output.IsTruncated),
		Contents:    make([]Object, 0, len(output.Contents)),
	}
	if output.NextContinuationToken != nil {
		result.NextContinuationToken = aws.ToString(output.NextContinuationToken)
	}
	for _, object := range output.Contents {
		result.Contents = append(result.Contents, Object{Key: aws.ToString(object.Key)})
	}
	return result, nil
}

func (c *S3Client) Delete(ctx context.Context, key string) error {
	_, err := c.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	return err
}

func (c *S3Client) PutFile(ctx context.Context, filename, key string) error {
	file, err := os.Open(filename)
	if err != nil {
		return err
	}
	defer file.Close()

	contentType := mime.TypeByExtension(filepath.Ext(filename))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	_, err = c.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		Body:        file,
		ContentType: aws.String(contentType),
	})
	return err
}
