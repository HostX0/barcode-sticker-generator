export type SerialConfig = {
  prefix: string;
  digits: number;
  start: number;
  quantity: number;
};

export function cleanPrefix(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

const KNOWN_PRODUCT_PREFIXES: Array<[RegExp, string[]]> = [
  [/^vivid\s+pro\s+shield\s+colou?r\b/i, ["VVPSC", "VVPCL", "VPSCLR"]],
  [/^vivid\s+pro\s+matte\b/i, ["VVPMT", "VPMAT", "VVPM"]],
  [/^vivid\s+pro\s+max\b/i, ["VVPMX", "VPMAX", "VVPM"]],
  [/^vivid\s+dual\s+finish(?:\s+satin)?\b/i, ["VVDFS", "VVD FS".replace(/\s/g, ""), "VVDF"]],
  [/^vivid\s+windshield\s+armo(?:u)?r\b/i, ["VVWA", "VVWARM", "VWA"]],
  [/^vivid\s+shadenova(?:\s+nano[-\s]?50)?\b/i, ["VVSN50", "VVSHN", "VVSN"]],
  [/^vivid\s+coolguard(?:\s+nano[-\s]?75)?\b/i, ["VVCG75", "VVCGD", "VVCG"]],
  [/^vivid\s+prime\b/i, ["VVPRM", "VPRIME", "VVPRI"]],
  [/^vivid\s+pro\b/i, ["VVPRO", "VPRO", "VVP"]],
  [/^nano[-\s]?35\b/i, ["VVN35", "NANO35", "VN35"]],
  [/^nano[-\s]?15\b/i, ["VVN15", "NANO15", "VN15"]],
  [/^nano[-\s]?0?5\b/i, ["VVN05", "NANO05", "VN05"]],
];

const tokenMap: Record<string, string> = {
  vivid: "VV",
  pro: "PRO",
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
  const normalizedName = productName.trim();
  for (const [pattern, prefixes] of KNOWN_PRODUCT_PREFIXES) {
    if (pattern.test(normalizedName)) return prefixes.map(cleanPrefix).slice(0, 3);
  }

  const tokens = normalizedName
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9-]/g, ""))
    .filter(Boolean);

  if (!tokens.length) return ["VVID"];

  const mapped = tokens.map((token) => {
    const lower = token.toLowerCase();
    if (tokenMap[lower]) return tokenMap[lower];
    const nano = lower.match(/^nano-?(\d+)$/);
    if (nano) return nano[1].padStart(2, "0");
    return token.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
  });

  const primary = cleanPrefix(mapped.join(""));
  const initials = cleanPrefix(tokens.map((token) => token[0]).join(""));
  const compact = cleanPrefix(
    tokens
      .map((token, index) => (index === 0 && token.toLowerCase() === "vivid" ? "VV" : token.slice(0, index === 0 ? 2 : 1)))
      .join("")
  );

  return Array.from(new Set([primary, compact, initials].filter((value) => value.length >= 3))).slice(0, 3);
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
