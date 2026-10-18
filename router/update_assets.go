package router

import (
	"bytes"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

// RetainUpdateAssets keeps hashed chunks available to dashboards opened before a
// managed update. Existing files are immutable; a collision blocks startup.
func RetainUpdateAssets(buildFS embed.FS, directory string) error {
	if directory == "" {
		return nil
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return err
	}
	defer root.Close()
	assets, err := fs.Sub(buildFS, "web/dist/assets")
	if err != nil {
		return err
	}
	return fs.WalkDir(assets, ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if name == "." {
				return nil
			}
			return root.MkdirAll(name, 0700)
		}
		data, err := fs.ReadFile(assets, name)
		if err != nil {
			return err
		}
		if existing, readErr := root.ReadFile(name); readErr == nil {
			if !bytes.Equal(existing, data) {
				return fmt.Errorf("retained asset collision: %s", name)
			}
			return nil
		} else if !os.IsNotExist(readErr) {
			return readErr
		}
		// Complete the file before exposing its final name to either instance.
		file, err := os.CreateTemp(directory, ".asset-*")
		if err != nil {
			return err
		}
		temporary := file.Name()
		defer os.Remove(temporary)
		if _, err = file.Write(data); err != nil {
			file.Close()
			return err
		}
		if err = file.Close(); err != nil {
			return err
		}
		return root.Rename(path.Base(temporary), name)
	})
}

func retainedUpdateAsset(directory string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if directory == "" || (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) {
			return
		}
		name, ok := strings.CutPrefix(c.Request.URL.Path, "/assets/")
		if !ok || !fs.ValidPath(name) {
			return
		}
		root, err := os.OpenRoot(directory)
		if err != nil {
			return
		}
		defer root.Close()
		file, err := root.Open(name)
		if err != nil {
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			return
		}
		c.Header("X-Content-Type-Options", "nosniff")
		http.ServeContent(c.Writer, c.Request, name, info.ModTime(), file)
		c.Abort()
	}
}
