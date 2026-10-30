import base64, struct, zlib, pathlib

def png(width, height, rgba):
    """Build a minimal valid PNG from an RGBA pixel buffer."""
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    raw = b''.join(b'\x00' + rgba[y*width*4:(y+1)*width*4] for y in range(height))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))

def draw(size, bg, fg, pad_ratio=0.22, template=False):
    """Rounded square with an 'M'-like chevron glyph; template mode = black + alpha only."""
    px = bytearray(size*size*4)
    pad = int(size*pad_ratio)
    radius = max(2, int(size*0.22))
    def inside_rounded(x, y):
        if x < pad or y < pad or x >= size-pad or y >= size-pad:
            return False
        cx = min(max(x, pad+radius), size-pad-radius)
        cy = min(max(y, pad+radius), size-pad-radius)
        return (x-cx)**2 + (y-cy)**2 <= radius*radius
    def glyph(x, y):
        # Two chevrons forming a stylised "M" / markdown mark.
        gx, gy = x - pad, y - pad
        inner = size - 2*pad
        if gx < 0 or gy < 0 or gx >= inner or gy >= inner:
            return False
        stroke = max(1, inner // 7)
        # left diagonal down, middle peak, right diagonal down
        t = gx / max(1, inner-1)
        left_y  = int(t*2*inner*0.35) if t < 0.5 else int((1-t)*2*inner*0.35)
        band_top = pad + int(inner*0.30) + left_y
        return band_top <= gy < band_top + stroke
    for y in range(size):
        for x in range(size):
            i = (y*size + x)*4
            if not inside_rounded(x, y):
                px[i:i+4] = b'\x00\x00\x00\x00'
                continue
            if glyph(x, y):
                if template:
                    px[i:i+4] = bytes([0, 0, 0, 255])
                else:
                    px[i:i+4] = bytes(fg)
            else:
                if template:
                    px[i:i+4] = bytes([0, 0, 0, 255])
                else:
                    px[i:i+4] = bytes(bg)
    return bytes(px)

ACCENT = (79, 109, 245, 255)
DARK   = (24, 24, 28, 255)
LIGHT  = (245, 246, 250, 255)

out = pathlib.Path('resources'); out.mkdir(exist_ok=True)

# App icon (macOS/Windows/Linux builder input)
(out/'icon.png').write_bytes(png(512, 512, draw(512, DARK, LIGHT)))
# Tray icons: macOS template images are alpha-only and adapt to the menu bar.
tray = png(22, 22, draw(22, DARK, LIGHT, template=True))
(out/'trayTemplate.png').write_bytes(tray)
(out/'trayTemplate@2x.png').write_bytes(png(44, 44, draw(44, DARK, LIGHT, template=True)))
# Windows/Linux tray uses a coloured icon.
(out/'tray.png').write_bytes(png(32, 32, draw(32, ACCENT, LIGHT)))

# Base64 of the template tray icon, embedded so the main process never depends on file paths
# resolving the same way in dev and in a packaged asar.
b64 = base64.b64encode(tray).decode()
(out/'tray-data-url.txt').write_text(f'data:image/png;base64,{b64}')
print('icons written:', sorted(p.name for p in out.iterdir()))
print('tray data-url bytes:', len(b64))
