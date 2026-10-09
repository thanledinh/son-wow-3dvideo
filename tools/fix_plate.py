"""Thay bien so bi AI lam meo trong video lap rap bang bien so chuan tu anh 4K.

    python tools/fix_plate.py <video.mp4> <anh-4k.jpg> <video-da-sua.mp4>

Chi dung cho video Bentley hien tai: cac toa do ROI ben duoi do tren video 3840x2160 do.
Bien so tu dong duoc do lai tung frame (no bay vao tu ben trai luc ~7.3s, dung yen tu ~7.9s).
Frame nao bien bi nhoe chuyen dong khong do duoc 4 goc thi dinh vi theo dai xanh "VIE" o mep
trai bien va lam nhoe ngang bien chuan cho khop. Bong phan chieu duoi san duoc ve lai bang ban
lat nguoc, lam mo va giam sang cua bien chuan.
"""
import subprocess
import sys

import cv2
import imageio_ffmpeg
import numpy as np

FIRST_FRAME = 176                     # truoc frame nay bien so chua xuat hien
PLATE_ROI = (1250, 1100, 1720, 1340)  # vung tim bien so trong video (x0, y0, x1, y1)
STILL_ROI = (1980, 1665, 2545, 1955)  # vung tim bien so trong anh 4K
# Tu giac bong phan chieu (TL, TR, BR, BL cua bien da lat) ung voi bien o vi tri dung yen.
REFL_QUAD = np.float32([[1377, 1738], [1657, 1781], [1657, 1893], [1377, 1850]])
# Bien so khi da dung yen (TL, TR, BR, BL) va dai xanh "VIE" o mep trai (x, y, w, h).
REST_QUAD = np.float32([[1372, 1199], [1650, 1219], [1654, 1304], [1380, 1280]])
REST_TL = REST_QUAD[0]
REST_STRIP = (1374, 1201, 31, 81)
STRIP_ROI = (700, 1150, 1720, 1380)
PLATE_AREA = 23000                    # dien tich bien so (px) khi da dung yen


def find_quad(img, roi, expect_area=None):
    """Tu giac sang lon nhat trong ROI, hoac gan dien tich expect_area nhat neu co."""
    x0, y0, x1, y1 = roi
    gray = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    cnts, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    for c in cnts:
        area = cv2.contourArea(c)
        if area < 5000:
            continue
        hull = cv2.convexHull(c)
        ap = cv2.approxPolyDP(hull, 0.03 * cv2.arcLength(hull, True), True)
        if len(ap) != 4:
            continue
        score = -area if expect_area is None else abs(area - expect_area)
        if best is None or score < best[0]:
            best = (score, ap.reshape(4, 2).astype(np.float32) + [x0, y0])
    return None if best is None else order_corners(best[1])


def quad_from_strip(img):
    """Uoc luong bien so tu dai xanh khi bien dang bay. Tra ve (quad, do dai nhoe ngang)."""
    x0, y0, x1, y1 = STRIP_ROI
    hsv = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, (100, 140, 70), (128, 255, 255))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        return None, 0
    x, y, w, h, _ = stats[1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])]
    x, y = x + x0, y + y0
    rx, ry, rw, rh = REST_STRIP
    s = h / rh
    if not 0.9 < s < 1.15 or x <= x0 or x + w >= x1:
        return None, 0
    # Nhoe chuyen dong keo dai dai xanh deu hai ben, nen vi tri that nam o giua.
    tl = np.float32([x + (w - rw * s) / 2 - (rx - REST_TL[0]) * s, y - (ry - REST_TL[1]) * s])
    return np.float32(tl + (REST_QUAD - REST_TL) * s), max(0, int(round(w - rw * s)))


def order_corners(q):
    s = q.sum(1)
    d = np.diff(q, axis=1).ravel()
    return np.float32([q[s.argmin()], q[d.argmin()], q[s.argmax()], q[d.argmax()]])


def soft_mask(shape, quad, feather):
    m = np.zeros(shape[:2], np.float32)
    cv2.fillConvexPoly(m, quad.astype(np.int32), 1.0)
    if feather:
        m = cv2.GaussianBlur(m, (0, 0), feather)
    return m[..., None]


def paste(frame, patch, mask):
    return (patch.astype(np.float32) * mask + frame.astype(np.float32) * (1 - mask)).clip(0, 255).astype(np.uint8)


def main(video, still_path, out_path):
    still = cv2.imread(still_path)
    sq = find_quad(still, STILL_ROI)
    if sq is None:
        sys.exit("Khong tim thay bien so trong anh 4K.")
    x, y, w, h = cv2.boundingRect(sq.astype(np.int32))
    plate = still[y:y + h, x:x + w]
    src = np.float32(sq - [x, y])
    flipped = cv2.flip(plate, 0)
    src_flipped = np.float32([[p[0], h - 1 - p[1]] for p in src])
    # Ban lat nguoc: canh duoi cua bien (BL, BR) thanh canh tren cua bong.
    src_refl = np.float32([src_flipped[3], src_flipped[2], src_flipped[1], src_flipped[0]])

    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    enc = subprocess.Popen(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
            "-c:v", "libx264", "-crf", "12", "-preset", "medium", "-pix_fmt", "yuv420p", out_path,
        ],
        stdin=subprocess.PIPE,
    )

    i = fixed = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        q, smear = None, 0
        if i >= FIRST_FRAME:
            q = find_quad(frame, PLATE_ROI, PLATE_AREA)
            if q is None or abs(cv2.contourArea(q) - PLATE_AREA) >= 9000:
                q, smear = quad_from_strip(frame)
        if q is not None:
            # Bien so
            M = cv2.getPerspectiveTransform(src, q)
            warped = cv2.warpPerspective(plate, M, (W, H), flags=cv2.INTER_LANCZOS4)
            mask = soft_mask(frame.shape, q, 1.2)
            region = mask[..., 0] > 0.5
            gain = np.clip(frame[region].mean() / max(warped[region].mean(), 1), 0.85, 1.2)
            if smear > 1:
                warped = cv2.blur(warped, (smear, 1))
                mask = cv2.blur(mask, (smear, 1))[..., None]
            frame = paste(frame, (warped.astype(np.float32) * gain).clip(0, 255), mask)

            # Bong phan chieu: chi ve khi bien da gan vi tri dung yen (luc dang bay can xe chua
            # nam tren san). Di chuyen theo bien: x cung chieu, y nguoc chieu.
            dx, dy = q[0] - REST_TL
            if abs(dx) <= 40:
                rq = np.float32(REFL_QUAD + [dx, -dy])
                M = cv2.getPerspectiveTransform(src_refl, rq)
                refl = cv2.warpPerspective(flipped, M, (W, H), flags=cv2.INTER_LINEAR)
                refl = cv2.GaussianBlur(refl, (0, 0), 2.2)
                refl = cv2.blur(refl, (1 + smear, 9))  # nhoe doc nhu mat san bong
                mask = soft_mask(frame.shape, rq, 6)
                region = mask[..., 0] > 0.5
                gain = np.clip(frame[region].mean() / max(refl[region].mean(), 1), 0.2, 1.0)
                frame = paste(frame, refl.astype(np.float32) * gain, mask)
            fixed += 1
        enc.stdin.write(frame.tobytes())
        i += 1

    cap.release()
    enc.stdin.close()
    enc.wait()
    print(f"{i} frames, da sua bien so o {fixed} frame -> {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
