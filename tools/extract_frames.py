"""Tach video thanh chuoi anh WebP cho hieu ung tua-theo-cuon-trang.

    python tools/extract_frames.py duong/dan/video.mp4
    python tools/extract_frames.py video.mp4 --fps 30 --width 1920 --quality 80

Ket qua: <out>/frame_0001.webp ... va <out>/manifest.json (trang web doc file nay).
Trang dung 2 bo: frames/desktop (rong ~1600) va frames/mobile (rong ~960), xem README.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent.parent
PATTERN = "frame_%04d.webp"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video", type=Path)
    p.add_argument("--out", default="frames", help="thu muc dau ra, tinh tu goc du an")
    p.add_argument("--fps", type=float, default=0, help="0 = giu nguyen fps goc")
    p.add_argument("--width", type=int, default=1920, help="chieu rong toi da cua moi frame")
    p.add_argument("--quality", type=int, default=80, help="chat luong WebP 0-100")
    p.add_argument("--fit", choices=["auto", "cover", "contain"], default="auto",
                   help="cover = phu kin man hinh, contain = hien du khung hinh, "
                        "auto = cover tren desktop, contain khi video ngang tren dien thoai")
    p.add_argument("--pos-x", type=float, default=0.5,
                   help="vi tri ngang cua khung hinh 0..1 (0.5 = giua)")
    p.add_argument("--reverse", action="store_true",
                   help="dao nguoc video (dung cho video AI 'xe thao roi' -> thanh 'xe lap rap')")
    args = p.parse_args()

    if not args.video.is_file():
        sys.exit(f"Khong thay file: {args.video}")

    out = args.out.strip("/\\").replace("\\", "/")
    OUT_DIR = ROOT / out
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("frame_*.webp"):
        old.unlink()

    filters = []
    if args.fps > 0:
        filters.append(f"fps={args.fps}")
    filters.append(f"scale='min({args.width},iw)':-2:flags=lanczos")
    if args.reverse:
        filters.append("reverse")

    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(args.video),
            "-vf", ",".join(filters),
            "-c:v", "libwebp", "-quality", str(args.quality), "-compression_level", "4",
            str(OUT_DIR / PATTERN),
        ],
        check=True,
    )

    frames = sorted(OUT_DIR.glob("frame_*.webp"))
    if not frames:
        sys.exit("ffmpeg khong xuat ra frame nao.")

    # Doc kich thuoc tu frame dau (header VP8/VP8L/VP8X cua WebP).
    width, height = webp_size(frames[0])
    manifest = {
        "count": len(frames),
        "width": width,
        "height": height,
        "pattern": f"{out}/frame_{{n}}.webp",
        "pad": 4,
        "fit": args.fit,
        "posX": args.pos_x,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    total_mb = sum(f.stat().st_size for f in frames) / 1024 / 1024
    print(f"{len(frames)} frames {width}x{height}, tong {total_mb:.1f} MB -> {OUT_DIR}")


def webp_size(path):
    data = path.read_bytes()[:30]
    chunk = data[12:16]
    if chunk == b"VP8X":
        w = 1 + int.from_bytes(data[24:27], "little")
        h = 1 + int.from_bytes(data[27:30], "little")
    elif chunk == b"VP8L":
        bits = int.from_bytes(data[21:25], "little")
        w = (bits & 0x3FFF) + 1
        h = ((bits >> 14) & 0x3FFF) + 1
    else:  # "VP8 " lossy
        w = int.from_bytes(data[26:28], "little") & 0x3FFF
        h = int.from_bytes(data[28:30], "little") & 0x3FFF
    return w, h


if __name__ == "__main__":
    main()
