export type SerialConfig = {
  prefix: string;
  digits: number;
  start: number;
  quantity: number;
};

export function cleanPrefix(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

const tokenMap: Record<string, string> = {
  vivid: "VV",
  pro: "P",
  prime: "PRM",
  shield: "S",
  color: "C",
  colour: "C",
  matte: "MT",
  max: "MX",
  dual: "D",
  finish: "F",
  satin: "S",
  windshield: "W",
  armor: "A",
  armour: "A",
  coolguard: "CG",
  shadenova: "SN",
};

export function suggestPrefixes(productName: string) {
  const tokens = productName
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9-]/g, ""))
    .filter(Boolean);

  if (!tokens.length) return ["VVID"];

  const mapped = tokens.map((token) => {
    const lower = token.toLowerCase();
    if (tokenMap[lower]) return tokenMap[lower];
    const nano = lower.match(/^nano-?(\d+)$/);
    if (nano) return nano[1];
    return token.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
  });

  const primary = cleanPrefix(mapped.join(""));
  const initials = cleanPrefix(tokens.map((t) => t[0]).join(""));
  const compact = cleanPrefix(
    tokens
      .map((t, i) => (i === 0 && t.toLowerCase() === "vivid" ? "VV" : t.slice(0, i === 0 ? 2 : 1)))
      .join("")
  );

  return Array.from(new Set([primary, compact, initials].filter((v) => v.length >= 3))).slice(0, 3);
}

export function maxSerialForDigits(digits: number) {
  return Math.pow(10, digits) - 1;
}

export function serialEnd(start: number, quantity: number) {
  return start + quantity - 1;
}

export function formatSerial(prefix: string, number: number, digits: number) {
  return `${cleanPrefix(prefix)}-${String(number).padStart(digits, "0")}`;
}

export function validateSerialConfig(config: SerialConfig) {
  if (!cleanPrefix(config.prefix)) return "Enter a serial prefix.";
  if (!Number.isInteger(config.digits) || config.digits < 3 || config.digits > 8) return "Serial length must be between 3 and 8 digits.";
  if (!Number.isInteger(config.start) || config.start < 0) return "Starting number must be a whole number of 0 or greater.";
  if (!Number.isInteger(config.quantity) || config.quantity < 1 || config.quantity > 2000) return "Quantity must be between 1 and 2,000 stickers.";
  const end = serialEnd(config.start, config.quantity);
  const max = maxSerialForDigits(config.digits);
  if (end > max) return `This batch ends at ${end.toLocaleString()} but ${config.digits} digits only support up to ${max.toLocaleString()}. Increase the serial length.`;
  return null;
}

export function buildSerials(config: SerialConfig) {
  const error = validateSerialConfig(config);
  if (error) throw new Error(error);
  return Array.from({ length: config.quantity }, (_, index) => formatSerial(config.prefix, config.start + index, config.digits));
}
