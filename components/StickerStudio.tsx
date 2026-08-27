"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import {
  buildSerials,
  cleanPrefix,
  formatSerial,
  maxSerialForDigits,
  serialEnd,
  suggestPrefixes,
  validateSerialConfig,
} from "@/lib/serial";

type Box = { x: number; y: number; width: number; height: number };
type OverlayKey = "qr" | "barcode" | "serial";
type FitMode = "stretch" | "contain" | "cover";
type SizeUnit = "px" | "mm" | "cm";

type TemplateImage = {
  url: string;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
};

const DEFAULT_BOXES: Record<OverlayKey, Box> = {
  qr: { x: 11, y: 40, width: 23, height: 38 },
  barcode: { x: 57, y: 46, width: 28, height: 25 },
  serial: { x: 58, y: 74, width: 26, height: 8 },
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stickers";
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render image."))), type, quality);
  });
}

function drawImageFit(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  mode: FitMode
) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (mode === "stretch") {
    ctx.drawImage(image, 0, 0, width, height);
    return;
  }
  const scale = mode === "cover"
    ? Math.max(width / image.width, height / image.height)
    : Math.min(width / image.width, height / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  ctx.drawImage(image, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
}

function mmToUnit(mm: number, unit: SizeUnit, dpi: number) {
  if (unit === "px") return (mm / 25.4) * dpi;
  if (unit === "cm") return mm / 10;
  return mm;
}

function unitToMm(value: number, unit: SizeUnit, dpi: number) {
  if (unit === "px") return (value / dpi) * 25.4;
  if (unit === "cm") return value * 10;
  return value;
}

function displaySizeValue(mm: number, unit: SizeUnit, dpi: number) {
  const value = mmToUnit(mm, unit, dpi);
  return unit === "px" ? Math.round(value) : Number(value.toFixed(2));
}

export default function StickerStudio() {
  const [productName, setProductName] = useState("Vivid Pro Shield Color");
  const [prefix, setPrefix] = useState("VVPSC");
  const [digits, setDigits] = useState(5);
  const [start, setStart] = useState(33);
  const [quantity, setQuantity] = useState(100);
  const [widthMm, setWidthMm] = useState(190);
  const [heightMm, setHeightMm] = useState(96);
  const [dpi, setDpi] = useState(300);
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("px");
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const [lockedRatio, setLockedRatio] = useState(190 / 96);
  const [fitMode, setFitMode] = useState<FitMode>("stretch");
  const [verificationBaseUrl, setVerificationBaseUrl] = useState("");
  const [enabled, setEnabled] = useState<Record<OverlayKey, boolean>>({ qr: true, barcode: true, serial: true });
  const [boxes, setBoxes] = useState<Record<OverlayKey, Box>>(DEFAULT_BOXES);
  const [selected, setSelected] = useState<OverlayKey>("barcode");
  const [template, setTemplate] = useState<TemplateImage | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [qrPreview, setQrPreview] = useState("");
  const [barcodePreview, setBarcodePreview] = useState("");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => suggestPrefixes(productName), [productName]);
  const config = useMemo(() => ({ prefix, digits, start, quantity }), [prefix, digits, start, quantity]);
  const error = useMemo(() => validateSerialConfig(config), [config]);
  const firstSerial = error ? "INVALID" : formatSerial(prefix, start, digits);
  const end = error ? null : serialEnd(start, quantity);
  const lastSerial = end === null ? "—" : formatSerial(prefix, end, digits);
  const maxSerial = maxSerialForDigits(digits);
  const qrValue = verificationBaseUrl.trim()
    ? `${verificationBaseUrl.replace(/\/$/, "")}/${firstSerial}`
    : firstSerial;

  const outputPixels = useMemo(
    () => ({
      width: Math.max(1, Math.round((widthMm / 25.4) * dpi)),
      height: Math.max(1, Math.round((heightMm / 25.4) * dpi)),
    }),
    [widthMm, heightMm, dpi]
  );

  const originalPhysicalSize = useMemo(() => {
    if (!template) return null;
    const width = (template.naturalWidth / dpi) * 25.4;
    const height = (template.naturalHeight / dpi) * 25.4;
    return {
      widthMm: width,
      heightMm: height,
      widthCm: width / 10,
      heightCm: height / 10,
    };
  }, [template, dpi]);

  const aspectWarning = useMemo(() => {
    if (!template || !widthMm || !heightMm) return "";
    const sourceRatio = template.naturalWidth / template.naturalHeight;
    const targetRatio = widthMm / heightMm;
    const difference = Math.abs(sourceRatio - targetRatio) / sourceRatio;
    if (difference > 0.01 && fitMode === "stretch") {
      return "Ratio is different from the original artwork. Stretch mode will intentionally reshape the design. Lock the ratio to preserve it, or keep it unlocked if this distortion is intentional.";
    }
    return "";
  }, [template, widthMm, heightMm, fitMode]);

  const widthInput = displaySizeValue(widthMm, sizeUnit, dpi);
  const heightInput = displaySizeValue(heightMm, sizeUnit, dpi);
  const unitStep = sizeUnit === "px" ? 1 : sizeUnit === "cm" ? 0.01 : 0.1;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => setPreviewSize({ width: stage.clientWidth, height: stage.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [template, widthMm, heightMm]);

  useEffect(() => {
    if (error) {
      setQrPreview("");
      setBarcodePreview("");
      return;
    }
    let cancelled = false;
    async function buildPreviewCodes() {
      const qr = await QRCode.toDataURL(qrValue, { margin: 0, width: 512, errorCorrectionLevel: "M" });
      const canvas = document.createElement("canvas");
      bwipjs.toCanvas(canvas, {
        bcid: "code128",
        text: firstSerial,
        scale: 3,
        height: 12,
        includetext: false,
        backgroundcolor: "FFFFFF",
      });
      if (!cancelled) {
        setQrPreview(qr);
        setBarcodePreview(canvas.toDataURL("image/png"));
      }
    }
    buildPreviewCodes().catch(() => undefined);
    return () => { cancelled = true; };
  }, [error, firstSerial, qrValue]);

  function handleFile(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (template) URL.revokeObjectURL(template.url);
      const ratio = image.naturalWidth / image.naturalHeight;
      setTemplate({ url, name: file.name, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
      setWidthMm((image.naturalWidth / dpi) * 25.4);
      setHeightMm((image.naturalHeight / dpi) * 25.4);
      setLockedRatio(ratio);
      setLockAspectRatio(true);
      setSizeUnit("px");
      setFitMode("stretch");
    };
    image.src = url;
  }

  function resetToOriginal() {
    if (!template) return;
    const ratio = template.naturalWidth / template.naturalHeight;
    setWidthMm((template.naturalWidth / dpi) * 25.4);
    setHeightMm((template.naturalHeight / dpi) * 25.4);
    setLockedRatio(ratio);
    setLockAspectRatio(true);
    setFitMode("stretch");
  }

  function toggleRatioLock() {
    if (!lockAspectRatio) {
      setLockedRatio(widthMm / heightMm);
      setLockAspectRatio(true);
      return;
    }
    setLockAspectRatio(false);
  }

  function updateDimension(axis: "width" | "height", value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    const mm = unitToMm(value, sizeUnit, dpi);
    if (axis === "width") {
      setWidthMm(mm);
      if (lockAspectRatio) setHeightMm(mm / lockedRatio);
    } else {
      setHeightMm(mm);
      if (lockAspectRatio) setWidthMm(mm * lockedRatio);
    }
  }

  function updateBox(key: OverlayKey, next: Box) {
    setBoxes((current) => ({ ...current, [key]: next }));
  }

  function boxPixels(box: Box) {
    return {
      x: (box.x / 100) * previewSize.width,
      y: (box.y / 100) * previewSize.height,
      width: (box.width / 100) * previewSize.width,
      height: (box.height / 100) * previewSize.height,
    };
  }

  function renderOverlay(key: OverlayKey) {
    if (!enabled[key] || !previewSize.width || !previewSize.height) return null;
    const box = boxes[key];
    const px = boxPixels(box);
    return (
      <Rnd
        key={key}
        bounds="parent"
        size={{ width: px.width, height: px.height }}
        position={{ x: px.x, y: px.y }}
        minWidth={32}
        minHeight={20}
        onMouseDown={() => setSelected(key)}
        onDragStart={() => setSelected(key)}
        onResizeStart={() => setSelected(key)}
        onDragStop={(_, data) => {
          updateBox(key, {
            ...box,
            x: (data.x / previewSize.width) * 100,
            y: (data.y / previewSize.height) * 100,
          });
        }}
        onResizeStop={(_, __, ref, ___, position) => {
          updateBox(key, {
            x: (position.x / previewSize.width) * 100,
            y: (position.y / previewSize.height) * 100,
            width: (ref.offsetWidth / previewSize.width) * 100,
            height: (ref.offsetHeight / previewSize.height) * 100,
          });
        }}
        className={`overlay ${selected === key ? "selected" : ""} ${key === "serial" ? "serial-overlay" : ""}`}
      >
        <span className="overlay-label">{key.toUpperCase()}</span>
        {key === "qr" && qrPreview ? <img src={qrPreview} alt="QR preview" /> : null}
        {key === "barcode" && barcodePreview ? <img src={barcodePreview} alt="Barcode preview" /> : null}
        {key === "serial" ? <span style={{ fontSize: Math.max(8, px.height * 0.52) }}>{firstSerial}</span> : null}
      </Rnd>
    );
  }

  async function generateCodeImages(serial: string) {
    const qrData = verificationBaseUrl.trim()
      ? `${verificationBaseUrl.replace(/\/$/, "")}/${serial}`
      : serial;
    const qr = enabled.qr
      ? await QRCode.toDataURL(qrData, { margin: 0, width: 900, errorCorrectionLevel: "M" })
      : "";
    let barcode = "";
    if (enabled.barcode) {
      const barcodeCanvas = document.createElement("canvas");
      bwipjs.toCanvas(barcodeCanvas, {
        bcid: "code128",
        text: serial,
        scale: 5,
        height: 14,
        includetext: false,
        backgroundcolor: "FFFFFF",
      });
      barcode = barcodeCanvas.toDataURL("image/png");
    }
    return { qr, barcode };
  }

  async function renderSticker(serial: string) {
    if (!template) throw new Error("Upload a template artwork first.");
    const canvas = document.createElement("canvas");
    canvas.width = outputPixels.width;
    canvas.height = outputPixels.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");

    const artwork = await loadImage(template.url);
    drawImageFit(ctx, artwork, canvas.width, canvas.height, fitMode);
    const codes = await generateCodeImages(serial);

    if (enabled.qr && codes.qr) {
      const image = await loadImage(codes.qr);
      const box = boxes.qr;
      ctx.drawImage(
        image,
        (box.x / 100) * canvas.width,
        (box.y / 100) * canvas.height,
        (box.width / 100) * canvas.width,
        (box.height / 100) * canvas.height
      );
    }

    if (enabled.barcode && codes.barcode) {
      const image = await loadImage(codes.barcode);
      const box = boxes.barcode;
      ctx.fillStyle = "#fff";
      ctx.fillRect(
        (box.x / 100) * canvas.width,
        (box.y / 100) * canvas.height,
        (box.width / 100) * canvas.width,
        (box.height / 100) * canvas.height
      );
      ctx.drawImage(
        image,
        (box.x / 100) * canvas.width,
        (box.y / 100) * canvas.height,
        (box.width / 100) * canvas.width,
        (box.height / 100) * canvas.height
      );
    }

    if (enabled.serial) {
      const box = boxes.serial;
      const x = (box.x / 100) * canvas.width;
      const y = (box.y / 100) * canvas.height;
      const w = (box.width / 100) * canvas.width;
      const h = (box.height / 100) * canvas.height;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#111";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(12, Math.floor(h * 0.54))}px Arial, sans-serif`;
      ctx.fillText(serial, x + w / 2, y + h / 2, w * 0.95);
    }

    return canvas;
  }

  async function downloadPreview() {
    if (error || !template) return;
    const canvas = await renderSticker(firstSerial);
    downloadBlob(await canvasToBlob(canvas), `${firstSerial}.png`);
  }

  function serialRows() {
    return buildSerials(config).map((serial, index) => ({
      no: index + 1,
      product: productName,
      prefix: cleanPrefix(prefix),
      serial,
      qrValue: verificationBaseUrl.trim() ? `${verificationBaseUrl.replace(/\/$/, "")}/${serial}` : serial,
      widthMm,
      heightMm,
    }));
  }

  function downloadCsv() {
    if (error) return;
    const rows = serialRows();
    const header = ["No.", "Product", "Prefix", "Serial", "QR Value", "Width (mm)", "Height (mm)"];
    const csv = [header, ...rows.map((row) => [row.no, row.product, row.prefix, row.serial, row.qrValue, row.widthMm, row.heightMm])]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${slugify(productName)}-${firstSerial}-${lastSerial}.csv`);
  }

  async function downloadXlsx() {
    if (error) return;
    const XLSX = await import("xlsx");
    const rows = serialRows();
    const summary = [
      ["Batch Summary", ""],
      ["Product", productName],
      ["Prefix", cleanPrefix(prefix)],
      ["Start", firstSerial],
      ["End", lastSerial],
      ["Quantity", quantity],
      ["Serial Length", digits],
      ["Sticker Size", `${widthMm.toFixed(2)} × ${heightMm.toFixed(2)} mm`],
      ["Export Pixels", `${outputPixels.width} × ${outputPixels.height} px`],
      ["Export DPI", dpi],
      ["Ratio Locked", lockAspectRatio ? "Yes" : "No"],
      [],
    ];
    const table = [["No.", "Product", "Prefix", "Serial", "QR Value", "Width (mm)", "Height (mm)"], ...rows.map((row) => [row.no, row.product, row.prefix, row.serial, row.qrValue, row.widthMm, row.heightMm])];
    const worksheet = XLSX.utils.aoa_to_sheet([...summary, ...table]);
    worksheet["!cols"] = [{ wch: 8 }, { wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 48 }, { wch: 14 }, { wch: 14 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Serials");
    XLSX.writeFile(workbook, `${slugify(productName)}-${firstSerial}-${lastSerial}.xlsx`);
  }

  async function downloadZip() {
    if (error || !template || exporting) return;
    setExporting(true);
    setProgress(0);
    try {
      const [{ default: JSZip }, XLSX] = await Promise.all([import("jszip"), import("xlsx")]);
      const zip = new JSZip();
      const rows = serialRows();
      const folder = zip.folder(`${slugify(productName)}_${firstSerial}_${lastSerial}`)!;
      const stickers = folder.folder("stickers")!;

      for (let index = 0; index < rows.length; index++) {
        const canvas = await renderSticker(rows[index].serial);
        stickers.file(`${rows[index].serial}.png`, await canvasToBlob(canvas));
        setProgress(Math.round(((index + 1) / rows.length) * 92));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const table = [["No.", "Product", "Prefix", "Serial", "QR Value", "Width (mm)", "Height (mm)"], ...rows.map((row) => [row.no, row.product, row.prefix, row.serial, row.qrValue, row.widthMm, row.heightMm])];
      const worksheet = XLSX.utils.aoa_to_sheet(table);
      worksheet["!cols"] = [{ wch: 8 }, { wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 48 }, { wch: 14 }, { wch: 14 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Serials");
      const workbookBytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      folder.file("serials.xlsx", workbookBytes);
      folder.file("batch.json", JSON.stringify({
        productName,
        prefix: cleanPrefix(prefix),
        digits,
        start,
        quantity,
        end,
        widthMm,
        heightMm,
        outputPixels,
        dpi,
        sizeUnit,
        lockAspectRatio,
        lockedRatio,
        fitMode,
        verificationBaseUrl,
        enabled,
        boxes,
        originalArtwork: template ? {
          name: template.name,
          widthPx: template.naturalWidth,
          heightPx: template.naturalHeight,
        } : null,
      }, null, 2));
      setProgress(96);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      setProgress(100);
      downloadBlob(blob, `${slugify(productName)}_${firstSerial}_${lastSerial}.zip`);
    } finally {
      setTimeout(() => {
        setExporting(false);
        setProgress(0);
      }, 600);
    }
  }

  const stageStyle = template
    ? { aspectRatio: `${widthMm} / ${heightMm}`, width: "min(100%, 980px)", height: "auto" }
    : undefined;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">VI</div>
            <div>
              <h1>Barcode Sticker Generator</h1>
              <p>Upload artwork, place codes, generate a clean serialised batch.</p>
            </div>
          </div>
          <div className="badge">Frontend-first V1 · No database required</div>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel controls">
          <section className="section">
            <h3 className="section-title">1. Artwork</h3>
            <p className="section-note">The uploaded artwork now starts at its exact original pixel dimensions and aspect ratio. Resize it only when you want to.</p>
            <div className="field">
              <label>Template image</label>
              <input className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleFile(event.target.files?.[0])} />
            </div>

            {template && originalPhysicalSize ? (
              <div className="artwork-meta">
                <div className="artwork-meta-title">Original artwork</div>
                <div className="artwork-meta-main">{template.naturalWidth} × {template.naturalHeight} px</div>
                <div>{originalPhysicalSize.widthMm.toFixed(2)} × {originalPhysicalSize.heightMm.toFixed(2)} mm at {dpi} DPI</div>
                <div>{originalPhysicalSize.widthCm.toFixed(2)} × {originalPhysicalSize.heightCm.toFixed(2)} cm at {dpi} DPI</div>
                <div className="artwork-meta-file">{template.name}</div>
              </div>
            ) : null}

            <div className="size-toolbar">
              <div className="field unit-field">
                <label>Resize unit</label>
                <select value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value as SizeUnit)}>
                  <option value="px">Pixels (px)</option>
                  <option value="mm">Millimetres (mm)</option>
                  <option value="cm">Centimetres (cm)</option>
                </select>
              </div>
              <button type="button" className={`ratio-btn ${lockAspectRatio ? "locked" : "unlocked"}`} onClick={toggleRatioLock}>
                {lockAspectRatio ? "Ratio locked" : "Ratio unlocked"}
              </button>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>Width ({sizeUnit})</label>
                <input type="number" min={unitStep} step={unitStep} value={widthInput} onChange={(e) => updateDimension("width", Number(e.target.value))} />
              </div>
              <div className="field">
                <label>Height ({sizeUnit})</label>
                <input type="number" min={unitStep} step={unitStep} value={heightInput} onChange={(e) => updateDimension("height", Number(e.target.value))} />
              </div>
            </div>

            {template ? (
              <div className="resize-status">
                <span>Current output: {outputPixels.width} × {outputPixels.height} px</span>
                <button type="button" className="text-btn" onClick={resetToOriginal}>Reset to original size</button>
              </div>
            ) : null}

            <div className="grid-2" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Artwork fit</label>
                <select value={fitMode} onChange={(e) => setFitMode(e.target.value as FitMode)}>
                  <option value="stretch">Stretch to canvas</option>
                  <option value="contain">Contain without crop</option>
                  <option value="cover">Cover / crop edges</option>
                </select>
              </div>
              <div className="field">
                <label>Export quality</label>
                <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                  <option value={150}>150 DPI</option>
                  <option value={300}>300 DPI</option>
                </select>
              </div>
            </div>
            {aspectWarning ? <div className="warning">{aspectWarning}</div> : null}
          </section>

          <section className="section">
            <h3 className="section-title">2. Product & serial range</h3>
            <div className="field">
              <label>Product name</label>
              <input value={productName} onChange={(e) => setProductName(e.target.value)} />
              <div className="suggestion-row">
                {suggestions.map((item) => <button key={item} className="chip" type="button" onClick={() => setPrefix(item)}>{item}</button>)}
              </div>
            </div>
            <div className="field">
              <label>Prefix</label>
              <input value={prefix} onChange={(e) => setPrefix(cleanPrefix(e.target.value))} maxLength={12} />
            </div>
            <div className="grid-2">
              <div className="field">
                <label>Serial digits</label>
                <select value={digits} onChange={(e) => setDigits(Number(e.target.value))}>
                  {[3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value} digits</option>)}
                </select>
              </div>
              <div className="field">
                <label>Start number</label>
                <input type="number" min="0" value={start} onChange={(e) => setStart(Number(e.target.value))} />
              </div>
            </div>
            <div className="field">
              <label>Quantity</label>
              <input type="number" min="1" max="2000" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
            </div>
            <div className="range-card">
              <div className="range-label">Generated range</div>
              <div className="range-value">{error ? "Fix the serial configuration" : `${firstSerial} → ${lastSerial}`}</div>
              <div className="section-note" style={{ margin: "7px 0 0" }}>Maximum for {digits} digits: {maxSerial.toLocaleString()}</div>
            </div>
            {error ? <div className="error">{error}</div> : null}
          </section>

          <section className="section">
            <h3 className="section-title">3. Code content</h3>
            <label className="check-row"><input type="checkbox" checked={enabled.qr} onChange={(e) => setEnabled((v) => ({ ...v, qr: e.target.checked }))} />Generate QR code</label>
            <label className="check-row"><input type="checkbox" checked={enabled.barcode} onChange={(e) => setEnabled((v) => ({ ...v, barcode: e.target.checked }))} />Generate Code 128 barcode</label>
            <label className="check-row"><input type="checkbox" checked={enabled.serial} onChange={(e) => setEnabled((v) => ({ ...v, serial: e.target.checked }))} />Print serial text</label>
            <div className="field">
              <label>QR verification base URL (optional)</label>
              <input placeholder="https://example.com/verify" value={verificationBaseUrl} onChange={(e) => setVerificationBaseUrl(e.target.value)} />
            </div>
          </section>
        </aside>

        <section className="panel preview-panel">
          <div className="preview-head">
            <div>
              <h2>Live sticker composer</h2>
              <p>The preview follows the current canvas ratio. Upload starts at the artwork's exact original ratio.</p>
            </div>
            <div className="dimensions">
              {template ? `${template.naturalWidth} × ${template.naturalHeight}px original` : "No artwork loaded"}<br />
              {outputPixels.width} × {outputPixels.height}px output<br />
              {widthMm.toFixed(2)} × {heightMm.toFixed(2)} mm @ {dpi} DPI
            </div>
          </div>

          <div className="canvas-wrap">
            {!template ? (
              <div className="empty-stage"><div><strong>Upload a finished sticker artwork</strong>The preview will start with the image's exact original pixel ratio and dimensions.</div></div>
            ) : (
              <div ref={stageRef} className="preview-stage" style={stageStyle}>
                <img
                  className="preview-art"
                  src={template.url}
                  alt="Sticker artwork"
                  style={{ objectFit: fitMode === "stretch" ? "fill" : fitMode }}
                />
                {renderOverlay("qr")}
                {renderOverlay("barcode")}
                {renderOverlay("serial")}
              </div>
            )}
          </div>

          <div className="overlay-tools">
            {(["qr", "barcode", "serial"] as OverlayKey[]).map((key) => (
              <button type="button" key={key} className="overlay-tool" onClick={() => setSelected(key)}>
                <strong>{key.toUpperCase()}</strong>
                X {boxes[key].x.toFixed(1)}% · Y {boxes[key].y.toFixed(1)}% · W {boxes[key].width.toFixed(1)}% · H {boxes[key].height.toFixed(1)}%
              </button>
            ))}
          </div>

          <div className="actions">
            <button className="btn" disabled={!!error} onClick={downloadCsv}>Download CSV</button>
            <button className="btn" disabled={!!error} onClick={downloadXlsx}>Download Excel</button>
            <button className="btn btn-primary" disabled={!!error || !template} onClick={downloadPreview}>Download current sticker</button>
            <button className="btn btn-yellow" disabled={!!error || !template || exporting} onClick={downloadZip}>{exporting ? "Generating…" : `Generate ${quantity} stickers ZIP`}</button>
          </div>
          {exporting ? <><div className="progress"><div style={{ width: `${progress}%` }} /></div><div className="progress-text">Rendering serialised stickers locally in your browser: {progress}%</div></> : null}
        </section>
      </main>
      <div className="footnote">Upload starts at the artwork's exact pixel dimensions. Lock the ratio for proportional resizing; unlock it for independent width/height stretching.</div>
    </div>
  );
}
