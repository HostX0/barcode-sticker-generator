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
    boxes: JSON.parse(JSON.stringify(DEFAULT_BOXES)),
    selected: "barcode",
    zoomMode: "fit",
    zoomPercent: 100,
    showGrid: false,
  };
}

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function outputPixelsFor(composer: ComposerState, dpi: number) {
  return {
    width: Math.max(1, Math.round((composer.widthMm / 25.4) * dpi)),
    height: Math.max(1, Math.round((composer.heightMm / 25.4) * dpi)),
  };
}

function serialTextRatio(text: string) {
  if (typeof document === "undefined") return 5.8;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 5.8;
  ctx.font = "800 100px Arial, sans-serif";
  return Math.max(1, ctx.measureText(text).width / 100);
}

function fittedSerialFontSize(text: string, width: number, height: number) {
  if (width <= 0 || height <= 0) return 8;
  const ratio = serialTextRatio(text);
  const byHeight = height * 0.94;
  const byWidth = (width / ratio) * 0.96;
  return Math.max(7, Math.min(byHeight, byWidth));
}

function ArtworkControls({
  label,
  composer,
  dpi,
  onChange,
}: {
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
    const width = (composer.template.naturalWidth / dpi) * 25.4;
    const height = (composer.template.naturalHeight / dpi) * 25.4;
    return { widthMm: width, heightMm: height, widthCm: width / 10, heightCm: height / 10 };
  }, [composer.template, dpi]);

  const aspectWarning = useMemo(() => {
    if (!composer.template || !composer.widthMm || !composer.heightMm) return "";
    const sourceRatio = composer.template.naturalWidth / composer.template.naturalHeight;
    const targetRatio = composer.widthMm / composer.heightMm;
    const difference = Math.abs(sourceRatio - targetRatio) / sourceRatio;
    if (difference > 0.01 && composer.fitMode === "stretch") {
      return "Ratio differs from the original artwork. Stretch mode intentionally reshapes the design.";
    }
    return "";
  }, [composer]);

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
        lockedRatio: ratio,
        lockAspectRatio: true,
        sizeUnit: "px",
        fitMode: "stretch",
        zoomMode: "fit",
        showGrid: false,
        boxes: JSON.parse(JSON.stringify(DEFAULT_BOXES)),
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

  function toggleRatioLock() {
    if (!composer.lockAspectRatio) {
      onChange({ ...composer, lockAspectRatio: true, lockedRatio: composer.widthMm / composer.heightMm });
    } else {
      onChange({ ...composer, lockAspectRatio: false });
    }
  }

  function updateDimension(axis: "width" | "height", value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    const mm = unitToMm(value, composer.sizeUnit, dpi);
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
        <input className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleFile(event.target.files?.[0])} />
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
        <button type="button" className={`ratio-btn ${composer.lockAspectRatio ? "locked" : "unlocked"}`} onClick={toggleRatioLock}>
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
      {aspectWarning ? <div className="warning">{aspectWarning}</div> : null}
    </div>
  );
}

function ComposerView({
  title,
  composer,
  dpi,
  enabled,
  firstSerial,
  qrPreview,
  barcodePreview,
  onChange,
}: {
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
    if (!composer.template || !outputPixels.width || !outputPixels.height) return 1;
    const horizontal = Math.max(0.05, (viewportSize.width - 44) / outputPixels.width);
    const vertical = Math.max(0.05, (viewportSize.height - 44) / outputPixels.height);
    return Math.min(horizontal, vertical, 1);
  }, [composer.template, outputPixels, viewportSize]);

  const displayScale = composer.zoomMode === "fit" ? fitScale : composer.zoomPercent / 100;
  const renderedStage = useMemo(() => ({
    width: Math.max(1, Math.round(outputPixels.width * displayScale)),
    height: Math.max(1, Math.round(outputPixels.height * displayScale)),
  }), [outputPixels, displayScale]);
  const effectiveZoom = Math.max(1, Math.round(displayScale * 100));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [composer.template]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => setPreviewSize({ width: stage.clientWidth, height: stage.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [composer.template, renderedStage.width, renderedStage.height]);

  useEffect(() => {
    if (!composer.template || !outputPixels.width || !outputPixels.height) return;
    const nextBoxes = { ...composer.boxes };
    let changed = false;

    const qr = nextBoxes.qr;
    const qrWidthPx = (qr.width / 100) * outputPixels.width;
    const squareHeightPct = (qrWidthPx / outputPixels.height) * 100;
    if (Math.abs(qr.height - squareHeightPct) > 0.15) {
      nextBoxes.qr = { ...qr, height: clamp(squareHeightPct, 0.5, 100 - qr.y) };
      changed = true;
    }

    const serial = nextBoxes.serial;
    const serialWidthPx = (serial.width / 100) * outputPixels.width;
    const desiredHeightPx = serialWidthPx / serialTextRatio(firstSerial);
    const desiredHeightPct = (desiredHeightPx / outputPixels.height) * 100;
    if (Math.abs(serial.height - desiredHeightPct) > 0.15) {
      nextBoxes.serial = { ...serial, height: clamp(desiredHeightPct, 0.5, 100 - serial.y) };
      changed = true;
    }

    if (changed) onChange({ ...composer, boxes: nextBoxes });
  }, [composer.template, outputPixels.width, outputPixels.height, firstSerial]);

  function setCustomZoom(next: number) {
    onChange({ ...composer, zoomPercent: clamp(Math.round(next), 10, 400), zoomMode: "custom" });
  }

  function zoomBy(delta: number) {
    const current = composer.zoomMode === "fit" ? effectiveZoom : composer.zoomPercent;
    setCustomZoom(current + delta);
  }

  function updateBox(key: OverlayKey, next: Box) {
    const bounded = {
      x: clamp(next.x, 0, Math.max(0, 100 - next.width)),
      y: clamp(next.y, 0, Math.max(0, 100 - next.height)),
      width: clamp(next.width, 0.5, 100),
      height: clamp(next.height, 0.5, 100),
    };
    onChange({ ...composer, boxes: { ...composer.boxes, [key]: bounded } });
  }

  function boxPixels(box: Box) {
    return {
      x: (box.x / 100) * previewSize.width,
      y: (box.y / 100) * previewSize.height,
      width: (box.width / 100) * previewSize.width,
      height: (box.height / 100) * previewSize.height,
    };
  }

  function boxActualPixels(box: Box) {
    return {
      x: (box.x / 100) * outputPixels.width,
      y: (box.y / 100) * outputPixels.height,
      width: (box.width / 100) * outputPixels.width,
      height: (box.height / 100) * outputPixels.height,
    };
  }

  function boxMm(box: Box) {
    return {
      x: (box.x / 100) * composer.widthMm,
      y: (box.y / 100) * composer.heightMm,
      width: (box.width / 100) * composer.widthMm,
      height: (box.height / 100) * composer.heightMm,
    };
  }

  function renderOverlay(key: OverlayKey) {
    if (!enabled[key] || !previewSize.width || !previewSize.height) return null;
    const box = composer.boxes[key];
    const px = boxPixels(box);
    const serialRatio = serialTextRatio(firstSerial);
    const lockRatio = key === "qr" ? 1 : key === "serial" ? serialRatio : false;
    const serialFontSize = fittedSerialFontSize(firstSerial, px.width, px.height);

    return (
      <Rnd
        key={key}
        bounds="parent"
        size={{ width: px.width, height: px.height }}
        position={{ x: px.x, y: px.y }}
        minWidth={12}
        minHeight={8}
        lockAspectRatio={lockRatio}
        onMouseDown={() => onChange({ ...composer, selected: key })}
        onDragStart={() => onChange({ ...composer, selected: key })}
        onResizeStart={() => onChange({ ...composer, selected: key })}
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
        className={`overlay overlay-${key} ${composer.selected === key ? "selected" : ""}`}
      >
        <span className="overlay-label">{key.toUpperCase()}</span>
        {key === "qr" && qrPreview ? <img src={qrPreview} alt="QR preview" /> : null}
        {key === "barcode" && barcodePreview ? <img src={barcodePreview} alt="Barcode preview" /> : null}
        {key === "serial" ? (
          <span className="serial-text" style={{ fontSize: `${serialFontSize}px` }}>{firstSerial}</span>
        ) : null}
      </Rnd>
    );
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
          <button type="button" className={`tool-btn ${composer.zoomMode === "fit" ? "active" : ""}`} onClick={() => onChange({ ...composer, zoomMode: "fit" })} disabled={!composer.template}>Fit</button>
          <button type="button" className="tool-btn" onClick={() => setCustomZoom(100)} disabled={!composer.template}>100%</button>
          <button type="button" className="tool-btn icon-btn" onClick={() => zoomBy(-25)} disabled={!composer.template}>−</button>
          <div className="zoom-readout">{effectiveZoom}%</div>
          <button type="button" className="tool-btn icon-btn" onClick={() => zoomBy(25)} disabled={!composer.template}>+</button>
          <select
            className="zoom-select"
            value={composer.zoomMode === "fit" ? "fit" : String(composer.zoomPercent)}
            onChange={(e) => e.target.value === "fit" ? onChange({ ...composer, zoomMode: "fit" }) : setCustomZoom(Number(e.target.value))}
            disabled={!composer.template}
          >
            <option value="fit">Fit to workspace</option>
            {[25, 50, 75, 100, 125, 150, 200, 300, 400].map((value) => <option key={value} value={value}>{value}%</option>)}
          </select>
        </div>
        <div className="view-controls">
          <button type="button" className={`tool-btn ${composer.showGrid ? "active" : ""}`} onClick={() => onChange({ ...composer, showGrid: !composer.showGrid })} disabled={!composer.template}>Grid</button>
          <div className="rendered-size">View {renderedStage.width} × {renderedStage.height}px</div>
        </div>
      </div>

      <div ref={viewportRef} className="canvas-viewport">
        {!composer.template ? (
          <div className="empty-stage"><div><strong>Upload {title.toLowerCase()} artwork</strong>This template has its own size and independent code positions.</div></div>
        ) : (
          <div className="canvas-surface" style={{ minWidth: `${Math.max(renderedStage.width + 44, viewportSize.width)}px`, minHeight: `${Math.max(renderedStage.height + 44, viewportSize.height)}px` }}>
            <div ref={stageRef} className={`preview-stage ${composer.showGrid ? "show-grid" : ""}`} style={{ width: `${renderedStage.width}px`, height: `${renderedStage.height}px` }}>
              <img
                className="preview-art"
                src={composer.template.url}
                alt={`${title} artwork`}
                style={{ objectFit: composer.fitMode === "stretch" ? "fill" : composer.fitMode }}
              />
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
          const actual = boxActualPixels(composer.boxes[key]);
          const mm = boxMm(composer.boxes[key]);
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

export default function StickerStudio() {
  const [productName, setProductName] = useState("Vivid Pro Shield Color");
  const [prefix, setPrefix] = useState("VVPSC");
  const [digits, setDigits] = useState(5);
  const [start, setStart] = useState(33);
  const [quantity, setQuantity] = useState(100);
  const [dpi, setDpi] = useState(300);
  const [verificationBaseUrl, setVerificationBaseUrl] = useState("");
  const [enabled, setEnabled] = useState<Record<OverlayKey, boolean>>({ qr: true, barcode: true, serial: true });
  const [primary, setPrimary] = useState<ComposerState>(() => createComposerState());
  const [secondEnabled, setSecondEnabled] = useState(false);
  const [secondary, setSecondary] = useState<ComposerState>(() => createComposerState(85, 55));
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
  const qrValue = verificationBaseUrl.trim()
    ? `${verificationBaseUrl.replace(/\/$/, "")}/${firstSerial}`
    : firstSerial;

  useEffect(() => {
    if (!secondEnabled && activeTemplate === 2) setActiveTemplate(1);
  }, [secondEnabled, activeTemplate]);

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

  async function generateCodeImages(serial: string) {
    const qrData = verificationBaseUrl.trim()
      ? `${verificationBaseUrl.replace(/\/$/, "")}/${serial}`
      : serial;
    const qr = enabled.qr ? await QRCode.toDataURL(qrData, { margin: 0, width: 900, errorCorrectionLevel: "M" }) : "";
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

  async function renderSticker(serial: string, composer: ComposerState) {
    if (!composer.template) throw new Error("Upload a template artwork first.");
    const outputPixels = outputPixelsFor(composer, dpi);
    const canvas = document.createElement("canvas");
    canvas.width = outputPixels.width;
    canvas.height = outputPixels.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");

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
      const x = (box.x / 100) * canvas.width;
      const y = (box.y / 100) * canvas.height;
      const w = (box.width / 100) * canvas.width;
      const h = (box.height / 100) * canvas.height;
      ctx.drawImage(image, x, y, w, h);
    }

    if (enabled.serial) {
      const box = composer.boxes.serial;
      const x = (box.x / 100) * canvas.width;
      const y = (box.y / 100) * canvas.height;
      const w = (box.width / 100) * canvas.width;
      const h = (box.height / 100) * canvas.height;
      const fontSize = fittedSerialFontSize(serial, w, h);
      ctx.fillStyle = "#111";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${fontSize}px Arial, sans-serif`;
      ctx.fillText(serial, x + w / 2, y + h / 2, w);
    }

    return canvas;
  }

  async function downloadPreview() {
    const composer = activeTemplate === 2 ? secondary : primary;
    if (error || !composer.template) return;
    const canvas = await renderSticker(firstSerial, composer);
    downloadBlob(await canvasToBlob(canvas), `${firstSerial}-template-${activeTemplate}.png`);
  }

  function serialRows() {
    return buildSerials(config).map((serial, index) => ({
      no: index + 1,
      product: productName,
      prefix: cleanPrefix(prefix),
      serial,
      qrValue: verificationBaseUrl.trim() ? `${verificationBaseUrl.replace(/\/$/, "")}/${serial}` : serial,
    }));
  }

  function downloadCsv() {
    if (error) return;
    const rows = serialRows();
    const header = ["No.", "Product", "Prefix", "Serial", "QR Value"];
    const csv = [header, ...rows.map((row) => [row.no, row.product, row.prefix, row.serial, row.qrValue])]
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
      ["Template 1", primary.template ? `${outputPixelsFor(primary, dpi).width} × ${outputPixelsFor(primary, dpi).height}px` : "Not uploaded"],
      ["Template 2", secondEnabled ? (secondary.template ? `${outputPixelsFor(secondary, dpi).width} × ${outputPixelsFor(secondary, dpi).height}px` : "Enabled, not uploaded") : "Disabled"],
      ["Export DPI", dpi],
      [],
    ];
    const table = [["No.", "Product", "Prefix", "Serial", "QR Value"], ...rows.map((row) => [row.no, row.product, row.prefix, row.serial, row.qrValue])];
    const worksheet = XLSX.utils.aoa_to_sheet([...summary, ...table]);
    worksheet["!cols"] = [{ wch: 8 }, { wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 48 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Serials");
    XLSX.writeFile(workbook, `${slugify(productName)}-${firstSerial}-${lastSerial}.xlsx`);
  }

  async function downloadZip() {
    if (error || !primary.template || exporting) return;
    setExporting(true);
    setProgress(0);
    try {
      const [{ default: JSZip }, XLSX] = await Promise.all([import("jszip"), import("xlsx")]);
      const zip = new JSZip();
      const rows = serialRows();
      const folder = zip.folder(`${slugify(productName)}_${firstSerial}_${lastSerial}`)!;
      const stickers = folder.folder("template-1")!;

      for (let index = 0; index < rows.length; index++) {
        const canvas = await renderSticker(rows[index].serial, primary);
        stickers.file(`${rows[index].serial}.png`, await canvasToBlob(canvas));
        setProgress(Math.round(((index + 1) / rows.length) * 92));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const table = [["No.", "Product", "Prefix", "Serial", "QR Value"], ...rows.map((row) => [row.no, row.product, row.prefix, row.serial, row.qrValue])];
      const worksheet = XLSX.utils.aoa_to_sheet(table);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Serials");
      folder.file("serials.xlsx", XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
      folder.file("batch.json", JSON.stringify({
        productName,
        prefix: cleanPrefix(prefix),
        digits,
        start,
        quantity,
        end,
        dpi,
        verificationBaseUrl,
        enabled,
        template1: {
          widthMm: primary.widthMm,
          heightMm: primary.heightMm,
          outputPixels: outputPixelsFor(primary, dpi),
          fitMode: primary.fitMode,
          boxes: primary.boxes,
          artwork: primary.template ? { name: primary.template.name, widthPx: primary.template.naturalWidth, heightPx: primary.template.naturalHeight } : null,
        },
        template2: secondEnabled ? {
          status: "configured-for-phase-b-preview",
          widthMm: secondary.widthMm,
          heightMm: secondary.heightMm,
          outputPixels: outputPixelsFor(secondary, dpi),
          fitMode: secondary.fitMode,
          boxes: secondary.boxes,
          artwork: secondary.template ? { name: secondary.template.name, widthPx: secondary.template.naturalWidth, heightPx: secondary.template.naturalHeight } : null,
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

  const activeComposer = activeTemplate === 2 ? secondary : primary;
  const activeSetter = activeTemplate === 2 ? setSecondary : setPrimary;

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
            <p className="section-note">Each artwork keeps its own dimensions and independent QR / barcode / serial positions.</p>
            <ArtworkControls label="Template 1" composer={primary} dpi={dpi} onChange={setPrimary} />

            <div className="second-template-toggle">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={secondEnabled}
                  onChange={(e) => {
                    setSecondEnabled(e.target.checked);
                    if (e.target.checked) setActiveTemplate(2);
                  }}
                />
                Generate a second sticker template with the same serials
              </label>
            </div>

            {secondEnabled ? (
              <div className="second-template-controls">
                <ArtworkControls label="Template 2" composer={secondary} dpi={dpi} onChange={setSecondary} />
              </div>
            ) : null}

            <div className="field" style={{ marginTop: 12 }}>
              <label>Export quality</label>
              <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                <option value={150}>150 DPI</option>
                <option value={300}>300 DPI</option>
              </select>
            </div>
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
          {secondEnabled ? (
            <div className="template-tabs">
              <button type="button" className={`template-tab ${activeTemplate === 1 ? "active" : ""}`} onClick={() => setActiveTemplate(1)}>Template 1</button>
              <button type="button" className={`template-tab ${activeTemplate === 2 ? "active" : ""}`} onClick={() => setActiveTemplate(2)}>Template 2</button>
            </div>
          ) : null}

          <ComposerView
            title={`Template ${activeTemplate} composer`}
            composer={activeComposer}
            dpi={dpi}
            enabled={enabled}
            firstSerial={firstSerial}
            qrPreview={qrPreview}
            barcodePreview={barcodePreview}
            onChange={activeSetter}
          />

          <div className="actions">
            <button className="btn" disabled={!!error} onClick={downloadCsv}>Download CSV</button>
            <button className="btn" disabled={!!error} onClick={downloadXlsx}>Download Excel</button>
            <button className="btn btn-primary" disabled={!!error || !activeComposer.template} onClick={downloadPreview}>Download current sticker</button>
            <button className="btn btn-yellow" disabled={!!error || !primary.template || exporting} onClick={downloadZip}>{exporting ? "Generating…" : `Generate ${quantity} Template 1 stickers ZIP`}</button>
          </div>
          {secondEnabled ? <div className="phase-note">Template 2 now has independent artwork, size and code placement. Dual-template ZIP generation is the next export step.</div> : null}
          {exporting ? <><div className="progress"><div style={{ width: `${progress}%` }} /></div><div className="progress-text">Rendering serialised stickers locally in your browser: {progress}%</div></> : null}
        </section>
      </main>
      <div className="footnote">Serial text is transparent and fitted tightly to its resize box. Template 1 and Template 2 share the serial sequence but keep independent dimensions and positions.</div>
    </div>
  );
}
