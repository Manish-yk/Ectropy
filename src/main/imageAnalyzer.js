const fs = require('fs');

/**
 * Calculates greatest common divisor for aspect ratio simplification
 */
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Calculates a friendly aspect ratio string (e.g. 16:9, 16:10, 4:3, 1:1, 9:16, 2:3)
 * @param {number} width 
 * @param {number} height 
 * @returns {string}
 */
function getAspectRatioString(width, height) {
  if (!width || !height) return 'N/A';
  
  const ratio = width / height;

  // Common landscape ratios
  if (Math.abs(ratio - 16 / 9) < 0.03) return '16:9';
  if (Math.abs(ratio - 16 / 10) < 0.03) return '16:10';
  if (Math.abs(ratio - 21 / 9) < 0.05 || Math.abs(ratio - 64 / 27) < 0.05) return '21:9';
  if (Math.abs(ratio - 32 / 9) < 0.05) return '32:9';
  if (Math.abs(ratio - 4 / 3) < 0.03) return '4:3';
  if (Math.abs(ratio - 3 / 2) < 0.03) return '3:2';
  if (Math.abs(ratio - 5 / 4) < 0.03) return '5:4';
  if (Math.abs(ratio - 1) < 0.02) return '1:1';

  // Common portrait ratios
  if (Math.abs(ratio - 9 / 16) < 0.03) return '9:16';
  if (Math.abs(ratio - 9 / 19.5) < 0.04) return '9:19.5';
  if (Math.abs(ratio - 9 / 20) < 0.04) return '9:20';
  if (Math.abs(ratio - 2 / 3) < 0.03) return '2:3';
  if (Math.abs(ratio - 3 / 4) < 0.03) return '3:4';
  if (Math.abs(ratio - 1 / 2) < 0.03) return '1:2';

  // Default simplified ratio
  const divisor = gcd(Math.round(width), Math.round(height));
  const simpleW = Math.round(width / divisor);
  const simpleH = Math.round(height / divisor);
  
  if (simpleW < 100 && simpleH < 100) {
    return `${simpleW}:${simpleH}`;
  }

  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

/**
 * Extracts PNG dimensions from buffer
 */
function getPngDimensions(buffer) {
  if (buffer.length < 24) return null;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47) {
    return null;
  }
  // IHDR chunk is immediately following signature (starts at offset 8, dimensions at 16..24)
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

/**
 * Extracts JPEG dimensions from buffer
 */
function getJpegDimensions(buffer) {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null; // SOI marker

  let offset = 2;
  while (offset < buffer.length - 8) {
    if (buffer[offset] !== 0xFF) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

    // SOF markers (Start Of Frame): SOF0 to SOF15 (excluding DHT, JPG, DAC)
    const isSOF = (marker >= 0xC0 && marker <= 0xC3) ||
                  (marker >= 0xC5 && marker <= 0xC7) ||
                  (marker >= 0xC9 && marker <= 0xCB) ||
                  (marker >= 0xCD && marker <= 0xCF);

    if (isSOF) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    // Skip marker segment
    if (offset + 3 >= buffer.length) break;
    const length = buffer.readUInt16BE(offset + 2);
    offset += 2 + length;
  }

  return null;
}

/**
 * Extracts GIF dimensions from buffer
 */
function getGifDimensions(buffer) {
  if (buffer.length < 10) return null;
  const header = buffer.toString('ascii', 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') return null;

  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  return { width, height };
}

/**
 * Extracts BMP dimensions from buffer
 */
function getBmpDimensions(buffer) {
  if (buffer.length < 26) return null;
  if (buffer[0] !== 0x42 || buffer[1] !== 0x4D) return null; // 'BM'

  const width = buffer.readInt32LE(18);
  const height = Math.abs(buffer.readInt32LE(22));
  return { width, height };
}

/**
 * Extracts WebP dimensions from buffer
 */
function getWebpDimensions(buffer) {
  if (buffer.length < 30) return null;
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || webp !== 'WEBP') return null;

  const type = buffer.toString('ascii', 12, 16);

  if (type === 'VP8 ') {
    // Lossy VP8
    if (buffer.length < 30) return null;
    const width = buffer.readUInt16LE(26) & 0x3FFF;
    const height = buffer.readUInt16LE(28) & 0x3FFF;
    return { width, height };
  } else if (type === 'VP8L') {
    // Lossless VP8L
    if (buffer.length < 25) return null;
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const width = 1 + (((b1 & 0x3F) << 8) | b0);
    const height = 1 + (((b3 & 0xF) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6));
    return { width, height };
  } else if (type === 'VP8X') {
    // Extended VP8X
    if (buffer.length < 30) return null;
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }

  return null;
}

/**
 * Extracts SVG dimensions from buffer
 */
function getSvgDimensions(buffer) {
  const content = buffer.toString('utf-8', 0, Math.min(buffer.length, 4096));
  if (!content.includes('<svg')) return null;

  const widthMatch = content.match(/width=["']([\d.]+)(?:px)?["']/i);
  const heightMatch = content.match(/height=["']([\d.]+)(?:px)?["']/i);

  if (widthMatch && heightMatch) {
    return {
      width: Math.round(parseFloat(widthMatch[1])),
      height: Math.round(parseFloat(heightMatch[1]))
    };
  }

  const viewBoxMatch = content.match(/viewBox=["'][\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)["']/i);
  if (viewBoxMatch) {
    return {
      width: Math.round(parseFloat(viewBoxMatch[1])),
      height: Math.round(parseFloat(viewBoxMatch[2]))
    };
  }

  return null;
}

/**
 * Reads image dimensions and computes aspect ratio and classification metadata
 * @param {string} filePath 
 * @param {string} ext 
 * @returns {object|null}
 */
function getImageMetadata(filePath, ext) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(65536); // Read up to 64KB
    const bytesRead = fs.readSync(fd, buffer, 0, 65536, 0);
    fs.closeSync(fd);

    if (bytesRead < 8) return null;

    const slice = buffer.subarray(0, bytesRead);
    let dims = null;

    switch (ext.toLowerCase()) {
      case '.png':
        dims = getPngDimensions(slice);
        break;
      case '.jpg':
      case '.jpeg':
        dims = getJpegDimensions(slice);
        break;
      case '.gif':
        dims = getGifDimensions(slice);
        break;
      case '.webp':
        dims = getWebpDimensions(slice);
        break;
      case '.bmp':
        dims = getBmpDimensions(slice);
        break;
      case '.svg':
        dims = getSvgDimensions(slice);
        break;
      default:
        // Try all parsers in sequence
        dims = getPngDimensions(slice) || getJpegDimensions(slice) || getWebpDimensions(slice) || getGifDimensions(slice) || getBmpDimensions(slice);
    }

    if (!dims || !dims.width || !dims.height) {
      return null;
    }

    const { width, height } = dims;
    const ratio = width / height;
    const ratioString = getAspectRatioString(width, height);

    let orientation = 'landscape';
    if (Math.abs(ratio - 1) < 0.05) {
      orientation = 'square';
    } else if (ratio < 0.95) {
      orientation = 'portrait';
    }

    return {
      width,
      height,
      dimensionFormatted: `${width}×${height}`,
      aspectRatio: ratio,
      ratioString,
      orientation
    };
  } catch (err) {
    return null;
  }
}

/**
 * Intelligent Image Classification based on dimensions, aspect ratio, and filename patterns.
 * 
 * Rules:
 * 1. Screenshots:
 *    - Filename contains 'screenshot', 'screen shot', 'screencap', 'snip', 'cleanshot', 'prtscr', 'lightshot', 'sharex', etc.
 * 2. Wallpapers:
 *    - Filename contains 'wallpaper', 'background', 'lockscreen', 'desktop', '4k', '8k', 'uhd', etc.
 *    - OR High-resolution landscape (>= 1920x1080, ratio >= 1.25, e.g. 16:9, 16:10, 21:9, 32:9)
 *    - OR High-resolution mobile/portrait wallpaper (height >= 1920, width >= 1080, ratio <= 0.65)
 * 3. Pinterest / Memes:
 *    - Filename contains 'pinterest', 'pin_', 'pinimg', 'pins', 'meme', 'memes', 'dank', 'humor', 'shitpost', 'funny', 'wojak', 'pepe', etc.
 *    - OR Typical 32-char hex pinimg hash name (e.g. 841f32a5e52f....jpg)
 *    - OR Typical Pinterest pin aspect ratio (2:3 or 1:2 portrait, 0.45 <= ratio <= 0.75, height < 1920)
 * 4. General Media/Images fallback.
 * 
 * @param {string} fileName 
 * @param {object|null} imgMeta 
 * @returns {{ category: string, subpath: string, reason: string }}
 */
function classifyImageFile(fileName, imgMeta, sourcePath = '') {
  const lowerName = fileName.toLowerCase();
  const sourceFolders = String(sourcePath).split(/[\\/]+/).map(folder =>
    folder.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  // 1. Screenshot Detection
  const screenshotPatterns = [
    /screenshot/i,
    /screen[_\s-]?shot/i,
    /screencap/i,
    /screen[_\s-]?capture/i,
    /snip(?:aste|_)/i,
    /cleanshot/i,
    /lightshot/i,
    /sharex/i,
    /prtscr/i,
    /captura/i,
    /capture[_\s-]?d['e]cran/i,
    /^shot[_\s-]?\d+/i,
    /^screen[_\s-]?\d+/i
  ];

  if (screenshotPatterns.some(p => p.test(lowerName)) || sourceFolders.some(folder =>
    ['screenshot', 'screenshots', 'screencapture', 'screencaptures'].includes(folder)
  )) {
    return {
      category: 'Media/Images/Screenshots',
      subpath: 'Media/Images/Screenshots',
      reason: 'Screenshot filename pattern'
    };
  }

  const sourceCategory = sourceFolders.some(folder => /^whatsapp(?:images|media)?$/.test(folder))
    ? 'WhatsApp'
    : sourceFolders.some(folder => ['telegram', 'telegramimages'].includes(folder))
      ? 'Telegram'
      : sourceFolders.some(folder => ['instagram', 'instagramimages'].includes(folder))
        ? 'Instagram'
        : sourceFolders.some(folder => folder === 'camera')
          ? 'Camera'
          : null;

  if (sourceCategory) {
    return {
      category: `Media/Images/${sourceCategory}`,
      subpath: `Media/Images/${sourceCategory}`,
      reason: `Image source folder: ${sourceCategory}`
    };
  }

  // 2. Pinterest / Meme Detection
  const pinterestMemePatterns = [
    /pinterest/i,
    /^pin[_\s-]/i,
    /[_\s-]pin[_\s-]/i,
    /pinimg/i,
    /\bpins?\b/i,
    /meme/i,
    /memes/i,
    /dank/i,
    /humor/i,
    /shitpost/i,
    /funny/i,
    /wojak/i,
    /pepe/i,
    /reddit[_\s-]?meme/i,
    /9gag/i,
    /ifunny/i,
    /^[0-9a-f]{32}\.(?:jpg|jpeg|png|webp)$/i // Pinterest CDN default MD5 hash naming
  ];

  if (pinterestMemePatterns.some(p => p.test(lowerName))) {
    return {
      category: 'Media/Images/Pinterest',
      subpath: 'Media/Images/Pinterest',
      reason: 'Pinterest / Meme signature match'
    };
  }

  // 3. Wallpaper Detection
  const wallpaperPatterns = [
    /wallpaper/i,
    /wallpapers/i,
    /lockscreen/i,
    /homescreen/i,
    /desktop[_\s-]?bg/i,
    /desktop[_\s-]?wallpaper/i,
    /\b4k\b/i,
    /\b8k\b/i,
    /\buhd\b/i,
    /\bfhd\b/i,
    /\b1440p\b/i,
    /\b2160p\b/i,
    /ultrawide/i,
    /widescreen/i
  ];

  if (wallpaperPatterns.some(p => p.test(lowerName))) {
    return {
      category: 'Media/Images/Wallpapers',
      subpath: 'Media/Images/Wallpapers',
      reason: 'Wallpaper keyword match'
    };
  }

  // 4. Dimension and aspect ratio checks
  if (imgMeta && imgMeta.width && imgMeta.height) {
    const { width, height, aspectRatio } = imgMeta;

    // High-Resolution Desktop Wallpapers (1080p, 1440p, 4K, 5K, Ultrawide, etc.)
    const isDesktopWallpaperRes = (width >= 1920 && height >= 1080 && aspectRatio >= 1.25) ||
                                  (width >= 2560 && height >= 1080) ||
                                  (width >= 3440 && height >= 1400);

    // High-Resolution Mobile / Portrait Wallpapers (e.g. 1080x1920, 1080x2400, 1170x2532, 1440x3120)
    const isMobileWallpaperRes = (width >= 1080 && height >= 1920 && aspectRatio <= 0.65);

    if (isDesktopWallpaperRes || isMobileWallpaperRes) {
      return {
        category: 'Media/Images/Wallpapers',
        subpath: 'Media/Images/Wallpapers',
        reason: `High-resolution wallpaper dimension (${width}×${height}, ${imgMeta.ratioString})`
      };
    }

    // Pinterest Vertical Pin format (Standard Pinterest Pin ratio is 2:3 or ~1:2 with moderate resolution)
    const isPinterestPinRatio = (aspectRatio >= 0.45 && aspectRatio <= 0.72) && (height <= 1800 && width <= 1200);
    if (isPinterestPinRatio) {
      return {
        category: 'Media/Images/Pinterest',
        subpath: 'Media/Images/Pinterest',
        reason: `Pinterest standard pin ratio (${width}×${height}, ${imgMeta.ratioString})`
      };
    }
  }

  // Default fallback for general images
  return {
    category: 'Media/Images',
    subpath: 'Media/Images',
    reason: 'Standard media image'
  };
}

module.exports = {
  gcd,
  getAspectRatioString,
  getImageMetadata,
  classifyImageFile
};
