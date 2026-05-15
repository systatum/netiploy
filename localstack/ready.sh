#!/bin/bash

# for testing purpose

wait-for-it localhost:4566 -t 30 -- awslocal s3 mb s3://netiploy-test
wait-for-it localhost:4566 -t 30 -- awslocal s3api put-bucket-acl --bucket netiploy-test --acl public-read
