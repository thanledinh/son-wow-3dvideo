# Store Detailing – Phủ gầm

Trang phủ gầm của Store Detailing: cảnh 3D chạy thật bằng three.js, mở đầu bằng chìa khóa và nút START, sau đó là các trang giới thiệu sản phẩm GB. Trang chủ của site (`/`) là `phu-gam.html`. Không cần framework hay bước build.

## Trang PPF (`ppf.html`)

Bản thử cho dịch vụ dán PPF, không dùng video AI. Ảnh Bentley 4K thật (`assets/ppf-car.webp`) zoom dần vào nắp capo; bên trái là sơ đồ 4 lớp (lớp phủ tự phục hồi, màng TPU, lớp keo, sơn zin) dựng bằng CSS 3D, tách ra khi cuộn. Code nằm trong `css/ppf.css` và `js/ppf.js`; tên và chú thích các lớp sửa trong `ppf.html`.

## Trang phủ gầm (`phu-gam.html`)

Cảnh 3D chạy thật bằng three.js (không render video): Innova Zenix trên cầu nâng 2 trụ trong xưởng, cuộn trang thì camera đi theo đường bay GB dựng trong Blender (bay vòng → chui gầm → xịt phủ), gầm đổi từ thép xám sang lớp phủ đen. Sau câu chuyện là phần "Xoay xem gầm": kéo để xoay xe (thanh trượt so trước/sau khi phủ và nút Chat Zalo nổi đã bỏ khỏi trang; code thanh trượt trong `js/phu-gam.js` vẫn còn, bỏ phần tử `#coat` thì gầm luôn ở trạng thái đã phủ).

- Code: `js/phu-gam.js` (shader lớp phủ dựng lại từ node `GB_Underbody_Scan`, ánh sáng, camera), `css/phu-gam.css`. three.js r186 nằm sẵn trong `js/vendor/` (không cần build).
- Mô hình: `assets/phu-gam/innova-gam.glb` (Draco + WebP, ~3,2 MB: đã cắt bản scan gầm Impala GB dùng lúc đầu và thu ảnh bề mặt xuống 1024 px) và `scene.json` (đường camera 240 khung, tiến độ phủ, đèn). Đổi file thì tăng `VERSION` đầu `js/phu-gam.js`, vì nginx cache `assets/` 7 ngày.
- Xuất lại từ file Blender của GB:
  ```bash
  blender -b --factory-startup --disable-autoexec GB_Innova_gam.blend --python tools/export_phu_gam.py -- assets/phu-gam
  ```
- Cầu nâng, người thợ: chuyển từ bản glTF tải trên Sketchfab bằng `tools/export_glb.mjs`, chạy qua chính three.js trong Chrome headless (Blender làm lệch xương tay nâng). Cần chạy `python -m http.server 5291` trước; `GLTFExporter.js` lấy từ gói three cùng bản r186.
  ```bash
  node tools/export_glb.mjs đường/dẫn/car_lift assets/phu-gam/lift.glb đường/dẫn/GLTFExporter.js --clip up
  ```
  ```bash
  python tools/clean_worker_texture.py đường/dẫn/car_mechanic/textures/Wolf3D_Outfit_Top_diffuse.jpeg
  ```
  ```bash
  python -I -X utf8 tools/uniform_worker_texture.py đường/dẫn/car_mechanic/textures assets/logo.png
  ```
  ```bash
  node tools/export_glb.mjs đường/dẫn/car_mechanic assets/phu-gam/worker.glb đường/dẫn/GLTFExporter.js --max 512 --flat
  ```
  Bước `clean_worker_texture.py` xoá chữ in sau lưng áo thợ, `uniform_worker_texture.py` tô lại thành đồng phục tiệm (đen, viền xanh nhạt, logo trên ngực); cả hai sửa thẳng vào file ảnh, chạy trên bản giải nén. Trang tự điều khiển động tác "up" của cầu nâng: tay xoay vào trong đoạn mở đầu, rồi nâng theo đúng độ cao xe. Người thợ được tạo dáng bằng code trong `js/phu-gam-worker.js` (súng phủ gầm kiểu Schutz dựng bằng code trong `buildGun`, IK tay cầm súng, chân bước, đầu nhìn theo chỗ xịt, sương phun); vị trí và nhịp đi ở `SPRAYER` trong `js/phu-gam.js`.
- Gầm xe: `assets/phu-gam/underbody.glb` (~170k tam giác, nén Draco còn 0,8 MB, không texture, bóng đổ nướng vào màu đỉnh), dựng bằng script Blender theo ảnh gầm Innova Hycross/Zenix thật, thay cho bản scan Impala của GB (đã cắt hẳn khỏi file xe). Dựng lại rồi nén lại bằng gltf-transform (bản xuất từ Blender chưa nén, ~5,5 MB):
  ```bash
  blender -b --factory-startup --python tools/build_underbody.py -- assets/phu-gam/underbody.glb
  ```
  Tên vật liệu `UB_*` là quy ước với `js/phu-gam.js`: `UB_Floor`, `UB_Sealer`, `UB_Plastic`, `UB_Steel` nhận lớp phủ; ống xả, tấm chắn nhiệt, nhôm, ốc kẽm không phủ, màu chỉnh ở `UNDER_METAL`; cao su, dây, lốp dự phòng giữ nguyên.
- Màn mở đầu chìa khóa + nút START lấy từ daily.zappa.vn (`css/phu-gam-gate.css`, `js/phu-gam-gate.js`, markup `#gate` trong `phu-gam.html`): tải đủ 100% (màn tải logo + thanh phần trăm) thì chìa khóa mới hiện ra, nhấn START thì nẹt bô (`assets/phu-gam/no-may.mp3`, bản ghi xe thật CC0 của daily), chìa khóa ngả xuống, màn mờ đi và cảnh 3D mới bắt đầu mở màn (`js/phu-gam.js` giữ `intro.hold` tới khi nhận "gam:go"). Bỏ qua màn này khi có `?debug`, có `#hash` trên link hoặc bật giảm chuyển động. Logo trên và huy hiệu lục giác GB trên chìa khóa: `assets/phu-gam/gb-logo.webp`, `gb-mark.webp` (cắt từ tờ poster GB, nền trong suốt); chữ trên chìa khóa sửa trong hàm `keySVG`.
- Phần thông tin dưới cảnh 3D dựng theo trang bảng giá đại lý daily.zappa.vn (repo `store-pring`): mỗi trang là một ảnh poster gốc của hãng GB `assets/phu-gam/info/poster-<tên>.webp` (1080×1920), mỗi trang trọn một màn hình trên sân khấu dính (máy tính: cả chặng ba tấm một trang, điện thoại: mỗi tấm một trang), đổi trang bằng vệt phun phủ thay cho cảnh xe kéo bảng: một vệt đen lốm đốm quét từ trái sang phải, phía trước vệt vẫn là trang cũ, phía sau vệt đã là trang mới (vẽ bằng canvas trong `paintSpray`, `js/phu-gam-info.js`: mép loang, lớp phủ bóng ướt, sương phun và cây súng GB chạy dọc mép; hình súng `assets/phu-gam/info/spray-gun-a.webp` và `spray-gun-b.webp` (hai góc nhìn, chụp từ mô hình súng trong cảnh 3D, nền trong suốt; súng chuyển dần giữa hai góc và nghiêng theo hướng đi); độ dài cuộn mỗi trang và nhịp đổi: `SEG`, `HOLD`), thanh lộ trình có chiếc xe chạy ở đáy màn hình, cuối là trang "Liên hệ đặt hàng". Code: `css/phu-gam-info.css`, `js/phu-gam-info.js`. Tấm đầu `poster-cao-cap.webp` là ảnh WebP động 540×960, 12 hình/giây, chạy MỘT lần rồi dừng ở hình cuối, lướt đi rồi lướt lại tới thì chạy lại từ đầu (`replayHero` trong `js/phu-gam-info.js`: lấy file về thành blob rồi gán địa chỉ blob mới cho ảnh). Làm từ video GB.mp4 bằng `ffmpeg -i GB.mp4 -an -vf "fps=12,scale=540:-2" -c:v libwebp -q:v 40 -loop 1 -preset picture poster-cao-cap.webp`; dùng ảnh động thay vì thẻ video để iPhone không tự mở trình phát; đổi file thì tăng `?v=` ở `phu-gam.html`. Nhạc nền `assets/phu-gam/nhac-nen.mp3` (lấy từ daily.zappa.vn, nén lại 64 kbps còn 2 MB bằng `ffmpeg -i nhac-nen.mp3 -c:a libmp3lame -b:a 64k`, 4 phút 15, lặp; đổi file thì tăng `?v=` trong `js/phu-gam-gate.js`) bật khi bấm START, nút loa ở thanh trên cùng để tắt / bật (`js/phu-gam-gate.js`). Đổi giá thì thay ảnh cùng tên và sửa chữ mô tả (`alt`) trong `phu-gam.html`. Thêm chặng: thêm `data-stop="Tên chặng"` vào section, thanh lộ trình tự thêm chấm.
- Nhịp cuộn sửa ở `TIMELINE`, độ sáng từng đèn ở `LIGHT_GAIN` trong `js/phu-gam.js`. Giá và bảo hành lấy từ storedetailing.vn (kiểm tra 05/11/2026).
- Chuyển động của người thợ (`assets/phu-gam/worker-idle.glb`, `worker-walk.glb`) là mocap lấy từ thư viện animation của Ready Player Me (github.com/readyplayerme/animation-library), dùng cho avatar Ready Player Me; người thợ là avatar loại này. Chưa đọc được file giấy phép của thư viện (đường dẫn LICENSE trả 404), cần kiểm tra lại trước khi dùng lâu dài.
- Bốn mô hình gốc theo giấy phép CC BY (Innova: 3dshowroom, cầu nâng: Sargone, người thợ: BELAZ; bản scan gầm Impala của omegadarling không còn trong trang nên đã bỏ khỏi ghi nguồn), dòng ghi nguồn ở footer là bắt buộc.

## Chạy thử

```bash
python -m http.server 5291
```

Mở http://localhost:5291/phu-gam.html. Phải chạy qua server (module và mô hình 3D không nạp được khi mở thẳng file).

## Deploy (Docker / Dokploy)

`Dockerfile` đóng gói trang vào nginx và chạy ở **cổng 3000**. Cấu hình nginx nằm trong `nginx.conf`: trang chủ là `phu-gam.html`, thư mục `assets/` cache 7 ngày, HTML/CSS/JS luôn lấy bản mới.

Trên Dokploy: tạo Application → nguồn GitHub `thanledinh/son-wow-3dvideo`, nhánh `main` → Build Type **Dockerfile** → mục Domains đặt Container Port **3000**.

Chạy thử bằng Docker trên máy:

```bash
docker build -t son-wow-3dvideo .
```

```bash
docker run --rm -p 3000:3000 son-wow-3dvideo
```

## Giảm dung lượng tải

Lúc mở trang chỉ tải ~8 MB (trước ~19 MB), cả lượt xem đầy đủ ~14 MB (trước ~21 MB); phần code còn được nginx nén gzip. Các mô hình .glb trong ssets/phu-gam/ đã nén Draco bằng @gltf-transform (draco(), vị trí 14 bit; riêng file xe Innova còn cắt node Scan_Underbody và thu ảnh bề mặt xuống 1024 px); trang đã có sẵn bộ giải nén Draco. Mỗi lần thay file .glb nhớ tăng VERSION đầu js/phu-gam.js. Poster trong js/phu-gam-info.js chỉ tải khi gần tới lượt (warm; nhớ bỏ src trước khi đụng tới loading, nếu không trình duyệt tải ngay). Nhạc nền chỉ tải sau khi bấm START. Không thu nhỏ (minify) các file three.js: bản esbuild làm trang đứng ở 99% khi tải, nên giữ bản gốc.
