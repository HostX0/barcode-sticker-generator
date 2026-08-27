# Barcode Sticker Generator — Project Source of Truth

Last updated: 2026-08-27

## 1. Purpose

Create a browser-first tool that turns a finished sticker artwork into a batch of unique serialised product labels. The user uploads any approved artwork, defines the physical sticker size, places the dynamic QR/barcode/serial areas visually, configures the serial range, and exports the finished stickers plus a serial sheet.

The project is deliberately kept simple in V1. It should not become a full design editor or product database yet.

## 2. Repository & deployment

- GitHub: `HostX0/barcode-sticker-generator`
- Branch: `main`
- Vercel project: `barcode-sticker-generator`
- Framework: Next.js + TypeScript
- V1 architecture: frontend-only; no database required

## 3. Core V1 workflow

1. Upload final artwork image from the designer.
2. Set sticker width and height in millimetres.
3. Configure product name.
4. App suggests a more unique product prefix; user may accept or edit it.
5. Select serial digit count (3–8 digits).
6. Enter starting number and quantity.
7. App shows exact inclusive range and blocks overflow.
8. Toggle QR, Code 128 barcode and visible serial text.
9. Drag/resize QR, barcode and serial boxes directly over the uploaded artwork.
10. Preview the first serial.
11. Export CSV, Excel, current PNG or full batch ZIP.

## 4. Serial rules

Canonical serial format:

`PREFIX-00033`

- Prefix: uppercase letters/numbers, unique enough to distinguish similar VIVID SKUs.
- Numeric portion: left-padded to the chosen digit count.
- End number formula: `start + quantity - 1`.
- Example: start 33, quantity 100, 5 digits => `00033` through `00132`.
- App must prevent batches that exceed the selected digit capacity.
- In a future database phase, duplicate prevention must be centralised across devices/users.

## 5. Prefix direction

Prefer product-code-like prefixes instead of very short initials because VIVID has many similarly named items.

Examples / direction only:

- Vivid Pro Shield Color -> `VVPSC`
- Vivid Pro -> `VVP`
- Vivid Pro Matte -> `VVPMT`
- Vivid Pro Max -> `VVPMX`
- Vivid Windshield Armor -> `VVWA`
- Vivid CoolGuard Nano-75 -> `VVCG75`
- Vivid Shadenova Nano-50 -> `VVSN50`

The suggestion algorithm is deterministic and always editable by the user.

## 6. Sticker sizes currently agreed

- Roll sticker (large): 190 × 96 mm.
- Vehicle sticker (small): 85 × 55 mm.

V1 supports any user-entered size. Overlay positions are stored as percentages so proportional resizing does not break placement. If uploaded artwork ratio differs from the target size, the UI warns about distortion and offers Stretch / Contain / Cover behavior.

## 7. Artwork strategy

The designer creates fixed product artwork templates with all static information already designed:

- product name
- thickness / film specification
- colour or finish where applicable
- warranty term
- product-specific feature claims
- graphic icons for those claims
- VIVID branding
- any fixed copy such as “SCAN TO CONFIRM IT'S GENUINE”

The generator should not rebuild those design elements. It only merges dynamic identifiers over the finished artwork.

This is intentionally more robust than maintaining a separate hard-coded React template for every product.

## 8. Dynamic elements placed by the app

- QR code
- Code 128 barcode
- visible serial number

Optional QR behavior:

- V1: QR may contain the serial directly.
- Optional: user supplies a base verification URL and app encodes `BASE_URL/SERIAL`.
- Future: verification page backed by Supabase.

## 9. Export behavior

Current implementation target:

- CSV serial list
- Excel serial list
- one current sticker PNG
- ZIP containing all rendered stickers and batch metadata
- output can be 150 or 300 DPI

Future export improvements may include vector/PDF print sheets when needed by the printer.

## 10. VIVID product reference for designer sheet

Previously confirmed project data includes:

- VIVID PRIME: 6.5 mil, glossy transparent, 5-year warranty, flexible, self-healing.
- VIVID PRO: 7.5 mil, glossy or matte, 10-year warranty, advanced self-healing.
- VIVID PRO MATTE: 7.5 mil, matte, 10-year warranty, fingerprint/dirt resistance.
- VIVID PRO SHIELD COLOR: 7.5 mil; 10-year warranty; large colour/texture range. Current Black sticker example specifically shows: Black, Gloss–Matte Texture, Self-Healing, UV Stable, Colored TPU.
- VIVID COOLGUARD: nanoceramic; up to 80% heat reduction; 99%+ UV; signal-safe; 5-year warranty.
- VIVID SHADENOVA: nano-optic; 5–95% shades; privacy/clear-interior positioning; UV/IR blocking; signal-safe; 5-year warranty.
- VIVID WINDSHIELD ARMOR: clear TPU; self-healing; UV/acid-rain resistance; wiper-safe; 5-year warranty.
- VIVID DUAL FINISH: 7.5–8.5 mil family; gloss + matte; self-healing; 7–10 year family range.

Do not invent unsupported technical numbers for specific SKUs. Any unconfirmed field in the designer sheet should remain TBC until a source/product label confirms it.

## 11. Future phases — not required for V1

### Phase 2 — shared database

Supabase can store products, prefixes, batches, serials, template presets and last-used numbers. This enables duplicate prevention across devices and suggested next start number.

### Phase 3 — authenticity verification

QR route `/verify/[serial]` can show genuine status and product/batch data.

### Phase 4 — installation & warranty

Dealer/installer can activate a serial for a vehicle/customer, installation date and warranty expiry.

## 12. Product principle

Keep the generator dependable and printer-friendly. Prefer a small number of strong controls over a complex Canva-like editor. The uploaded artwork remains the design source of truth; the app owns serialisation and code placement.
