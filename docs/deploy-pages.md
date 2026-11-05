# Triển khai launcher lên GitHub Pages

Repo: <https://github.com/ThanhTamSW/tsn-app> (nhánh `launcher`)
Trang launcher: <https://thanhtamsw.github.io/tsn-app/>

Repo này có **hai nhánh độc lập**:

| Nhánh | Nội dung | Triển khai |
|---|---|---|
| `app` | `Code.js`, `UI.html`, `appsscript.json`, `.clasp.json`, test harness | `npx clasp push` |
| `launcher` | Trang launcher tĩnh, icon PNG, `tools/build-pages.js`, workflow Pages | GitHub Pages |

Nhánh này (`launcher`) **không chứa** mã nguồn Apps Script: không có `Code.js`,
`UI.html`, `.clasp.json` hay clasp credential. Vì vậy mọi lệnh `clasp` phải chạy
trên nhánh `app`.

Pages chỉ phục vụ trang launcher tĩnh: trang giữ metadata `apple-touch-icon` +
`manifest.json` (thứ iOS/Android đọc khi tạo shortcut) và **chỉ chuyển hướng
top-level** sang deployment `/exec` khi trang đang chạy như ứng dụng đã cài
(standalone). Không dùng `<iframe>`: Apps Script trả **HTTP 401** cho khung
cross-origin.

> **Vì sao không chuyển hướng ngay trong tab thường.** Hệ điều hành đọc
> `apple-touch-icon` từ trang đang hiển thị **tại thời điểm** người dùng bấm
> *Thêm vào màn hình chính*. Nếu launcher nhảy ngay sang `/exec`, `<head>` do
> Google sinh không có metadata icon, nên shortcut nhận icon mặc định.

## 1. Chuẩn bị

```bash
npm install          # không có dependency runtime, chỉ để chạy test
npm test             # phải xanh trước khi publish
npm run app-icon:check
```

## 2. Sinh lại launcher khi deployment đổi

URL `/exec` chỉ đổi khi tạo deployment mới. Lấy URL hiện tại trên nhánh `app`:

```bash
git checkout app
npx clasp deployments
git checkout launcher
```

Rồi sinh lại trang launcher (chọn **một** nguồn icon):

```bash
# Cloudinary (cấu hình đang dùng)
npm run app-icon:launcher -- \
  --app-url https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec \
  --cloudinary uxvmo47y/logo \
  --out docs/launcher

# hoặc icon đã host sẵn
npm run app-icon:launcher -- \
  --app-url https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec \
  --icon-base https://thanhtamsw.github.io/tsn-app/icons \
  --out docs/launcher
```

`npm test` sẽ bắt lỗi nếu trang launcher còn placeholder, thiếu
`apple-touch-icon`, hoặc trỏ sai URL.

## 3. Build thư mục publish

```bash
npm run pages:build
```

Lệnh này kiểm tra launcher + manifest + icon **trước khi ghi**, rồi tạo `_site/`:

```
_site/
├── index.html
├── manifest.json
├── README.md
├── .nojekyll
└── icons/
    ├── app-icon-180.png
    ├── app-icon-192.png
    └── app-icon-512.png
```

`_site/` nằm trong `.gitignore` và **không** commit.

## 4. Publish

### Cách A — workflow tự động (khuyến nghị)

Workflow `.github/workflows/pages.yml` chạy `npm test` + `npm run pages:build`
mỗi lần push nhánh `launcher`, rồi deploy artifact:

1. **Settings → Pages → Source: GitHub Actions**
2. Push nhánh `launcher`; workflow `pages` build và deploy
3. Theo dõi ở tab **Actions**

### Cách B — publish nhánh `gh-pages`

```bash
npm run pages:build
git add -f _site
git commit -m "chore: publish launcher site"
git push origin gh-pages
```

Sau đó **Settings → Pages → Source: Deploy from a branch → `gh-pages` / root**.

> Không chạy `pages:build --out docs` hay `--out .`: công cụ xoá thư mục đầu ra
> trước khi ghi, và nó từ chối thư mục gốc project cùng mọi thư mục nguồn.

## 5. Đẩy mã web app (nhánh `app`)

Pages không deploy Apps Script. Việc đó làm trên nhánh `app`:

```bash
git checkout app
npm test
npx clasp push
npx clasp deploy --description "launcher link + fixes"
```

Deployment mới có thể sinh URL `/exec` mới → quay lại bước 2 nếu URL đổi.

## 6. Kiểm tra sau khi deploy

| Kiểm tra | Kỳ vọng |
|---|---|
| Mở <https://thanhtamsw.github.io/tsn-app/> trên điện thoại | Hiện màn hình logo xanh, **không** tự nhảy sang web app |
| Bấm *Mở ứng dụng* | Web app mở ở cửa sổ cấp cao nhất, đăng nhập bình thường |
| `icons/app-icon-192.png` trả 200 + `image/png` | Đúng file PNG |
| Thêm shortcut màn hình chính | Icon là logo phòng tập, không phải chữ cái |
| Shortcut cũ | Phải **xoá và thêm lại** thì mới đọc icon mới |

### Thêm shortcut đúng cách

1. Mở URL launcher bằng **Safari** (iOS) hoặc **Chrome** (Android) — trang sẽ
   hiện màn hình logo xanh và **không** tự chuyển đi.
2. Bấm **Chia sẻ** → **“Thêm vào màn hình chính”**.
3. Đặt tên rồi **Thêm**. Icon lấy từ `apple-touch-icon` của chính trang launcher.

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Trang trắng / 404 | Pages chưa build xong hoặc sai folder | Xem tab Actions, kiểm tra `index.html` có ở gốc thư mục publish |
| Trang launcher mở nhưng không chuyển hướng | Bình thường khi mở bằng tab trình duyệt | Bấm *Mở ứng dụng*, hoặc mở từ shortcut đã cài |
| Launcher không chuyển hướng dù đã cài | URL `/exec` sai hoặc deployment bị xoá | Chạy lại `app-icon:launcher` với URL mới |
| Icon vẫn là chữ cái | Shortcut cũ giữ metadata cũ | Xoá shortcut, thêm lại |
| `manifest.json` bị bỏ qua | `start_url`/`scope` khác origin | Giữ `./` (build tool đã kiểm tra) |

Xem thêm: [`app-icon.md`](app-icon.md) (phần icon/launcher).
