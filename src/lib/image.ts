// Dependency-free image inspection.
//
// We must not trust the client's declared MIME type or the file extension, so
// the format is detected from magic bytes and the dimensions are parsed out of
// the file header. Only raster formats we can actually print are accepted:
// SVG is deliberately rejected (it is an XML/script vector, an XSS surface,
// and no DTG printer takes it directly).

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30 MB
export const MIN_ARTWORK_PX = 400;
export const MAX_ARTWORK_PX = 12000;

export type DetectedImage = {
  format: "png" | "jpeg" | "webp";
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
  width: number;
  height: number;
  hasAlpha: boolean;
};

export type ImageInspectionError = { error: string };

export function inspectImage(buf: Buffer): DetectedImage | ImageInspectionError {
  if (buf.byteLength === 0) return { error: "The uploaded file is empty." };
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    return { error: `File is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit.` };
  }

  const png = readPng(buf);
  if (png) return png;

  const jpeg = readJpeg(buf);
  if (jpeg) return jpeg;

  const webp = readWebp(buf);
  if (webp) return webp;

  return {
    error:
      "Unsupported file. Upload a PNG (best — supports transparency), JPG or WebP. PDF, SVG, HEIC and AI files are not accepted.",
  };
}

export function validateArtworkDimensions(image: DetectedImage): string | null {
  if (image.width < MIN_ARTWORK_PX || image.height < MIN_ARTWORK_PX) {
    return `Artwork is only ${image.width}×${image.height}px. Minimum is ${MIN_ARTWORK_PX}px on each side; for a full-front print aim for 1800×2400px or larger.`;
  }
  if (image.width > MAX_ARTWORK_PX || image.height > MAX_ARTWORK_PX) {
    return `Artwork is ${image.width}×${image.height}px, which exceeds the ${MAX_ARTWORK_PX}px limit.`;
  }
  return null;
}

function readPng(buf: Buffer): DetectedImage | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.byteLength < 33 || !buf.subarray(0, 8).equals(signature)) return null;
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") return null;

  const colorType = buf.readUInt8(25);
  return {
    format: "png",
    mimeType: "image/png",
    extension: "png",
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    // Colour types 4 (grey+alpha) and 6 (RGBA) carry an alpha channel; 3 is
    // palette, which may carry a tRNS transparency chunk.
    hasAlpha: colorType === 4 || colorType === 6 || (colorType === 3 && buf.includes("tRNS")),
  };
}

function readJpeg(buf: Buffer): DetectedImage | null {
  if (buf.byteLength < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 9 < buf.byteLength) {
    if (buf.readUInt8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf.readUInt8(offset + 1);
    // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPG (c8), DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        format: "jpeg",
        mimeType: "image/jpeg",
        extension: "jpg",
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
        hasAlpha: false,
      };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebp(buf: Buffer): DetectedImage | null {
  if (
    buf.byteLength < 30 ||
    buf.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buf.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null;
  }

  const chunk = buf.subarray(12, 16).toString("ascii");
  const base = { format: "webp", mimeType: "image/webp", extension: "webp" } as const;

  if (chunk === "VP8X") {
    return {
      ...base,
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
      hasAlpha: (buf.readUInt8(20) & 0b0001_0000) !== 0,
    };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return {
      ...base,
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      hasAlpha: ((bits >> 28) & 1) === 1,
    };
  }
  if (chunk === "VP8 ") {
    return {
      ...base,
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
      hasAlpha: false,
    };
  }
  return null;
}
