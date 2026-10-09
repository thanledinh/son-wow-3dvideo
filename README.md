# Store Detailing – "Kiệt tác thành hình từng chi tiết"

Landing page cuộn tới đâu chiếc Bentley lắp ráp tới đó, mỗi giai đoạn đi kèm một hạng mục nâng cấp của Store Detailing. Kỹ thuật: video được tách thành chuỗi ảnh WebP, vẽ lên `<canvas>` theo vị trí cuộn. Không cần framework hay bước build.

## Chạy thử

```bash
python -m http.server 5291
```

Mở http://localhost:5291. Phải chạy qua server; mở thẳng file `index.html` sẽ không đọc được `manifest.json`.

## Deploy (Docker / Dokploy)

`Dockerfile` đóng gói trang vào nginx và chạy ở **cổng 3000**. Cấu hình nginx nằm trong `nginx.conf`: frame và ảnh cache 7 ngày, HTML/CSS/JS luôn lấy bản mới.

Trên Dokploy: tạo Application → nguồn GitHub `thanledinh/son-wow-3dvideo`, nhánh `main` → Build Type **Dockerfile** → mục Domains đặt Container Port **3000**.

Chạy thử bằng Docker trên máy:

```bash
docker build -t son-wow-3dvideo .
```

```bash
docker run --rm -p 3000:3000 son-wow-3dvideo
```

Thư mục `source/` (video gốc 4K, ~37 MB) không đưa lên git và không vào image.

Dung lượng tải: desktop ~10,7 MB, điện thoại ~4,9 MB, tải dần từ thô đến mịn. Trang hiện ra sau khoảng 1/8 số frame; phần còn lại tải tiếp trong lúc khách đọc đoạn mở đầu.

## Sửa nội dung

- **Chữ:** sửa trong `index.html`. Mỗi khối `.copy` có `data-range` là thời điểm hiện/ẩn, tính theo tiến độ cuộn từ 0 đến 1.
- **Nhịp video theo cuộn trang:** sửa `TIMELINE` trong `js/main.js` (vị trí cuộn → thời điểm trong video).
- **Màu, font:** sửa biến ở đầu `css/style.css`. Màu nhấn `--accent` lấy từ logo.
- **Số liệu và cam kết:** lấy từ storedetailing.vn (kiểm tra ngày 09/10/2026). Đổi dịch vụ hay bảo hành thì nhớ sửa cả ở đây.

## Làm lại frame từ video mới

1. **Sửa biển số** (chỉ áp dụng cho video Bentley hiện tại; AI làm méo chữ trên biển):
   ```bash
   python tools/fix_plate.py video-goc.mp4 anh-xe-4k.jpg source/bentley-assembly-fixed.mp4
   ```
2. **Tách frame cho desktop và điện thoại:**
   ```bash
   python tools/extract_frames.py source/bentley-assembly-fixed.mp4 --out frames/desktop --width 1600 --quality 70 --pos-x 0.7
   ```
   ```bash
   python tools/extract_frames.py source/bentley-assembly-fixed.mp4 --out frames/mobile --width 960 --quality 68 --pos-x 0.7
   ```

`--pos-x 0.7` dời khung hình sang phải để xe không bị cắt trên màn hình hẹp. Độ phóng to trên điện thoại chỉnh ở `PHONE_ZOOM` / `PHONE_POS_X` trong `js/main.js`.
