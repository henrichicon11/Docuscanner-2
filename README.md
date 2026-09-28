# DocuScanner

A full-featured, **offline-first document scanner** that runs entirely in the browser and can be installed as a Progressive Web App on phones, tablets and desktops. All image processing happens on-device: your documents are never uploaded anywhere.

## Features

### Capture
- **Live camera scanning** with a real-time document-edge overlay
- **Auto-capture**: the photo is taken automatically once the document is steady
- **Batch mode** for scanning many pages in a row, plus a **single-page** mode
- Flash / torch toggle and front/back camera switching
- **Import from gallery / files** (multiple images at once, EXIF orientation respected)

### Crop & perspective correction
- **Automatic edge detection** in pure JavaScript (Otsu segmentation + Sobel edge-enclosure → convex hull → maximum-area quadrilateral)
- Drag corners (with a **magnifier loupe**) or whole edges to fine-tune
- Re-run auto-detect, reset to the full image, rotate, discard, and step through batch captures
- **Perspective warp** (homography plus bilinear sampling) produces flat, rectangular pages

### Enhancement & editing
- Filters: **Magic Color** (removes shadows and colour casts), **Grayscale**, **B&W** (adaptive threshold), **Lighten**, **Photo**, **Original**
- Live filter thumbnails, brightness and contrast sliders
- Rotate left/right, re-crop any time (the original photo is kept)
- **Apply to all pages** in one tap
- Swipe or use the arrow keys to move between pages

### Documents
- Multi-page documents: add, insert after, duplicate, delete pages
- **Reorder pages** with drag & drop (desktop) or long-press & drag (touch)
- Rename, favorites, **tags**, duplicate, **merge** multiple documents
- Reader mode (continuous scroll)
- Library with **search by name, tags and recognized text**, sort (recent, created, name, pages), grid/list layouts, multi-select

### OCR (text recognition)
- Powered by Tesseract.js, with **20 languages**
- Recognize one page or all pages, with progress feedback
- Edit, copy, share, or download the text as `.txt`
- Recognized text feeds **full-text search** and a **searchable PDF** text layer

### Signatures
- Draw signatures (pressure-aware strokes, 3 ink colours, adjustable pen width), saved for reuse
- Place them on any page, drag to move, resize with the handle, and double-tap to remove

### Export & share
- **PDF**: fit-to-image, A4, US Letter or US Legal page sizes, with margins, a quality setting, page ranges and **password protection**
- **JPEG / PNG** (a ZIP archive for multi-page documents), **plain text**
- **Share** through the native share sheet (Web Share API), with a download fallback
- **Print**

### App
- Installable **PWA** with an offline service worker (OCR language data is cached after first use)
- **Light / dark / system theme**
- Settings for default filter, auto-detect, auto-capture, PDF defaults and OCR language
- Storage usage display and "delete all"

## Tech stack
- Vanilla JavaScript (ES modules) + [Vite](https://vitejs.dev/)
- IndexedDB for persistence (documents, pages, settings)
- [jsPDF](https://github.com/parallax/jsPDF) for PDF generation, [Tesseract.js](https://github.com/naptha/tesseract.js) for OCR
- Custom computer-vision code (no OpenCV), a ZIP writer, and image filters
- [Vitest](https://vitest.dev/) + fake-indexeddb for unit tests

## Getting started

```bash
npm install
npm run dev       # dev server on http://localhost:5173
npm test          # unit tests
npm run build     # production build in dist/
npm run preview   # serve the production build on http://localhost:4173
```

> Browsers only allow camera access on **HTTPS** or `localhost`. If you open the app on another device, serve it over HTTPS.

## Project structure

```
src/
  core/            pure logic (DOM-free, unit-tested)
    geometry.js    homography, perspective warp, rotation
    detect.js      automatic document edge detection
    filters.js     enhancement filters
    storage.js     IndexedDB persistence
    search.js      library sort/filter
    pdf-layout.js  PDF page layout, page ranges, file names
    zip.js         minimal ZIP writer
    image.js       browser image pipeline (decode, render page)
  views/           screens: library, camera, crop, editor, document, ocr, sign, settings, export dialog
  ui/              DOM helpers, icons
  router.js        hash router
  state.js         session state and theme
  pwa.js           service worker and install prompt
public/            manifest, service worker, icons
tests/             Vitest unit tests
```

## License
MIT
