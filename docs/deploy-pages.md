# Triển khai launcher lên GitHub Pages

Repo: <https://github.com/ThanhTamSW/tsn-launcher>
Trang launcher: <https://thanhtamsw.github.io/tsn-launcher/>

Repo này **chỉ chứa trang shortcut** (launcher). Nó không chứa `Code.js` /
`UI.html` — mã nguồn Apps Script nằm ở repo riêng `tsn-app` (private).

## Trang launcher là gì

Apps Script không thể cung cấp icon màn hình chính:

- `<head>` của web app do Google sinh ra, **không có** `apple-touch-icon`;
- web app **từ chối** render trong `<iframe>` khác origin (lỗi HTTP 401).

Nên shortcut trỏ về trang này. Trang giữ metadata icon rồi:

- **chế độ standalone** (mở từ icon trên màn hình chính) → tự chuyển sang `/exec`;
- **tab trình duyệt thường** (đang tạo shortcut) → **đứng yên**, vì điện thoại
  chụp icon tại đúng thời điểm tạo shortcut.

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `docs/launcher/index.html` | **Nguồn** trang redirect + metadata icon |
| `docs/launcher/manifest.json` | **Nguồn** manifest (`start_url`/`scope` = `./`) |
| `assets/app-icon-*.png` | Icon 180/192/512 đã kiểm hợp lệ |
| `tools/publish-root.js` | Chép file servable ra **gốc repo** |
| `tools/build-pages.js` | Sinh `_site/` để kiểm tra trước khi publish |

Ở gốc repo (thứ Pages thực sự phục vụ): `index.html`, `manifest.json`,
`.nojekyll`, `icons/*.png`.

## Bật Pages lần đầu — chọn **Deploy from a branch**

1. Mở <https://github.com/ThanhTamSW/tsn-launcher/settings/pages>
2. Mục **Source** → chọn **Deploy from a branch**
3. Mục **Branch** → chọn **`main`** và folder **`/ (root)`**
4. Bấm **Save**

Chờ khoảng 1 phút. **Không** chọn "GitHub Actions": chế độ đó cần workflow và
`GITHUB_TOKEN` không được phép tự tạo Pages site
(`Resource not accessible by integration`), nên sẽ fail ngay lần đầu.

## Quy trình cập nhật

Nếu đổi deployment ID hoặc icon, sinh lại launcher rồi publish:

```bash
npm run app-icon:launcher -- \
  --app-url https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec \
  --cloudinary uxvmo47y/logo \
  --out docs/launcher

npm test
npm run pages:publish
git add -A
git commit -m "chore: cập nhật launcher"
git push
```

Pages tự phục vụ bản mới sau ~1 phút (branch mode không cần build).

## Kiểm tra sau khi bật Pages

| Việc | Kỳ vọng |
|---|---|
| Mở <https://thanhtamsw.github.io/tsn-launcher/> trên điện thoại | Hiện màn hình logo xanh, **không** tự nhảy sang web app |
| Bấm Chia sẻ → Thêm vào màn hình chính | Icon là logo phòng tập |
| Bấm icon trên màn hình chính | Tự mở web app |
| Mở `/tsn-launcher/Code.js` | Phải **404** (repo không chứa source) |

## Liên quan

- Icon và kích thước ảnh: [`app-icon.md`](app-icon.md).
- Web app (Apps Script) **không** deploy bằng repo này; mã nguồn ở repo private
  `tsn-app` và đẩy bằng `npx clasp push`.

## Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Site 404 | Pages chưa bật, hoặc chọn sai Branch | Settings → Pages → branch `main`, folder `/ (root)` |
| Trang hiện danh sách file (không phải launcher) | Thiếu `index.html` ở gốc | Chạy `npm run pages:publish` rồi push |
| Icon vẫn mặc định | Shortcut cũ chưa xoá | Xoá shortcut, thêm lại từ URL launcher |
| Trang tự nhảy khi đang tạo shortcut | `index.html` ở gốc là bản cũ | `npm run pages:publish` rồi push |
| Test đỏ | Root lệch nguồn | `npm run pages:check` xem file nào, rồi publish |
