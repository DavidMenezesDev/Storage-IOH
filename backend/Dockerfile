# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/storage-ioh ./cmd/storage-ioh

FROM alpine:3.22
# WITH_FFMPEG=true habilita miniaturas de vídeo (imagem ~+80 MB)
ARG WITH_FFMPEG=false
RUN apk add --no-cache ca-certificates tzdata wget \
    && if [ "$WITH_FFMPEG" = "true" ]; then apk add --no-cache ffmpeg; fi \
    && adduser -D -u 10001 ioh && mkdir -p /data/thumbs && chown -R ioh /data
COPY --from=build /out/storage-ioh /usr/local/bin/storage-ioh
USER ioh
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["storage-ioh"]
CMD ["api"]
