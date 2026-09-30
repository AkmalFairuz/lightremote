package remote

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"io"
	"path"
	"time"

	"github.com/akmalfairuz/lightremote/internal/model"
)

const (
	ftListRequest     uint32 = 0xfc000102
	ftListReply       uint32 = 0xfc000103
	ftUploadStart     uint32 = 0xfc000106
	ftUploadStarted   uint32 = 0xfc000107
	ftUploadData      uint32 = 0xfc000108
	ftUploadDataAck   uint32 = 0xfc000109
	ftUploadEnd       uint32 = 0xfc00010a
	ftUploadEnded     uint32 = 0xfc00010b
	ftDownloadStart   uint32 = 0xfc00010c
	ftDownloadStarted uint32 = 0xfc00010d
	ftDownloadData    uint32 = 0xfc00010e
	ftDownloadChunk   uint32 = 0xfc00010f
	ftDownloadEnd     uint32 = 0xfc000110
	ftMkdirRequest    uint32 = 0xfc000111
	ftMkdirReply      uint32 = 0xfc000112
	ftRemoveRequest   uint32 = 0xfc000113
	ftRemoveReply     uint32 = 0xfc000114
	ftRenameRequest   uint32 = 0xfc000115
	ftRenameReply     uint32 = 0xfc000116
	ftFailedReply     uint32 = 0xfc000119
)

const (
	maxFTEntries     = 100_000
	ftChunkBytes     = 32 * 1024
	maxFTStringBytes = 1 << 20
	maxFTBlockBytes  = 16 << 20
)

type ftReply struct {
	code uint32
	body []byte
}

type tightVNCFiles struct {
	bridge *VNCBridge
}

// List reads a remote directory using TightVNC's uncompressed file-list reply.
func (f *tightVNCFiles) List(remotePath string) ([]model.FileEntry, error) {
	b := f.bridge
	if !b.supportsTightFiles() {
		return nil, ErrUnsupported
	}
	b.operationMu.Lock()
	defer b.operationMu.Unlock()

	request := appendFTString(makeFTRequest(ftListRequest, 0), remotePath)
	if err := b.writeUpstream(request); err != nil {
		return nil, err
	}
	reply, err := b.awaitReply(ftListReply)
	if err != nil {
		return nil, err
	}
	reader := bytes.NewReader(reply.body)
	var countBytes [4]byte
	if _, err := io.ReadFull(reader, countBytes[:]); err != nil {
		return nil, err
	}
	count := binary.BigEndian.Uint32(countBytes[:])
	if count > maxFTEntries {
		return nil, errors.New("TightVNC file list contains too many entries")
	}
	entries := make([]model.FileEntry, 0, count)
	var metadata [18]byte
	for index := uint32(0); index < count; index++ {
		if _, err := io.ReadFull(reader, metadata[:]); err != nil {
			return nil, err
		}
		size := binary.BigEndian.Uint64(metadata[:8])
		modified := binary.BigEndian.Uint64(metadata[8:16])
		flags := binary.BigEndian.Uint16(metadata[16:])
		name, err := readFTString(reader)
		if err != nil {
			return nil, err
		}
		entryPath := path.Join(remotePath, name)
		if remotePath == "/" && len(name) == 2 && isDriveLetter(name[0]) && name[1] == ':' {
			entryPath = name + "/"
		}
		entries = append(entries, model.FileEntry{
			Name:    name,
			Path:    entryPath,
			Size:    int64(size),
			IsDir:   flags&1 != 0,
			ModTime: time.UnixMilli(int64(modified)).UTC(),
		})
	}
	return entries, nil
}

// Download streams successive TightVNC chunks through a pipe.
func (f *tightVNCFiles) Download(remotePath string) (io.ReadCloser, error) {
	b := f.bridge
	if !b.hasCaps(ftDownloadStart, ftDownloadStarted, ftDownloadData, ftDownloadChunk, ftDownloadEnd) {
		return nil, ErrUnsupported
	}
	b.operationMu.Lock()
	request := appendFTString(makeFTRequest(ftDownloadStart), remotePath)
	request = binary.BigEndian.AppendUint64(request, 0)
	if err := b.writeUpstream(request); err != nil {
		b.operationMu.Unlock()
		return nil, err
	}
	if _, err := b.awaitReply(ftDownloadStarted); err != nil {
		b.operationMu.Unlock()
		return nil, err
	}

	reader, writer := io.Pipe()
	go func() {
		defer b.operationMu.Unlock()
		defer writer.Close()

		for {
			request := makeFTRequest(ftDownloadData, 0)
			request = binary.BigEndian.AppendUint32(request, ftChunkBytes)
			if err := b.writeUpstream(request); err != nil {
				writer.CloseWithError(err)
				return
			}
			reply, err := b.awaitOneOf(ftDownloadChunk, ftDownloadEnd)
			if err != nil {
				writer.CloseWithError(err)
				return
			}
			if reply.code == ftDownloadEnd {
				return
			}
			if _, err := writer.Write(reply.body); err != nil {
				return
			}
		}
	}()
	return reader, nil
}

// Upload sends a remote file in acknowledged TightVNC chunks.
func (f *tightVNCFiles) Upload(remotePath string, source io.Reader, onProgress func(int64)) error {
	b := f.bridge
	if !b.hasCaps(ftUploadStart, ftUploadStarted, ftUploadData, ftUploadDataAck, ftUploadEnd, ftUploadEnded) {
		return ErrUnsupported
	}
	b.operationMu.Lock()
	defer b.operationMu.Unlock()

	request := appendFTString(makeFTRequest(ftUploadStart), remotePath)
	request = append(request, 1)
	request = binary.BigEndian.AppendUint64(request, 0)
	if err := b.writeUpstream(request); err != nil {
		return err
	}
	if _, err := b.awaitReply(ftUploadStarted); err != nil {
		return err
	}
	var loaded int64
	buffer := make([]byte, ftChunkBytes)
	for {
		count, readErr := source.Read(buffer)
		if count > 0 {
			request = makeFTRequest(ftUploadData, 0)
			request = binary.BigEndian.AppendUint32(request, uint32(count))
			request = binary.BigEndian.AppendUint32(request, uint32(count))
			request = append(request, buffer[:count]...)
			if err := b.writeUpstream(request); err != nil {
				return err
			}
			if _, err := b.awaitReply(ftUploadDataAck); err != nil {
				return err
			}
			loaded += int64(count)
			if onProgress != nil {
				onProgress(loaded)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	request = binary.BigEndian.AppendUint16(makeFTRequest(ftUploadEnd), 0)
	request = binary.BigEndian.AppendUint64(request, uint64(time.Now().UnixMilli()))
	if err := b.writeUpstream(request); err != nil {
		return err
	}
	_, err := b.awaitReply(ftUploadEnded)
	return err
}

// Mkdir creates one remote directory.
func (f *tightVNCFiles) Mkdir(remotePath string) error {
	return f.simple(ftMkdirRequest, ftMkdirReply, remotePath)
}

// Rename moves one remote file or folder.
func (f *tightVNCFiles) Rename(oldPath, newPath string) error {
	b := f.bridge
	if !b.hasCaps(ftRenameRequest, ftRenameReply) {
		return ErrUnsupported
	}
	b.operationMu.Lock()
	defer b.operationMu.Unlock()
	request := appendFTString(makeFTRequest(ftRenameRequest), oldPath)
	request = appendFTString(request, newPath)
	if err := b.writeUpstream(request); err != nil {
		return err
	}
	_, err := b.awaitReply(ftRenameReply)
	return err
}

// Delete removes one remote file or empty directory.
func (f *tightVNCFiles) Delete(remotePath string) error {
	return f.simple(ftRemoveRequest, ftRemoveReply, remotePath)
}

// simple performs a single-request file operation with an empty success reply.
func (f *tightVNCFiles) simple(requestCode, replyCode uint32, remotePath string) error {
	b := f.bridge
	if !b.hasCaps(requestCode, replyCode) {
		return ErrUnsupported
	}
	b.operationMu.Lock()
	defer b.operationMu.Unlock()
	if err := b.writeUpstream(appendFTString(makeFTRequest(requestCode), remotePath)); err != nil {
		return err
	}
	_, err := b.awaitReply(replyCode)
	return err
}

// hasCaps checks the server's advertised TightVNC message support.
func (b *VNCBridge) hasCaps(codes ...uint32) bool {
	for _, code := range codes {
		if !b.init.caps[code] {
			return false
		}
	}
	return true
}

// makeFTRequest prefixes a TightVNC request with its 32-bit message code.
func makeFTRequest(code uint32, body ...byte) []byte {
	request := binary.BigEndian.AppendUint32(nil, code)
	return append(request, body...)
}

// appendFTString writes TightVNC's length-prefixed, NUL-terminated UTF-8 string.
func appendFTString(request []byte, value string) []byte {
	request = binary.BigEndian.AppendUint32(request, uint32(len(value)+1))
	request = append(request, value...)
	return append(request, 0)
}

// readFTString reads a bounded TightVNC UTF-8 string.
func readFTString(reader io.Reader) (string, error) {
	var lengthBytes [4]byte
	if _, err := io.ReadFull(reader, lengthBytes[:]); err != nil {
		return "", err
	}
	length := binary.BigEndian.Uint32(lengthBytes[:])
	if length > maxFTStringBytes {
		return "", errors.New("TightVNC string is too long")
	}
	data := make([]byte, length)
	if _, err := io.ReadFull(reader, data); err != nil {
		return "", err
	}
	if len(data) > 0 && data[len(data)-1] == 0 {
		data = data[:len(data)-1]
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return "", errors.New("TightVNC string contains an embedded NUL")
	}
	return string(data), nil
}

// readFTReply consumes the complete body for one TightVNC file response.
func readFTReply(reader *bufio.Reader, code uint32) (ftReply, error) {
	reply := ftReply{code: code}
	switch code {
	case ftListReply, ftDownloadChunk:
		body, err := readFTBlock(reader)
		reply.body = body
		return reply, err
	case ftDownloadEnd:
		reply.body = make([]byte, 9)
		_, err := io.ReadFull(reader, reply.body)
		return reply, err
	case ftFailedReply:
		message, err := readFTString(reader)
		reply.body = []byte(message)
		return reply, err
	case ftUploadStarted, ftUploadDataAck, ftUploadEnded,
		ftDownloadStarted, ftMkdirReply, ftRemoveReply, ftRenameReply:
		return reply, nil
	default:
		return reply, vncProtocolError("unsupported TightVNC file reply %08x", code)
	}
}

// readFTBlock decodes a bounded compressed or uncompressed file payload.
func readFTBlock(reader *bufio.Reader) ([]byte, error) {
	var header [9]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	level := header[0]
	compressedSize := binary.BigEndian.Uint32(header[1:5])
	uncompressedSize := binary.BigEndian.Uint32(header[5:9])
	if compressedSize > maxFTBlockBytes || uncompressedSize > maxFTBlockBytes {
		return nil, errors.New("TightVNC file block is too large")
	}
	compressed := make([]byte, compressedSize)
	if _, err := io.ReadFull(reader, compressed); err != nil {
		return nil, err
	}
	if level == 0 {
		if compressedSize != uncompressedSize {
			return nil, errors.New("invalid TightVNC uncompressed block length")
		}
		return compressed, nil
	}
	zlibReader, err := zlib.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, err
	}
	defer zlibReader.Close()
	data, err := io.ReadAll(io.LimitReader(zlibReader, int64(uncompressedSize)+1))
	if err != nil {
		return nil, err
	}
	if len(data) != int(uncompressedSize) {
		return nil, errors.New("invalid TightVNC decompressed block length")
	}
	return data, nil
}
