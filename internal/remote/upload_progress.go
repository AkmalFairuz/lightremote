package remote

import "io"

type uploadProgressWriter struct {
	target     io.Writer
	onProgress func(int64)
	loaded     int64
}

func (w *uploadProgressWriter) Write(data []byte) (int, error) {
	n, err := w.target.Write(data)
	w.loaded += int64(n)
	if n > 0 && w.onProgress != nil {
		w.onProgress(w.loaded)
	}
	return n, err
}

// FTP owns the data socket. Report the previous chunk when it asks for the
// next one, after that chunk has been written, rather than when it is read.
type uploadProgressReader struct {
	source     io.Reader
	onProgress func(int64)
	loaded     int64
}

func (r *uploadProgressReader) Read(data []byte) (int, error) {
	if r.loaded > 0 && r.onProgress != nil {
		r.onProgress(r.loaded)
	}
	n, err := r.source.Read(data)
	r.loaded += int64(n)
	return n, err
}
