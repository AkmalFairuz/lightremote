package remote

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/akmalfairuz/lightremote/internal/model"
)

// ultraVNCFiles speaks UltraVNC's RFB message 7 file-transfer protocol.
type ultraVNCFiles struct {
	bridge *VNCBridge
}

func (f *ultraVNCFiles) List(remotePath string) ([]model.FileEntry, error) {
	b := f.bridge
	var wirePath string
	if remotePath != "/" {
		var err error
		wirePath, err = ultraWirePath(remotePath, true, b.ultraVersion.Load())
		if err != nil {
			return nil, err
		}
	}
	b.operationMu.Lock()
	defer b.operationMu.Unlock()
	if err := b.startUltraSession(); err != nil {
		return nil, err
	}
	defer b.endUltraSession()

	if remotePath == "/" {
		if err := b.writeUpstream(ultraPacket(ultraDirRequest, ultraDrives, 0, nil)); err != nil {
			return nil, err
		}
		reply, err := b.awaitUltra(ultraDirPacket)
		if err != nil {
			return nil, err
		}
		if reply.param != ultraDriveList {
			return nil, vncProtocolError("unexpected UltraVNC drive-list reply")
		}
		return ultraDriveEntries(reply.data)
	}

	parameter := uint16(ultraDirContents)
	if b.ultraVersion.Load() >= ultraUnicodeVersion {
		parameter |= ultraUnicodeFlag
	}
	if err := b.writeUpstream(ultraPacket(ultraDirRequest, parameter, 0, []byte(wirePath))); err != nil {
		return nil, err
	}

	entries := []model.FileEntry{}
	expectDirectoryHeader := b.ultraVersion.Load() > ultraLegacyVersion
	for {
		reply, err := b.awaitUltra(ultraDirPacket)
		if err != nil {
			return nil, err
		}
		kind := reply.param &^ uint16(ultraUnicodeFlag)
		switch kind {
		case 0:
			return entries, nil
		case ultraDirDenied:
			return nil, fmt.Errorf("UltraVNC cannot read %s", remotePath)
		case ultraDirectory, ultraFile:
			// Protocol v2+ sends the opened path before WIN32_FIND_DATA records.
			if kind == ultraDirectory && (expectDirectoryHeader || isUltraDirectoryHeader(reply.data)) {
				expectDirectoryHeader = false
				continue
			}
			expectDirectoryHeader = false
			if len(reply.data) < ultraFindDataNameOffset+1 {
				return nil, vncProtocolError("short UltraVNC directory entry")
			}
			entry, err := ultraFileEntry(remotePath, reply)
			if err != nil {
				return nil, err
			}
			if entry.Name != "." && entry.Name != ".." {
				entries = append(entries, entry)
			}
			if len(entries) > ultraMaxFileEntries {
				return nil, errors.New("UltraVNC directory contains too many entries")
			}
		default:
			return nil, vncProtocolError("unsupported UltraVNC directory reply %d", kind)
		}
	}
}

func (f *ultraVNCFiles) Download(remotePath string) (io.ReadCloser, error) {
	b := f.bridge
	wirePath, err := ultraWirePath(remotePath, false, b.ultraVersion.Load())
	if err != nil {
		return nil, err
	}
	b.operationMu.Lock()
	if err := b.startUltraSession(); err != nil {
		b.operationMu.Unlock()
		return nil, err
	}
	release := func() {
		b.endUltraSession()
		b.operationMu.Unlock()
	}
	if err := b.writeUpstream(ultraPacket(ultraFileRequest, 0, 0, []byte(wirePath))); err != nil {
		release()
		return nil, err
	}
	header, err := b.awaitUltra(ultraFileHeader)
	if err != nil {
		release()
		return nil, err
	}
	if header.size == ^uint32(0) && (b.ultraVersion.Load() == ultraLegacyVersion || header.high == ^uint32(0)) {
		release()
		return nil, fmt.Errorf("UltraVNC could not open %s", remotePath)
	}
	if err := b.writeUpstream(ultraPacket(ultraFileHeader, 0, 0, nil)); err != nil {
		release()
		return nil, err
	}

	reader, writer := io.Pipe()
	go func() {
		defer release()
		defer writer.Close()
		for {
			reply, err := b.awaitUltra(ultraFilePacket, ultraEndFile, ultraAbort)
			if err != nil {
				writer.CloseWithError(err)
				return
			}
			if reply.kind == ultraEndFile {
				return
			}
			if reply.kind == ultraAbort {
				writer.CloseWithError(errors.New("UltraVNC canceled the download"))
				return
			}
			blockSize := b.ultraBlockSize.Load()
			if blockSize == 0 {
				blockSize = ultraBlockBytes
			}
			data, err := ultraFileData(reply, int64(blockSize))
			if err != nil {
				writer.CloseWithError(err)
				b.Close()
				return
			}
			if _, err := writer.Write(data); err != nil {
				_ = b.writeUpstream(ultraPacket(ultraAbort, 0, 0, nil))
				// The server may have already queued more chunks. Drain them
				// before another file request can use this shared RFB stream.
				for {
					pending, waitErr := b.awaitUltra(ultraFilePacket, ultraEndFile, ultraAbort)
					if waitErr != nil || pending.kind != ultraFilePacket {
						return
					}
				}
			}
		}
	}()
	return reader, nil
}

func ultraFileData(reply ultraReply, maxBytes int64) ([]byte, error) {
	switch reply.size {
	case 0:
		if int64(len(reply.data)) > maxBytes {
			return nil, vncProtocolError("UltraVNC file packet is too large")
		}
		return reply.data, nil
	case 1:
		reader, err := zlib.NewReader(bytes.NewReader(reply.data))
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		data, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > maxBytes {
			return nil, vncProtocolError("UltraVNC decompressed file packet is too large")
		}
		return data, nil
	default:
		return nil, vncProtocolError("unsupported UltraVNC file packet type %d", reply.size)
	}
}

func (f *ultraVNCFiles) Upload(remotePath string, source io.Reader) error {
	b := f.bridge
	wirePath, err := ultraWirePath(remotePath, false, b.ultraVersion.Load())
	if err != nil {
		return err
	}
	// UltraVNC requires the complete size before accepting an upload. HTTP
	// bodies do not promise Seek, so spool them to a private temporary file.
	temp, err := os.CreateTemp("", "lightremote-ultravnc-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	size, err := io.Copy(temp, source)
	if err != nil {
		return err
	}
	if b.ultraVersion.Load() == ultraLegacyVersion && size > int64(^uint32(0)) {
		return ErrUnsupported
	}
	if _, err := temp.Seek(0, io.SeekStart); err != nil {
		return err
	}

	b.operationMu.Lock()
	defer b.operationMu.Unlock()
	if err := b.startUltraSession(); err != nil {
		return err
	}
	defer b.endUltraSession()
	offer := ultraPacket(ultraFileOffer, 0, uint32(size), []byte(wirePath))
	if b.ultraVersion.Load() > ultraLegacyVersion {
		offer = binary.BigEndian.AppendUint32(offer, uint32(uint64(size)>>32))
	}
	if err := b.writeUpstream(offer); err != nil {
		return err
	}
	for {
		reply, err := b.awaitUltra(ultraChecksums, ultraFileAccept, ultraAbort)
		if err != nil {
			return err
		}
		if reply.kind == ultraChecksums {
			// We send every block in full, so delta checksums are unnecessary.
			continue
		}
		if reply.kind == ultraAbort || reply.size == ^uint32(0) {
			return fmt.Errorf("UltraVNC refused upload to %s", remotePath)
		}
		break
	}

	chunkSize := ultraBlockBytes
	if b.ultraVersion.Load() < ultraUnicodeVersion {
		chunkSize = ultraLegacyBlockBytes
	}
	if negotiated := b.ultraBlockSize.Load(); negotiated >= ultraMinBlockBytes && negotiated <= ultraMaxBlockBytes {
		chunkSize = int(negotiated)
	}
	buffer := make([]byte, chunkSize)
	for {
		count, readErr := temp.Read(buffer)
		if count > 0 {
			if err := b.writeUpstream(ultraPacket(ultraFilePacket, 0, 0, buffer[:count])); err != nil {
				return err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	return b.writeUpstream(ultraPacket(ultraEndFile, 0, 0, nil))
}

func (f *ultraVNCFiles) Mkdir(remotePath string) error {
	wirePath, err := ultraWirePath(remotePath, false, f.bridge.ultraVersion.Load())
	if err != nil {
		return err
	}
	return f.command(ultraCreateDir, ultraDirCreated, wirePath)
}

func (f *ultraVNCFiles) Rename(oldPath, newPath string) error {
	if f.bridge.ultraVersion.Load() == ultraLegacyVersion {
		return ErrUnsupported
	}
	oldWire, err := ultraWirePath(oldPath, false, f.bridge.ultraVersion.Load())
	if err != nil {
		return err
	}
	newWire, err := ultraWirePath(newPath, false, f.bridge.ultraVersion.Load())
	if err != nil {
		return err
	}
	if strings.ContainsAny(oldWire+newWire, "*") {
		return errors.New("UltraVNC cannot rename a path containing *")
	}
	return f.command(ultraRename, ultraFileRenamed, oldWire+"*"+newWire)
}

func (f *ultraVNCFiles) Delete(remotePath string) error {
	wirePath, err := ultraWirePath(remotePath, false, f.bridge.ultraVersion.Load())
	if err != nil {
		return err
	}
	return f.command(ultraDelete, ultraFileDeleted, wirePath)
}

func (f *ultraVNCFiles) command(request, response uint16, data string) error {
	b := f.bridge
	b.operationMu.Lock()
	defer b.operationMu.Unlock()
	if err := b.startUltraSession(); err != nil {
		return err
	}
	defer b.endUltraSession()
	if err := b.writeUpstream(ultraPacket(ultraCommand, request, 0, []byte(data))); err != nil {
		return err
	}
	reply, err := b.awaitUltra(ultraCommandReturn)
	if err != nil {
		return err
	}
	if reply.param != response {
		b.Close()
		return vncProtocolError("unexpected UltraVNC command response %d", reply.param)
	}
	if reply.size != 0 {
		return fmt.Errorf("UltraVNC file command failed for %s", data)
	}
	return nil
}
