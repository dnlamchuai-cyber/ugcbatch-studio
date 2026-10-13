# Local material library

On a project's "Materials" page, expand "Local material library" to upload your own product images, live-action videos and B-roll and reuse them for that project's shots.

## Usage

1. Click "Upload materials". Up to 12 files per upload, each up to 80MB; MP4, WebM, MOV, M4V, JPG/JPEG, PNG and WebP are supported.
2. Upload progress and file check status are shown; you can cancel the upload or retry only the unfinished items. Re-uploading identical content reuses the existing file and keeps its edited name and tags.
3. Click "Name and tags" to organize materials. Names and tags are used for search and automatic shot matching; up to 12 tags, each up to 32 characters. Filter by image/video, sort by upload time or name; the list shows 12 items per page.
4. Select a shot and click "Use for this shot" to make the material the current version. Old candidates are kept and can be switched back in the quality panel; composition reads the currently selected version.
5. Click "Fill empty shots with local materials" to match visuals only from this project's materials, without calling models or online material sources. Shots with a selected finished material, waiting or generating tasks, and product-image shots are skipped. Failed records and unselected older versions do not block filling.

A single shot's "Upload material/Replace material" also accepts the images and videos above and stores them in the local material library automatically. GIF, SVG and BMP still use the existing single-shot image upload flow and do not enter the library.

## Storage and API

- Files live in `APP_DATA_DIR/uploads/<projectId>/materials/`; without a configured data directory the project's `data/` is used. Names and tags are stored in a `.clipforge.json` metadata file in the same directory; the original media is never modified.
- New uploads are first streamed to a temporary file, size-limited by actual bytes, checked for format, dimensions and video duration via media probing, then saved under a content-hash name. A cancelled or failed request cleans up its temporary file.
- Older images and videos placed in the directory manually can still be read and given names and tags; without metadata they are searched by original filename. Symlinks, temporary files and auto-extracted last frames are not listed.
- `GET /api/project/<id>/materials` returns materials and preview URLs; `PATCH` accepts `{ name, originalName, tags }`, where `name` is the actual stored filename returned.
- `POST` should preferably send one file per request: `Content-Type: application/octet-stream`, `X-File-Name` set to the URL-encoded original filename, and the raw file bytes as the body. On success it returns `materials` and `duplicate`.
- The legacy multipart `files` field is still supported (1–12 files, up to 80MB total). If some files fail validation it returns HTTP 207 listing the saved `materials` and the failed `errors` separately; callers should check both before retrying.

Uploading, labeling and local-only filling incur no model cost. If materials are insufficient or unsuitable, add more and reselect the shot.
