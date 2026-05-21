package netiploy

import (
	"encoding/binary"
	"math/bits"
)

func XXH32String(s string, seed uint32) uint32 {
	data := []byte(s)
	n := len(data)
	i := 0
	h := seed + uint32(n) + 0x165667b1

	if n >= 16 {
		v0 := seed + 0x24234428
		v1 := seed + 0x85ebca77
		v2 := seed
		v3 := seed - 0x9e3779b1

		for i+15 < n {
			v0 = bits.RotateLeft32(v0+binary.LittleEndian.Uint32(data[i:i+4])*0x85ebca77, 13) * 0x9e3779b1
			v1 = bits.RotateLeft32(v1+binary.LittleEndian.Uint32(data[i+4:i+8])*0x85ebca77, 13) * 0x9e3779b1
			v2 = bits.RotateLeft32(v2+binary.LittleEndian.Uint32(data[i+8:i+12])*0x85ebca77, 13) * 0x9e3779b1
			v3 = bits.RotateLeft32(v3+binary.LittleEndian.Uint32(data[i+12:i+16])*0x85ebca77, 13) * 0x9e3779b1
			i += 16
		}
		h = bits.RotateLeft32(v0, 1) + bits.RotateLeft32(v1, 7) + bits.RotateLeft32(v2, 12) + bits.RotateLeft32(v3, 18) + uint32(n)
	}

	for i+3 < n {
		h = bits.RotateLeft32(h+binary.LittleEndian.Uint32(data[i:i+4])*0xc2b2ae3d, 17) * 0x27d4eb2f
		i += 4
	}

	for i < n {
		h = bits.RotateLeft32(h+uint32(data[i])*0x165667b1, 11) * 0x9e3779b1
		i++
	}

	h = (h ^ (h >> 15)) * 0x85ebca77
	h = (h ^ (h >> 13)) * 0xc2b2ae3d
	return h ^ (h >> 16)
}
