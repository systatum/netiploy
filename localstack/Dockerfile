# use community version of localstack that has built-in persistence in it
# ref: https://github.com/localstack/localstack/issues/6281#issuecomment-1811289385
FROM gresau/localstack-persist:3.3

ENV DATA_DIR /tmp/localstack/data
ENV SERVICES s3

COPY ./wait-for-it /usr/local/bin
RUN chmod +x /usr/local/bin/wait-for-it && chown localstack:localstack /usr/local/bin/wait-for-it

# localstack, S3
EXPOSE 4566
