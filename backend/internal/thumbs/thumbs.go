// Package thumbs gera miniaturas sob demanda e guarda em disco.
package thumbs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"github.com/disintegration/imaging"
	"golang.org/x/sync/singleflight"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
	_ "image/gif"
	_ "image/png"

	"storage-ioh/internal/objects"
	"storage-ioh/internal/storage"
)

var ErrUnsupported = errors.New("tipo sem miniatura")

var imageExts = map[string]bool{"jpg": true, "jpeg": true, "png": true, "gif": true, "webp": true, "bmp": true, "tif": true, "tiff": true}
var videoExts = map[string]bool{"mp4": true, "webm": true, "mov": true, "mkv": true, "m4v": true, "avi": true}

type Service struct {
	dir       string
	maxSource int64
	ffmpeg    string
	group     singleflight.Group
	sem       chan struct{}
}

func New(dir string, maxSourceMB int64) *Service {
	ff, _ := exec.LookPath("ffmpeg")
	return &Service{dir: dir, maxSource: maxSourceMB << 20, ffmpeg: ff, sem: make(chan struct{}, 4)}
}

func (s *Service) Supports(ext string) bool {
	return imageExts[ext] || (s.ffmpeg != "" && videoExts[ext])
}

// Get devolve o caminho de um JPEG em cache, gerando se necessário.
func (s *Service) Get(ctx context.Context, cl *storage.Client, connID, bucket, key, etag string, size int) (string, error) {
	ext := objects.Ext(key)
	if !s.Supports(ext) {
		return "", ErrUnsupported
	}
	h := sha256.Sum256([]byte(connID + "|" + bucket + "|" + key + "|" + etag + "|" + strconv.Itoa(size)))
	name := hex.EncodeToString(h[:])
	file := filepath.Join(s.dir, name[:2], name+".jpg")
	if _, err := os.Stat(file); err == nil {
		return file, nil
	}
	_, err, _ := s.group.Do(file, func() (any, error) {
		if _, err := os.Stat(file); err == nil {
			return nil, nil
		}
		select {
		case s.sem <- struct{}{}:
			defer func() { <-s.sem }()
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		var img image.Image
		var err error
		if videoExts[ext] {
			img, err = s.videoFrame(ctx, cl, bucket, key)
		} else {
			img, err = s.decode(ctx, cl, bucket, key)
		}
		if err != nil {
			return nil, err
		}
		thumb := imaging.Fit(img, size, size, imaging.Lanczos)
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			return nil, err
		}
		tmp, err := os.CreateTemp(filepath.Dir(file), "tmp-*")
		if err != nil {
			return nil, err
		}
		defer os.Remove(tmp.Name())
		if err := jpeg.Encode(tmp, thumb, &jpeg.Options{Quality: 80}); err != nil {
			tmp.Close()
			return nil, err
		}
		if err := tmp.Close(); err != nil {
			return nil, err
		}
		return nil, os.Rename(tmp.Name(), file)
	})
	if err != nil {
		return "", err
	}
	return file, nil
}

func (s *Service) decode(ctx context.Context, cl *storage.Client, bucket, key string) (image.Image, error) {
	obj, err := cl.Get(ctx, bucket, key, "")
	if err != nil {
		return nil, err
	}
	defer obj.Body.Close()
	if obj.ContentLength > s.maxSource {
		return nil, ErrUnsupported
	}
	data, err := io.ReadAll(io.LimitReader(obj.Body, s.maxSource+1))
	if err != nil {
		return nil, err
	}
	img, err := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnsupported, err)
	}
	return img, nil
}

// videoFrame usa ffmpeg com uma URL pré-assinada para extrair um quadro (sem baixar o vídeo inteiro).
func (s *Service) videoFrame(ctx context.Context, cl *storage.Client, bucket, key string) (image.Image, error) {
	url, err := cl.PresignGet(ctx, bucket, key, "", 15*time.Minute)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, s.ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", "1", "-i", url,
		"-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1")
	out, err := cmd.Output()
	if err != nil || len(out) == 0 {
		return nil, fmt.Errorf("%w: ffmpeg", ErrUnsupported)
	}
	return jpeg.Decode(bytes.NewReader(out))
}
