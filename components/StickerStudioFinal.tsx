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
type ZoomMode = "fit" | "custom";

type TemplateImage = {
  url: string;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
};

type ComposerState = {
  template: TemplateImage | null;
  widthMm: number;
  heightMm: number;
  sizeUnit: SizeUnit;
  lockAspectRatio: boolean;
  lockedRatio: number;
  fitMode: FitMode;
  boxes: Record<OverlayKey, Box>;
  selected: OverlayKey;
  zoomMode: ZoomMode;
  zoomPercent: number;
  showGrid: boolean;
};

const DEFAULT_BOXES: Record<OverlayKey, Box> = {
  qr: { x: 11, y: 40, width: 23, height: 23 },
  barcode: { x: 57, y: 46, width: 28, height: 10 },
  serial: { x: 58, y: 74, width: 26, height: 3.2 },
};

function createComposerState(widthMm = 190, heightMm = 96): ComposerState {
  return {
    template: null,
    widthMm,
    heightMm,
    sizeUnit: "px",
    lockAspectRatio: true,
    lockedRatio: widthMm / heightMm,
    fitMode: "stretch",
    boxes: structuredClone(DEFAULT_BOXES),
    selected: "barcode",
    zoomMode: "fit",
    zoomPercent: 100,
    showGrid: false,
  };
}

function cloneBoxes() {
  return structuredClone(DEFAULT_BOXES);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render PNG."))), "image/png");
  });
}

function drawImageFit(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, mode: FitMode) {
  ctx.fillStyle = "#fff";
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

function outputPixelsFor(composer: ComposerState, dpi: number) {
  return {
    width: Math.max(1, Math.round((composer.widthMm / 25.4) * dpi)),
    height: Math.max(1, Math.round((composer.heightMm / 25.4) * dpi)),
  };
}

type TextMetricsBox = { width: number; height: number; ascent: number; descent: number; ratio: number };

function measureSerial(text: string, fontSize = 100): TextMetricsBox {
  if (typeof document === "undefined") {
    return { width: 580, height: 100, ascent: 78, descent: 22, ratio: 5.8 };
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { width: 580, height: 100, ascent: 78, descent: 22, ratio: 5.8 };
  ctx.font = `800 ${fontSize}px Arial, sans-serif`;
  const metrics = ctx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.78;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.22;
  const height = Math.max(1, ascent + descent);
  return { width: metrics.width, height, ascent, descent, ratio: Math.max(1, metrics.width / height) };
}

function fittedSerialFontSize(text: string, width: number, height: number) {
  if (width <= 0 || height <= 0) return 8;
  const base = measureSerial(text, 100);
  const scale = Math.min(width / base.width, height / base.height);
  return Math.max(7, 100 * scale * 0.995);
}

function serialHeightPercentForWidth(text: string, widthPercent: number, outputWidth: number, outputHeight: number) {
  const ratio = measureSerial(text, 100).ratio;
  const widthPx = (widthPercent / 100) * outputWidth;
  const heightPx = widthPx / ratio;
  return (heightPx / outputHeight) * 100;
}

function ArtworkControls({ label, composer, dpi, onChange }: {
  label: string;
  composer: ComposerState;
  dpi: number;
  onChange: (next: ComposerState) => void;
}) {
  const outputPixels = outputPixelsFor(composer, dpi);
  const widthInput = displaySizeValue(composer.widthMm, composer.sizeUnit, dpi);
  const heightInput = displaySizeValue(composer.heightMm, composer.sizeUnit, dpi);
  const unitStep = composer.sizeUnit === "px" ? 1 : composer.sizeUnit === "cm" ? 0.01 : 0.1;

  const originalPhysicalSize = useMemo(() => {
    if (!composer.template) return null;
    const widthMm = (composer.template.naturalWidth / dpi) * 25.4;
    const heightMm = (composer.template.naturalHeight / dpi) * 25.4;
    return { widthMm, heightMm, widthCm: widthMm / 10, heightCm: heightMm / 10 };
  }, [composer.template, dpi]);

  function handleFile(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (composer.template) URL.revokeObjectURL(composer.template.url);
      const ratio = image.naturalWidth / image.naturalHeight;
      onChange({
        ...composer,
        template: { url, name: file.name, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
        widthMm: (image.naturalWidth / dpi) * 25.4,
        heightMm: (image.naturalHeight / dpi) * 25.4,
        sizeUnit: "px",
        lockedRatio: ratio,
        lockAspectRatio: true,
        fitMode: "stretch",
        boxes: cloneBoxes(),
        zoomMode: "fit",
        showGrid: false,
      });
    };
    image.src = url;
  }

  function resetToOriginal() {
    if (!composer.template) return;
    const ratio = composer.template.naturalWidth / composer.template.naturalHeight;
    onChange({
      ...composer,
      widthMm: (composer.template.naturalWidth / dpi) * 25.4,
      heightMm: (composer.template.naturalHeight / dpi) * 25.4,
      lockedRatio: ratio,
      lockAspectRatio: true,
      fitMode: "stretch",
      zoomMode: "fit",
    });
  }

  function toggleRatio() {
    if (composer.lockAspectRatio) {
      onChange({ ...composer, lockAspectRatio: false });
    } else {
      onChange({ ...composer, lockAspectRatio: true, lockedRatio: composer.widthMm / composer.heightMm });
    }
  }

  function updateDimension(axis: "width" | "height", raw: number) {
    if (!Number.isFinite(raw) || raw <= 0) return;
    const mm = unitToMm(raw, composer.sizeUnit, dpi);
    if (axis === "width") {
      onChange({
        ...composer,
        widthMm: mm,
        heightMm: composer.lockAspectRatio ? mm / composer.lockedRatio : composer.heightMm,
      });
    } else {
      onChange({
        ...composer,
        heightMm: mm,
        widthMm: composer.lockAspectRatio ? mm * composer.lockedRatio : composer.widthMm,
      });
    }
  }

  return (
    <div className="artwork-control-group">
      <div className="artwork-control-heading">{label}</div>
      <div className="field">
        <label>Template image</label>
        <input className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>

      {composer.template && originalPhysicalSize ? (
        <div className="artwork-meta">
          <div className="artwork-meta-title">Original artwork</div>
          <div className="artwork-meta-main">{composer.template.naturalWidth} × {composer.template.naturalHeight} px</div>
          <div>{originalPhysicalSize.widthMm.toFixed(2)} × {originalPhysicalSize.heightMm.toFixed(2)} mm at {dpi} DPI</div>
          <div>{originalPhysicalSize.widthCm.toFixed(2)} × {originalPhysicalSize.heightCm.toFixed(2)} cm at {dpi} DPI</div>
          <div className="artwork-meta-file">{composer.template.name}</div>
        </div>
      ) : null}

      <div className="size-toolbar">
        <div className="field unit-field">
          <label>Resize unit</label>
          <select value={composer.sizeUnit} onChange={(e) => onChange({ ...composer, sizeUnit: e.target.value as SizeUnit })}>
            <option value="px">Pixels (px)</option>
            <option value="mm">Millimetres (mm)</option>
            <option value="cm">Centimetres (cm)</option>
          </select>
        </div>
        <button type="button" className={`ratio-btn ${composer.lockAspectRatio ? "locked" : "unlocked"}`} onClick={toggleRatio}>
          {composer.lockAspectRatio ? "Ratio locked" : "Ratio unlocked"}
        </button>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>Width ({composer.sizeUnit})</label>
          <input type="number" min={unitStep} step={unitStep} value={widthInput} onChange={(e) => updateDimension("width", Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Height ({composer.sizeUnit})</label>
          <input type="number" min={unitStep} step={unitStep} value={heightInput} onChange={(e) => updateDimension("height", Number(e.target.value))} />
        </div>
      </div>

      {composer.template ? (
        <div className="resize-status">
          <span>Current output: {outputPixels.width} × {outputPixels.height} px</span>
          <button type="button" className="text-btn" onClick={resetToOriginal}>Reset to original size</button>
        </div>
      ) : null}

      <div className="field" style={{ marginTop: 12 }}>
        <label>Artwork fit</label>
        <select value={composer.fitMode} onChange={(e) => onChange({ ...composer, fitMode: e.target.value as FitMode })}>
          <option value="stretch">Stretch to canvas</option>
          <option value="contain">Contain without crop</option>
          <option value="cover">Cover / crop edges</option>
        </select>
      </div>
    </div>
  );
}

function ComposerView({ title, composer, dpi, enabled, firstSerial, qrPreview, barcodePreview, onChange }: {
  title: string;
  composer: ComposerState;
  dpi: number;
  enabled: Record<OverlayKey, boolean>;
  firstSerial: string;
  qrPreview: string;
  barcodePreview: string;
  onChange: (next: ComposerState) => void;
}) {
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 900, height: 650 });
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const outputPixels = useMemo(() => outputPixelsFor(composer, dpi), [composer.widthMm, composer.heightMm, dpi]);

  const fitScale = useMemo(() => {
    if (!composer.template) return 1;
    return Math.min(
      Math.max(0.05, (viewportSize.width - 44) / outputPixels.width),
      Math.max(0.05, (viewportSize.height - 44) / outputPixels.height),
      1
    );
  }, [composer.template, outputPixels.width, outputPixels.height, viewportSize]);

  const displayScale = composer.zoomMode === "fit" ? fitScale : composer.zoomPercent / 100;
  const renderedStage = {
    width: Math.max(1, Math.round(outputPixels.width * displayScale)),
    height: Math.max(1, Math.round(outputPixels.height * displayScale)),
  };
  const effectiveZoom = Math.max(1, Math.round(displayScale * 100));

  useEffect(() => {
    if (!viewportRef.current) return;
    const element = viewportRef.current;
    const update = () => setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [composer.template]);

  useEffect(() => {
    if (!stageRef.current) return;
    const element = stageRef.current;
    const update = () => setPreviewSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [composer.template, renderedStage.width, renderedStage.height]);

  useEffect(() => {
    if (!composer.template) return;
    const next = structuredClone(composer.boxes);
    let changed = false;

    const qrWidthPx = (next.qr.width / 100) * outputPixels.width;
    const qrHeightPct = (qrWidthPx / outputPixels.height) * 100;
    if (Math.abs(next.qr.height - qrHeightPct) > 0.1) {
      next.qr.height = clamp(qrHeightPct, 0.5, 100 - next.qr.y);
      changed = true;
    }

    const serialHeight = serialHeightPercentForWidth(firstSerial, next.serial.width, outputPixels.width, outputPixels.height);
    if (Math.abs(next.serial.height - serialHeight) > 0.1) {
      next.serial.height = clamp(serialHeight, 0.3, 100 - next.serial.y);
      changed = true;
    }

    if (changed) onChange({ ...composer, boxes: next });
  }, [composer.template, outputPixels.width, outputPixels.height, firstSerial]);

  function setZoom(value: number) {
    onChange({ ...composer, zoomPercent: clamp(Math.round(value), 10, 400), zoomMode: "custom" });
  }

  function updateBox(key: OverlayKey, box: Box) {
    const next = {
      x: clamp(box.x, 0, Math.max(0, 100 - box.width)),
      y: clamp(box.y, 0, Math.max(0, 100 - box.height)),
      width: clamp(box.width, 0.3, 100),
      height: clamp(box.height, 0.3, 100),
    };
    onChange({ ...composer, boxes: { ...composer.boxes, [key]: next } });
  }

  function renderOverlay(key: OverlayKey) {
    if (!enabled[key] || !previewSize.width || !previewSize.height) return null;
    const box = composer.boxes[key];
    const px = {
      x: (box.x / 100) * previewSize.width,
      y: (box.y / 100) * previewSize.height,
      width: (box.width / 100) * previewSize.width,
      height: (box.height / 100) * previewSize.height,
    };
    const serialRatio = measureSerial(firstSerial, 100).ratio;
    const lockAspectRatio = key === "qr" ? 1 : key === "serial" ? serialRatio : false;
    const serialFontSize = fittedSerialFontSize(firstSerial, px.width, px.height);

    return (
      <Rnd
        key={key}
        bounds="parent"
        size={{ width: px.width, height: px.height }}
        position={{ x: px.x, y: px.y }}
        minWidth={10}
        minHeight={5}
        lockAspectRatio={lockAspectRatio}
        onMouseDown={() => onChange({ ...composer, selected: key })}
        onDragStart={() => onChange({ ...composer, selected: key })}
        onResizeStart={() => onChange({ ...composer, selected: key })}
        onDragStop={(_, data) => updateBox(key, {
          ...box,
          x: (data.x / previewSize.width) * 100,
          y: (data.y / previewSize.height) * 100,
        })}
        onResizeStop={(_, __, ref, ___, position) => updateBox(key, {
          x: (position.x / previewSize.width) * 100,
          y: (position.y / previewSize.height) * 100,
          width: (ref.offsetWidth / previewSize.width) * 100,
          height: (ref.offsetHeight / previewSize.height) * 100,
        })}
        className={`overlay overlay-${key} ${composer.selected === key ? "selected" : ""}`}
      >
        <span className="overlay-label">{key.toUpperCase()}</span>
        {key === "qr" && qrPreview ? <img src={qrPreview} alt="QR preview" /> : null}
        {key === "barcode" && barcodePreview ? <img src={barcodePreview} alt="Barcode preview" /> : null}
        {key === "serial" ? <span className="serial-text" style={{ fontSize: `${serialFontSize}px`, lineHeight: 1 }}>{firstSerial}</span> : null}
      </Rnd>
    );
  }

  function actualBox(box: Box) {
    return {
      x: (box.x / 100) * outputPixels.width,
      y: (box.y / 100) * outputPixels.height,
      width: (box.width / 100) * outputPixels.width,
      height: (box.height / 100) * outputPixels.height,
    };
  }

  function mmBox(box: Box) {
    return {
      x: (box.x / 100) * composer.widthMm,
      y: (box.y / 100) * composer.heightMm,
      width: (box.width / 100) * composer.widthMm,
      height: (box.height / 100) * composer.heightMm,
    };
  }

  return (
    <>
      <div className="preview-head">
        <div>
          <h2>{title}</h2>
          <p>QR, barcode and serial positions belong only to this template.</p>
        </div>
        <div className="dimensions">
          {composer.template ? `${composer.template.naturalWidth} × ${composer.template.naturalHeight}px original` : "No artwork loaded"}<br />
          {outputPixels.width} × {outputPixels.height}px output<br />
          {composer.widthMm.toFixed(2)} × {composer.heightMm.toFixed(2)} mm @ {dpi} DPI
        </div>
      </div>

      <div className="preview-toolbar">
        <div className="zoom-controls">
          <button type="button" className={`tool-btn ${composer.zoomMode === "fit" ? "active" : ""}`} disabled={!composer.template} onClick={() => onChange({ ...composer, zoomMode: "fit" })}>Fit</button>
          <button type="button" className="tool-btn" disabled={!composer.template} onClick={() => setZoom(100)}>100%</button>
          <button type="button" className="tool-btn icon-btn" disabled={!composer.template} onClick={() => setZoom((composer.zoomMode === "fit" ? effectiveZoom : composer.zoomPercent) - 25)}>−</button>
          <div className="zoom-readout">{effectiveZoom}%</div>
          <button type="button" className="tool-btn icon-btn" disabled={!composer.template} onClick={() => setZoom((composer.zoomMode === "fit" ? effectiveZoom : composer.zoomPercent) + 25)}>+</button>
          <select className="zoom-select" value={composer.zoomMode === "fit" ? "fit" : String(composer.zoomPercent)} disabled={!composer.template} onChange={(e) => e.target.value === "fit" ? onChange({ ...composer, zoomMode: "fit" }) : setZoom(Number(e.target.value))}>
            <option value="fit">Fit to workspace</option>
            {[25, 50, 75, 100, 125, 150, 200, 300, 400].map((value) => <option key={value} value={value}>{value}%</option>)}
          </select>
        </div>
        <div className="view-controls">
          <button type="button" className={`tool-btn ${composer.showGrid ? "active" : ""}`} disabled={!composer.template} onClick={() => onChange({ ...composer, showGrid: !composer.showGrid })}>Grid</button>
          <div className="rendered-size">View {renderedStage.width} × {renderedStage.height}px</div>
        </div>
      </div>

      <div ref={viewportRef} className="canvas-viewport">
        {!composer.template ? (
          <div className="empty-stage"><div><strong>Upload {title.toLowerCase()} artwork</strong>This template has its own size and independent QR / barcode / serial positions.</div></div>
        ) : (
          <div className="canvas-surface" style={{ minWidth: `${Math.max(renderedStage.width + 44, viewportSize.width)}px`, minHeight: `${Math.max(renderedStage.height + 44, viewportSize.height)}px` }}>
            <div ref={stageRef} className={`preview-stage ${composer.showGrid ? "show-grid" : ""}`} style={{ width: `${renderedStage.width}px`, height: `${renderedStage.height}px` }}>
              <img className="preview-art" src={composer.template.url} alt={`${title} artwork`} style={{ objectFit: composer.fitMode === "stretch" ? "fill" : composer.fitMode }} />
              {renderOverlay("qr")}
              {renderOverlay("barcode")}
              {renderOverlay("serial")}
            </div>
          </div>
        )}
      </div>

      <div className="preview-statusbar">
        <span>Actual canvas: {outputPixels.width} × {outputPixels.height}px</span>
        <span>Zoom: {effectiveZoom}%</span>
        <span>Preview: {renderedStage.width} × {renderedStage.height}px</span>
      </div>

      <div className="overlay-tools">
        {(["qr", "barcode", "serial"] as OverlayKey[]).map((key) => {
          const actual = actualBox(composer.boxes[key]);
          const mm = mmBox(composer.boxes[key]);
          return (
            <button type="button" key={key} className={`overlay-tool ${composer.selected === key ? "active" : ""}`} onClick={() => onChange({ ...composer, selected: key })}>
              <strong>{key.toUpperCase()}</strong>
              <span>{Math.round(actual.x)}, {Math.round(actual.y)} px · {Math.round(actual.width)} × {Math.round(actual.height)} px</span>
              <span>{mm.x.toFixed(1)}, {mm.y.toFixed(1)} mm · {mm.width.toFixed(1)} × {mm.height.toFixed(1)} mm</span>
              <small>X {composer.boxes[key].x.toFixed(1)}% · Y {composer.boxes[key].y.toFixed(1)}%</small>
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function StickerStudioFinal() {
  const [productName, setProductName] = useState("Vivid Pro Shield Color");
  const [prefix, setPrefix] = useState("VVPSC");
  const [digits, setDigits] = useState(5);
  const [start, setStart] = useState(33);
  const [quantity, setQuantity] = useState(100);
  const [dpi, setDpi] = useState(300);
  const [verificationBaseUrl, setVerificationBaseUrl] = useState("");
  const [enabled, setEnabled] = useState<Record<OverlayKey, boolean>>({ qr: true, barcode: true, serial: true });
  const [primary, setPrimary] = useState<ComposerState>(() => createComposerState(190, 96));
  const [secondary, setSecondary] = useState<ComposerState>(() => createComposerState(85, 55));
  const [secondEnabled, setSecondEnabled] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<1 | 2>(1);
  const [qrPreview, setQrPreview] = useState("");
  const [barcodePreview, setBarcodePreview] = useState("");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const suggestions = useMemo(() => suggestPrefixes(productName), [productName]);
  const config = useMemo(() => ({ prefix, digits, start, quantity }), [prefix, digits, start, quantity]);
  const error = useMemo(() => validateSerialConfig(config), [config]);
  const firstSerial = error ? "INVALID" : formatSerial(prefix, start, digits);
  const end = error ? null : serialEnd(start, quantity);
  const lastSerial = end === null ? "—" : formatSerial(prefix, end, digits);
  const maxSerial = maxSerialForDigits(digits);
  const qrValue = verificationBaseUrl.trim() ? `${verificationBaseUrl.replace(/\/$/, "")}/${firstSerial}` : firstSerial;
  const activeComposer = activeTemplate === 2 ? secondary : primary;
  const activeSetter = activeTemplate === 2 ? setSecondary : setPrimary;
  const secondMissing = secondEnabled && !secondary.template;
  const batchReady = !error && !!primary.template && !secondMissing;
  const templateCount = secondEnabled ? 2 : 1;
  const totalStickerFiles = quantity * templateCount;

  useEffect(() => {
    if (error) {
      setQrPreview("");
      setBarcodePreview("");
      return;
    }
    let cancelled = false;
    (async () => {
      const qr = await QRCode.toDataURL(qrValue, { margin: 0, width: 512, errorCorrectionLevel: "M" });
      const canvas = document.createElement("canvas");
      bwipjs.toCanvas(canvas, { bcid: "code128", text: firstSerial, scale: 3, height: 12, includetext: false, backgroundcolor: "FFFFFF" });
      if (!cancelled) {
        setQrPreview(qr);
        setBarcodePreview(canvas.toDataURL("image/png"));
      }
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [error, firstSerial, qrValue]);

  async function generateCodeImages(serial: string) {
    const qrData = verificationBaseUrl.trim() ? `${verificationBaseUrl.replace(/\/$/, "")}/${serial}` : serial;
    const qr = enabled.qr ? await QRCode.toDataURL(qrData, { margin: 0, width: 900, errorCorrectionLevel: "M" }) : "";
    let barcode = "";
    if (enabled.barcode) {
      const canvas = document.createElement("canvas");
      bwipjs.toCanvas(canvas, { bcid: "code128", text: serial, scale: 5, height: 14, includetext: false, backgroundcolor: "FFFFFF" });
      barcode = canvas.toDataURL("image/png");
    }
    return { qr, barcode };
  }

  async function renderSticker(serial: string, composer: ComposerState) {
    if (!composer.template) throw new Error("Template artwork is missing.");
    const output = outputPixelsFor(composer, dpi);
    const canvas = document.createElement("canvas");
    canvas.width = output.width;
    canvas.height = output.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable.");

    const artwork = await loadImage(composer.template.url);
    drawImageFit(ctx, artwork, canvas.width, canvas.height, composer.fitMode);
    const codes = await generateCodeImages(serial);

    if (enabled.qr && codes.qr) {
      const image = await loadImage(codes.qr);
      const box = composer.boxes.qr;
      ctx.drawImage(image, (box.x / 100) * canvas.width, (box.y / 100) * canvas.height, (box.width / 100) * canvas.width, (box.height / 100) * canvas.height);
    }

    if (enabled.barcode && codes.barcode) {
      const image = await loadImage(codes.barcode);
      const box = composer.boxes.barcode;
      ctx.drawImage(image, (box.x / 100) * canvas.width, (box.y / 100) * canvas.height, (box.width / 100) * canvas.width, (box.height / 100) * canvas.height);
    }

    if (enabled.serial) {
      const box = composer.boxes.serial;
      const x = (box.x / 100) * canvas.width;
      const y = (box.y / 100) * canvas.height;
      const w = (box.width / 100) * canvas.width;
      const h = (box.height / 100) * canvas.height;
      const fontSize = fittedSerialFontSize(serial, w, h);
      ctx.font = `800 ${fontSize}px Arial, sans-serif`;
      const metrics = ctx.measureText(serial);
      const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.78;
      const descent = metrics.actualBoundingBoxDescent || fontSize * 0.22;
      const actualHeight = ascent + descent;
      const baseline = y + (h - actualHeight) / 2 + ascent;
      ctx.fillStyle = "#111";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(serial, x + w / 2, baseline, w);
    }

    return canvas;
  }

  function serialRows() {
    return buildSerials(config).map((serial, index) => ({
      no: index + 1,
      product: productName,
      prefix: cleanPrefix(prefix),
      serial,
      qrValue: verificationBaseUrl.trim() ? `${verificationBaseUrl.replace(/\/$/, "")}/${serial}` : serial,
      template1File: `template-1/${serial}.png`,
      template2File: secondEnabled ? `template-2/${serial}.png` : "",
    }));
  }

  function buildWorkbook(XLSX: typeof import("xlsx"), rows: ReturnType<typeof serialRows>) {
    const primaryPx = outputPixelsFor(primary, dpi);
    const secondaryPx = outputPixelsFor(secondary, dpi);
    const summary = [
      ["Batch Summary", ""],
      ["Product", productName],
      ["Prefix", cleanPrefix(prefix)],
      ["First Serial", firstSerial],
      ["Last Serial", lastSerial],
      ["Quantity / serials", quantity],
      ["Template count", templateCount],
      ["Total sticker files", totalStickerFiles],
      ["Serial digits", digits],
      ["Export DPI", dpi],
      ["Template 1", primary.template ? `${primary.widthMm.toFixed(2)} × ${primary.heightMm.toFixed(2)} mm | ${primaryPx.width} × ${primaryPx.height}px` : "Not uploaded"],
      ["Template 2", secondEnabled ? (secondary.template ? `${secondary.widthMm.toFixed(2)} × ${secondary.heightMm.toFixed(2)} mm | ${secondaryPx.width} × ${secondaryPx.height}px` : "Enabled, not uploaded") : "Disabled"],
      ["QR Mode", verificationBaseUrl.trim() ? `URL: ${verificationBaseUrl.trim()}` : "Serial value"],
      ["Generated", new Date().toISOString()],
    ];
    const serialData = rows.map((row) => ({
      "No.": row.no,
      Product: row.product,
      Prefix: row.prefix,
      Serial: row.serial,
      "QR Value": row.qrValue,
      "Template 1 File": row.template1File,
      "Template 2 File": row.template2File,
    }));
    const wb = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet(summary);
    summarySheet["!cols"] = [{ wch: 22 }, { wch: 65 }];
    const serialSheet = XLSX.utils.json_to_sheet(serialData);
    serialSheet["!cols"] = [{ wch: 8 }, { wch: 30 }, { wch: 14 }, { wch: 22 }, { wch: 55 }, { wch: 34 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, "Batch Summary");
    XLSX.utils.book_append_sheet(wb, serialSheet, "Serials");
    return wb;
  }

  async function downloadPreview() {
    if (error || !activeComposer.template) return;
    const canvas = await renderSticker(firstSerial, activeComposer);
    downloadBlob(await canvasToBlob(canvas), `${firstSerial}-template-${activeTemplate}.png`);
  }

  function downloadCsv() {
    if (error) return;
    const rows = serialRows();
    const header = ["No.", "Product", "Prefix", "Serial", "QR Value", "Template 1 File", "Template 2 File"];
    const csvRows = rows.map((row) => [row.no, row.product, row.prefix, row.serial, row.qrValue, row.template1File, row.template2File]);
    const csv = [header, ...csvRows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${slugify(productName)}-${firstSerial}-${lastSerial}.csv`);
  }

  async function downloadXlsx() {
    if (error) return;
    const XLSX = await import("xlsx");
    const wb = buildWorkbook(XLSX, serialRows());
    XLSX.writeFile(wb, `${slugify(productName)}-${firstSerial}-${lastSerial}.xlsx`);
  }

  async function downloadZip() {
    if (!batchReady || exporting) return;
    setExporting(true);
    setProgress(0);
    try {
      const [{ default: JSZip }, XLSX] = await Promise.all([import("jszip"), import("xlsx")]);
      const rows = serialRows();
      const zip = new JSZip();
      const root = zip.folder(`${slugify(productName)}_${firstSerial}_${lastSerial}`)!;
      const template1Folder = root.folder("template-1")!;
      const template2Folder = secondEnabled ? root.folder("template-2")! : null;
      let rendered = 0;
      const total = rows.length * templateCount;

      for (const row of rows) {
        const primaryCanvas = await renderSticker(row.serial, primary);
        template1Folder.file(`${row.serial}.png`, await canvasToBlob(primaryCanvas));
        rendered += 1;
        setProgress(Math.round((rendered / total) * 94));
        await new Promise((resolve) => setTimeout(resolve, 0));

        if (secondEnabled && template2Folder) {
          const secondaryCanvas = await renderSticker(row.serial, secondary);
          template2Folder.file(`${row.serial}.png`, await canvasToBlob(secondaryCanvas));
          rendered += 1;
          setProgress(Math.round((rendered / total) * 94));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const workbook = buildWorkbook(XLSX, rows);
      root.file("serials.xlsx", XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

      const batch = {
        version: "1.0-phase-c",
        generatedAt: new Date().toISOString(),
        productName,
        prefix: cleanPrefix(prefix),
        digits,
        start,
        end,
        quantity,
        serialRange: { first: firstSerial, last: lastSerial },
        templateCount,
        totalStickerFiles,
        dpi,
        qr: {
          enabled: enabled.qr,
          verificationBaseUrl: verificationBaseUrl.trim() || null,
          payloadMode: verificationBaseUrl.trim() ? "verification-url" : "serial",
        },
        barcode: { enabled: enabled.barcode, type: "Code 128" },
        serialText: { enabled: enabled.serial },
        templates: [
          {
            id: 1,
            widthMm: primary.widthMm,
            heightMm: primary.heightMm,
            outputPixels: outputPixelsFor(primary, dpi),
            fitMode: primary.fitMode,
            boxes: primary.boxes,
            artwork: primary.template ? { name: primary.template.name, widthPx: primary.template.naturalWidth, heightPx: primary.template.naturalHeight } : null,
          },
          ...(secondEnabled ? [{
            id: 2,
            widthMm: secondary.widthMm,
            heightMm: secondary.heightMm,
            outputPixels: outputPixelsFor(secondary, dpi),
            fitMode: secondary.fitMode,
            boxes: secondary.boxes,
            artwork: secondary.template ? { name: secondary.template.name, widthPx: secondary.template.naturalWidth, heightPx: secondary.template.naturalHeight } : null,
          }] : []),
        ],
      };
      root.file("batch.json", JSON.stringify(batch, null, 2));
      root.file("README.txt", [
        "Barcode Sticker Generator — Batch Export",
        `Product: ${productName}`,
        `Serials: ${firstSerial} -> ${lastSerial}`,
        `Serial count: ${quantity}`,
        `Templates: ${templateCount}`,
        `Sticker PNG files: ${totalStickerFiles}`,
        "",
        "template-1/ and template-2/ use the exact same serial sequence.",
        "Each template keeps its own artwork size and independent QR / barcode / serial placement.",
        "serials.xlsx contains the batch summary and serial/file mapping.",
      ].join("\n"));

      setProgress(97);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      setProgress(100);
      downloadBlob(blob, `${slugify(productName)}_${firstSerial}_${lastSerial}.zip`);
    } finally {
      window.setTimeout(() => {
        setExporting(false);
        setProgress(0);
      }, 700);
    }
  }

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
          <div className="badge">V1 Complete · Frontend-only</div>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel controls">
          <section className="section">
            <h3 className="section-title">1. Artwork</h3>
            <p className="section-note">Each template keeps its own dimensions and independent QR / barcode / serial positions.</p>
            <ArtworkControls label="Template 1" composer={primary} dpi={dpi} onChange={setPrimary} />

            <div className="second-template-toggle">
              <label className="check-row">
                <input type="checkbox" checked={secondEnabled} onChange={(e) => {
                  setSecondEnabled(e.target.checked);
                  if (e.target.checked) setActiveTemplate(2);
                  else setActiveTemplate(1);
                }} />
                Generate a second sticker template with the same serials
              </label>
            </div>

            {secondEnabled ? <div className="second-template-controls"><ArtworkControls label="Template 2" composer={secondary} dpi={dpi} onChange={setSecondary} /></div> : null}

            <div className="field" style={{ marginTop: 12 }}>
              <label>Export quality</label>
              <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                <option value={150}>150 DPI</option>
                <option value={300}>300 DPI</option>
              </select>
            </div>
            {secondMissing ? <div className="warning">Template 2 is enabled. Upload its artwork before generating the complete ZIP.</div> : null}
          </section>

          <section className="section">
            <h3 className="section-title">2. Product & serial range</h3>
            <div className="field">
              <label>Product name</label>
              <input value={productName} onChange={(e) => setProductName(e.target.value)} />
              <div className="suggestion-row">{suggestions.map((item) => <button key={item} className="chip" type="button" onClick={() => setPrefix(item)}>{item}</button>)}</div>
            </div>
            <div className="field"><label>Prefix</label><input value={prefix} maxLength={12} onChange={(e) => setPrefix(cleanPrefix(e.target.value))} /></div>
            <div className="grid-2">
              <div className="field"><label>Serial digits</label><select value={digits} onChange={(e) => setDigits(Number(e.target.value))}>{[3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value} digits</option>)}</select></div>
              <div className="field"><label>Start number</label><input type="number" min="0" value={start} onChange={(e) => setStart(Number(e.target.value))} /></div>
            </div>
            <div className="field"><label>Quantity</label><input type="number" min="1" max="2000" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></div>
            <div className="range-card">
              <div className="range-label">Generated range</div>
              <div className="range-value">{error ? "Fix the serial configuration" : `${firstSerial} → ${lastSerial}`}</div>
              <div className="section-note" style={{ margin: "7px 0 0" }}>Maximum for {digits} digits: {maxSerial.toLocaleString()}</div>
            </div>
            {error ? <div className="error">{error}</div> : null}
          </section>

          <section className="section">
            <h3 className="section-title">3. Code content</h3>
            <label className="check-row"><input type="checkbox" checked={enabled.qr} onChange={(e) => setEnabled((value) => ({ ...value, qr: e.target.checked }))} />Generate QR code</label>
            <label className="check-row"><input type="checkbox" checked={enabled.barcode} onChange={(e) => setEnabled((value) => ({ ...value, barcode: e.target.checked }))} />Generate Code 128 barcode</label>
            <label className="check-row"><input type="checkbox" checked={enabled.serial} onChange={(e) => setEnabled((value) => ({ ...value, serial: e.target.checked }))} />Print serial text</label>
            <div className="field"><label>QR verification base URL (optional)</label><input placeholder="https://example.com/verify" value={verificationBaseUrl} onChange={(e) => setVerificationBaseUrl(e.target.value)} /></div>
          </section>
        </aside>

        <section className="panel preview-panel">
          {secondEnabled ? (
            <div className="template-tabs">
              <button type="button" className={`template-tab ${activeTemplate === 1 ? "active" : ""}`} onClick={() => setActiveTemplate(1)}>Template 1</button>
              <button type="button" className={`template-tab ${activeTemplate === 2 ? "active" : ""}`} onClick={() => setActiveTemplate(2)}>Template 2</button>
            </div>
          ) : null}

          <ComposerView title={`Template ${activeTemplate} composer`} composer={activeComposer} dpi={dpi} enabled={enabled} firstSerial={firstSerial} qrPreview={qrPreview} barcodePreview={barcodePreview} onChange={activeSetter} />

          <div className="actions">
            <button className="btn" disabled={!!error} onClick={downloadCsv}>Download CSV</button>
            <button className="btn" disabled={!!error} onClick={downloadXlsx}>Download Excel</button>
            <button className="btn btn-primary" disabled={!!error || !activeComposer.template} onClick={downloadPreview}>Download current sticker</button>
            <button className="btn btn-yellow" disabled={!batchReady || exporting} onClick={downloadZip}>
              {exporting ? "Generating complete batch…" : `Generate ZIP · ${quantity} serials · ${templateCount} template${templateCount > 1 ? "s" : ""} · ${totalStickerFiles} PNGs`}
            </button>
          </div>

          {exporting ? <><div className="progress"><div style={{ width: `${progress}%` }} /></div><div className="progress-text">Rendering and packing the final batch locally in your browser: {progress}%</div></> : null}
          {batchReady ? <div className="phase-note">Ready: the ZIP will contain the same serial sequence in {templateCount === 2 ? "both template folders" : "Template 1"}, plus serials.xlsx, batch.json and README.txt.</div> : null}
        </section>
      </main>

      <div className="footnote">V1 final: Template 1 and optional Template 2 share one serial sequence while preserving independent artwork dimensions and code placement. All generation runs locally in the browser.</div>
    </div>
  );
}
