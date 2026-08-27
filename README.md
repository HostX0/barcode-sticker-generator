# Barcode Sticker Generator

A frontend-first Next.js tool for generating serialised product stickers from finished artwork.

## What it does

- Upload any PNG/JPEG/WebP sticker artwork.
- Set physical output dimensions in millimetres.
- Suggest a unique-ish product prefix and allow manual editing.
- Configure serial digit count, start number and quantity.
- Validate the exact inclusive serial range.
- Generate QR codes and Code 128 barcodes.
- Drag and resize QR, barcode and serial areas over the artwork.
- Export CSV, Excel, a single composed PNG, or a ZIP containing the full sticker batch.
- Render locally in the browser with no backend in V1.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
```

## Current default dimensions

- Roll sticker: 190 × 96 mm
- Vehicle sticker: 85 × 55 mm

The UI accepts custom sizes and stores overlay positions as percentages to preserve placement during proportional resize.

## Project decisions

See [`PROJECT.md`](./PROJECT.md) for the project source of truth, serial rules, VIVID product reference, and future phases.
