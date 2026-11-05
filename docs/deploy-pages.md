# Triển khai launcher lên GitHub Pages

Repo: <https://github.com/ThanhTamSW/tsn-launcher>
Trang launcher: <https://thanhtamsw.github.io/tsn-launcher/>

Repo này **chỉ chứa trang shortcut** (launcher) cho icon màn hình chính. Nó
không chứa `Code.js` / `UI.html` — mã nguồn Apps Script nằm ở repo riêng
`tsn-app` (private).

## Trang launcher là gì

Apps Script không thể cung cấp icon màn hình chính:

- `<head>` của web app do Google sinh ra, **không có** `apple-touch-icon`;
- web app **từ chối** render trong `<iframe>` khác origin (lỗi HTTP 401).

Nên shortcut trỏ về trang này. Trang giữ metadata icon (`apple-touch-icon`,
`manifest.json`), rồi:

- **chế độ standalone** (mở từ icon trên màn hình chính) → tự chuyển sang `/exec`;
- **tab trình duyệt thường** (đang tạo shortcut) → **đứng yên**, vì điện thoại
  chụp icon tại đúng thời điểm tạo shortcut.

Danh sách file:

| File | Vai trò |
|---|---|
| `docs/launcher/index.html` | Trang redirect + metadata icon (nguồn) |
| `docs/launcher/manifest.json` | `start_url`/`scope` = `./`, 3 icon |
| `assets/app-icon-*.png` | Icon 180/192/512 đã kiểm hợp lệ |
| `tools/build-pages.js` | Sinh `_site/` đã kiểm (dùng trong CI) |

## Bật Pages lần đầu (chỉ làm một lần)

1. Mở <https://github.com/ThanhTamSW/tsn-launcher/settings/pages>
2. Mục **Source** → chọn **GitHub Actions**
3. Không cần chọn branch

Sau đó mỗi lần push lên `main`, workflow `.github/workflows/pages.yml` sẽ chạy
`npm test` → `npm run pages:build` → deploy. **Site không publish nếu test đỏ.**

## Quy trình cập nhật

Nếu đổi deployment ID hoặc icon, sinh lại launcher rồi build:

```bash
npm run app-icon:launcher -- \
  --app-url https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec \
  --cloudinary uxvmo47y/logo \
  --out docs/launcher

npm test
npm run pages:build
git add -A
git commit -m "chore: cập nhật launcher"
git push
```

Workflow tự chạy lại và deploy trong khoảng 1 phút.

## Liên quan

- Icon và kích thước ảnh: [`app-icon.md`](app-icon.md).
- Bản thân web app (Apps Script) **không** deploy bằng repo này; mã nguồn ở repo
  private `tsn-app` và được đẩy bằng `npx clasp push`. Repo launcher này chỉ
  phục vụ trang shortcut.

## Kiểm tra sau khi deploy

| Việc | Kỳ vọng |
|---|---|
| Mở <https://thanhtamsw.github.io/tsn-launcher/> trên điện thoại | Hiện màn hình logo xanh, **không** tự nhảy sang web app |
| Bấm Chia sẻ → Thêm vào màn hình chính | Icon là logo phòng tập, không phải icon Google |
| Bấm icon trên màn hình chính | Tự mở web app |
| Mở `/tsn-launcher/Code.js` | Phải **404** (repo không chứa source) |

## Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Site 404 | Pages chưa bật | Làm mục "Bật Pages lần đầu" |
| Workflow fail ở "Configure Pages" | Pages chưa bật | Bật Pages rồi chạy lại workflow |
| Icon vẫn mặc định | Shortcut cũ chưa xoá | Xoá shortcut, thêm lại từ URL launcher |
| Trang tự nhảy sang app khi đang tạo shortcut | Dùng bản launcher cũ (redirect vô điều kiện) | Push lại `docs/launcher/index.html` mới |
| Test đỏ | Launcher/manifest lệch | Chạy `npm test` xem file nào sai |
