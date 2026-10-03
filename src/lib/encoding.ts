/**
 * Декодирование текста из файлов: UTF-8/UTF-16 с BOM, а для старых файлов
 * Windows-1251 (кириллица) или Windows-1252. Таблица 1251 своя, чтобы не зависеть
 * от того, какие кодировки знает конкретный движок.
 */

const CP1251_HIGH =
  'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\uFFFD™љ›њќћџ\u00A0ЎўЈ¤Ґ¦§Ё©Є«¬\u00AD®Ї°±Ііґµ¶·ё№є»јЅѕї';

export function decodeCp1251(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b >= 0xc0) out += String.fromCharCode(0x410 + b - 0xc0);
    else out += CP1251_HIGH[b - 0x80];
  }
  return out;
}

let cp1252: TextDecoder | null = null;
function latin(bytes: Uint8Array): string {
  try {
    cp1252 ??= new TextDecoder('windows-1252');
    return cp1252.decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

/** Похоже ли на кириллицу в 1251: русских букв не меньше, чем латинских. */
export function looksCyrillic1251(bytes: Uint8Array): boolean {
  let high = 0;
  let ascii = 0;
  for (const b of bytes) {
    if (b >= 0xc0 || b === 0xa8 || b === 0xb8) high++;
    else if ((b | 0x20) >= 0x61 && (b | 0x20) <= 0x7a) ascii++;
  }
  return high > 0 && high >= ascii;
}

/** Однобайтовый текст: Windows-1251, если похоже на кириллицу, иначе Windows-1252. */
export function decodeLegacy(bytes: Uint8Array): string {
  return looksCyrillic1251(bytes) ? decodeCp1251(bytes) : latin(bytes);
}

const utf8 = new TextDecoder('utf-8');

/** UTF-8, а если байты им не являются, то однобайтовая кодировка. */
export function decodeSmart(bytes: Uint8Array): string {
  const text = utf8.decode(bytes);
  return text.includes('\uFFFD') ? decodeLegacy(bytes) : text;
}

/** Текстовый файл целиком (плейлист, CSV): BOM, UTF-8 или Windows-1251. */
export function decodeTextFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8.decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1];
      swapped[i - 1] = bytes[i];
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  return decodeSmart(bytes);
}
