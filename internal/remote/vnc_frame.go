package remote

import (
	"io"
)

const (
	maxVNCRectangleBytes   = 64 << 20
	hextileTilePixels      = 16
	maxHextileSubencoding  = 30
	tightFillMode          = 8
	tightJPEGMode          = 9
	maxTightStreamMode     = 7
	tightExplicitFilter    = 4
	tightCopyFilter        = 0
	tightPaletteFilter     = 1
	tightGradientFilter    = 2
	tightSmallPayloadBytes = 12
	tightLengthMaxBytes    = 3
)

const (
	hextileRawFlag byte = 1 << iota
	hextileBackgroundFlag
	hextileForegroundFlag
	hextileSubrectsFlag
	hextileColoredSubrectsFlag
)

// forwardHextile preserves each tile's framing while file replies share the stream.
func (b *VNCBridge) forwardHextile(display io.Writer, width, height uint64) error {
	pixelBytes := uint64(b.pixelBits.Load() / 8)
	if width*height*pixelBytes > maxVNCRectangleBytes {
		return vncProtocolError("hextile rectangle too large")
	}
	for y := uint64(0); y < height; y += hextileTilePixels {
		for x := uint64(0); x < width; x += hextileTilePixels {
			tileWidth := min(uint64(hextileTilePixels), width-x)
			tileHeight := min(uint64(hextileTilePixels), height-y)
			flags, err := b.reader.ReadByte()
			if err != nil {
				return err
			}
			if flags > maxHextileSubencoding {
				return vncProtocolError("invalid hextile subencoding %d", flags)
			}
			if _, err := display.Write([]byte{flags}); err != nil {
				return err
			}
			if flags&hextileRawFlag != 0 {
				if _, err := io.CopyN(display, b.reader, int64(tileWidth*tileHeight*pixelBytes)); err != nil {
					return err
				}
				continue
			}
			if flags&hextileBackgroundFlag != 0 {
				if _, err := io.CopyN(display, b.reader, int64(pixelBytes)); err != nil {
					return err
				}
			}
			if flags&hextileForegroundFlag != 0 {
				if _, err := io.CopyN(display, b.reader, int64(pixelBytes)); err != nil {
					return err
				}
			}
			if flags&hextileSubrectsFlag != 0 {
				count, err := b.reader.ReadByte()
				if err != nil {
					return err
				}
				if _, err := display.Write([]byte{count}); err != nil {
					return err
				}
				size := int64(count) * 2
				if flags&hextileColoredSubrectsFlag != 0 {
					size += int64(count) * int64(pixelBytes)
				}
				if _, err := io.CopyN(display, b.reader, size); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// forwardTight reads Tight's control byte, optional filter, and compact length.
func (b *VNCBridge) forwardTight(display io.Writer, width, height uint64) error {
	control, err := b.reader.ReadByte()
	if err != nil {
		return err
	}
	if _, err := display.Write([]byte{control}); err != nil {
		return err
	}
	mode := control >> 4
	if mode == tightFillMode {
		_, err := io.CopyN(display, b.reader, 3)
		return err
	}
	if mode == tightJPEGMode {
		return b.forwardTightPayload(display)
	}
	if mode > maxTightStreamMode {
		return vncProtocolError("invalid Tight subencoding %d", mode)
	}

	filter := byte(0)
	if mode&tightExplicitFilter != 0 {
		filter, err = b.reader.ReadByte()
		if err != nil {
			return err
		}
		if _, err := display.Write([]byte{filter}); err != nil {
			return err
		}
	}
	var uncompressed uint64
	switch filter {
	case tightCopyFilter, tightGradientFilter:
		uncompressed = width * height * 3
	case tightPaletteFilter:
		countMinusOne, err := b.reader.ReadByte()
		if err != nil {
			return err
		}
		if _, err := display.Write([]byte{countMinusOne}); err != nil {
			return err
		}
		if _, err := io.CopyN(display, b.reader, (int64(countMinusOne)+1)*3); err != nil {
			return err
		}
		bitsPerPixel := uint64(8)
		if countMinusOne == 1 {
			bitsPerPixel = 1
		}
		uncompressed = ((width*bitsPerPixel + 7) / 8) * height
	default:
		return vncProtocolError("invalid Tight filter %d", filter)
	}
	if uncompressed > maxVNCRectangleBytes {
		return vncProtocolError("Tight rectangle too large")
	}
	if uncompressed < tightSmallPayloadBytes {
		_, err := io.CopyN(display, b.reader, int64(uncompressed))
		return err
	}
	return b.forwardTightPayload(display)
}

func (b *VNCBridge) forwardTightPayload(display io.Writer) error {
	var length uint32
	// Tight uses one to three bytes, with the high bit indicating continuation.
	for index := 0; index < tightLengthMaxBytes; index++ {
		part, err := b.reader.ReadByte()
		if err != nil {
			return err
		}
		if _, err := display.Write([]byte{part}); err != nil {
			return err
		}
		if index == tightLengthMaxBytes-1 {
			length |= uint32(part) << 14
		} else {
			length |= uint32(part&0x7f) << (7 * index)
		}
		if part&0x80 == 0 || index == tightLengthMaxBytes-1 {
			break
		}
	}
	if length > maxVNCRectangleBytes {
		return vncProtocolError("Tight compressed rectangle too large")
	}
	_, err := io.CopyN(display, b.reader, int64(length))
	return err
}
