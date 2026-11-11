const path = require('path');
const { classifyImageFile } = require('./imageAnalyzer');

// Map of extensions to primary category and mime type
const EXTENSION_MAP = {
  // Documents
  '.pdf': { baseCategory: 'Documents', mime: 'application/pdf' },
  '.docx': { baseCategory: 'Documents', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.doc': { baseCategory: 'Documents', mime: 'application/msword' },
  '.txt': { baseCategory: 'Documents', mime: 'text/plain' },
  '.rtf': { baseCategory: 'Documents', mime: 'application/rtf' },
  '.odt': { baseCategory: 'Documents', mime: 'application/vnd.oasis.opendocument.text' },
  '.csv': { baseCategory: 'Documents', mime: 'text/csv' },
  '.xlsx': { baseCategory: 'Documents', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.xls': { baseCategory: 'Documents', mime: 'application/vnd.ms-excel' },
  '.pptx': { baseCategory: 'Documents', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  '.ppt': { baseCategory: 'Documents', mime: 'application/vnd.ms-powerpoint' },
  '.epub': { baseCategory: 'Documents', mime: 'application/epub+zip' },
  '.mobi': { baseCategory: 'Documents', mime: 'application/x-mobipocket-ebook' },
  '.azw3': { baseCategory: 'Documents', mime: 'application/vnd.amazon.ebook' },
  '.md': { baseCategory: 'Documents', mime: 'text/markdown' },
  '.markdown': { baseCategory: 'Documents', mime: 'text/markdown' },
  '.log': { baseCategory: 'Documents', mime: 'text/plain' },

  // Images
  '.png': { baseCategory: 'Media/Images', mime: 'image/png' },
  '.jpg': { baseCategory: 'Media/Images', mime: 'image/jpeg' },
  '.jpeg': { baseCategory: 'Media/Images', mime: 'image/jpeg' },
  '.webp': { baseCategory: 'Media/Images', mime: 'image/webp' },
  '.svg': { baseCategory: 'Media/Images', mime: 'image/svg+xml' },
  '.gif': { baseCategory: 'Media/Images', mime: 'image/gif' },
  '.bmp': { baseCategory: 'Media/Images', mime: 'image/bmp' },
  '.ico': { baseCategory: 'Media/Images', mime: 'image/x-icon' },
  '.tiff': { baseCategory: 'Media/Images', mime: 'image/tiff' },
  '.avif': { baseCategory: 'Media/Images', mime: 'image/avif' },

  // Videos
  '.mp4': { baseCategory: 'Media/Videos', mime: 'video/mp4' },
  '.mkv': { baseCategory: 'Media/Videos', mime: 'video/x-matroska' },
  '.webm': { baseCategory: 'Media/Videos', mime: 'video/webm' },
  '.mov': { baseCategory: 'Media/Videos', mime: 'video/quicktime' },
  '.avi': { baseCategory: 'Media/Videos', mime: 'video/x-msvideo' },
  '.flv': { baseCategory: 'Media/Videos', mime: 'video/x-flv' },
  '.wmv': { baseCategory: 'Media/Videos', mime: 'video/x-ms-wmv' },
  '.m4v': { baseCategory: 'Media/Videos', mime: 'video/x-m4v' },

  // Audio / Music
  '.mp3': { baseCategory: 'Media/Audio', mime: 'audio/mpeg' },
  '.flac': { baseCategory: 'Media/Audio', mime: 'audio/flac' },
  '.wav': { baseCategory: 'Media/Audio', mime: 'audio/wav' },
  '.m4a': { baseCategory: 'Media/Audio', mime: 'audio/mp4' },
  '.aac': { baseCategory: 'Media/Audio', mime: 'audio/aac' },
  '.ogg': { baseCategory: 'Media/Audio', mime: 'audio/ogg' },
  '.opus': { baseCategory: 'Media/Audio', mime: 'audio/opus' },
  '.wma': { baseCategory: 'Media/Audio', mime: 'audio/x-ms-wma' },

  // Archives
  '.zip': { baseCategory: 'Archives', mime: 'application/zip' },
  '.tar.gz': { baseCategory: 'Archives', mime: 'application/gzip' },
  '.tgz': { baseCategory: 'Archives', mime: 'application/gzip' },
  '.rar': { baseCategory: 'Archives', mime: 'application/vnd.rar' },
  '.7z': { baseCategory: 'Archives', mime: 'application/x-7z-compressed' },
  '.tar': { baseCategory: 'Archives', mime: 'application/x-tar' },
  '.gz': { baseCategory: 'Archives', mime: 'application/gzip' },
  '.iso': { baseCategory: 'Archives', mime: 'application/x-iso9660-image' },
  '.img': { baseCategory: 'Archives', mime: 'application/octet-stream' },

  // Executables
  '.exe': { baseCategory: 'Executables', mime: 'application/x-msdownload' },
  '.AppImage': { baseCategory: 'Executables', mime: 'application/x-appimage' },
  '.appimage': { baseCategory: 'Executables', mime: 'application/x-appimage' },
  '.deb': { baseCategory: 'Executables', mime: 'application/vnd.debian.binary-package' },
  '.msi': { baseCategory: 'Executables', mime: 'application/x-msi' },
  '.dmg': { baseCategory: 'Executables', mime: 'application/x-apple-diskimage' },
  '.rpm': { baseCategory: 'Executables', mime: 'application/x-rpm' },
  '.pkg': { baseCategory: 'Executables', mime: 'application/octet-stream' }
};

/**
 * Classifies documents into logical sub-folders based on naming and extensions
 */
function classifyDocument(fileName, ext) {
  const name = fileName.toLowerCase();

  // Financial & Invoices
  if (/(invoice|receipt|billing|bill[_\s-]|tax|statement|salary|payroll|payslip|expense|quote|estimate|bank[_\s-]|payment)/i.test(name)) {
    return {
      category: 'Documents/Financial',
      subpath: path.join('Documents', 'Financial'),
      reason: 'Financial & invoice pattern match'
    };
  }

  // Resumes & Careers
  if (/(resume|cv[_\s-]|curriculum[_\s-]?vitae|cover[_\s-]?letter|bio[_\s-]?data)/i.test(name)) {
    return {
      category: 'Documents/Resumes',
      subpath: path.join('Documents', 'Resumes'),
      reason: 'Resume or CV pattern match'
    };
  }

  // Books & E-books
  if (['.epub', '.mobi', '.azw3'].includes(ext) || /(book|ebook|novel|handbook|guide|manual|textbook|volume|vol\.\s*\d+)/i.test(name)) {
    return {
      category: 'Documents/Books',
      subpath: path.join('Documents', 'Books'),
      reason: 'E-book or reading material pattern'
    };
  }

  // Spreadsheets & Data
  if (['.xlsx', '.xls', '.csv'].includes(ext) || /(sheet|spreadsheet|budget|tracker|ledger|inventory|metrics|dataset)/i.test(name)) {
    return {
      category: 'Documents/Spreadsheets',
      subpath: path.join('Documents', 'Spreadsheets'),
      reason: 'Spreadsheet table format'
    };
  }

  // Presentations & Pitch Decks
  if (['.pptx', '.ppt'].includes(ext) || /(presentation|deck|slides|keynote|pitch)/i.test(name)) {
    return {
      category: 'Documents/Presentations',
      subpath: path.join('Documents', 'Presentations'),
      reason: 'Presentation slides format'
    };
  }

  // Legal & Contracts
  if (/(contract|agreement|nda|terms|policy|privacy|license|affidavit|deed|lease)/i.test(name)) {
    return {
      category: 'Documents/Contracts',
      subpath: path.join('Documents', 'Contracts'),
      reason: 'Legal agreement or contract pattern'
    };
  }

  // Reports & Whitepapers
  if (/(report|summary|analysis|audit|whitepaper|minutes|brief|proposal|quarterly|q[1-4][_\s-]?20\d\d)/i.test(name)) {
    return {
      category: 'Documents/Reports',
      subpath: path.join('Documents', 'Reports'),
      reason: 'Report or analysis document'
    };
  }

  // Notes & Drafts
  if (['.md', '.markdown', '.txt', '.log'].includes(ext) || /(note|draft|journal|todo|memo|readme|log)/i.test(name)) {
    return {
      category: 'Documents/Notes',
      subpath: path.join('Documents', 'Notes'),
      reason: 'Notes or plain text format'
    };
  }

  // Default Documents fallback
  return {
    category: 'Documents',
    subpath: 'Documents',
    reason: 'Standard document'
  };
}

/**
 * Classifies videos into movies, series, recordings, clips, etc.
 */
function classifyVideo(fileName, fileSize) {
  const name = fileName.toLowerCase();

  // Screen Recordings & Tutorials
  if (/(screen[_\s-]?record|screencast|obs|zoom|recording|walkthrough|tutorial|webinar|capture)/i.test(name)) {
    return {
      category: 'Media/Videos/Recordings',
      subpath: path.join('Media', 'Videos', 'Recordings'),
      reason: 'Screen recording / session capture'
    };
  }

  // TV Shows & Series (S01E02, Season 1 Episode 2, 1x02)
  if (/(s\d{1,2}[\s._-]*e\d{1,3}|season[_\s.-]?\d+|(?:episode|ep)[_\s.-]?\d+|(?:^|[^a-z0-9])\d{1,2}[\s._-]*x[\s._-]*\d{2,3}(?!\d)|\[(?:sub|horriblesubs|subsplease|erai-raws)\])/i.test(name)) {
    const seriesName = extractSeriesTitle(fileName);
    return {
      category: 'Media/Videos/TV Shows',
      subpath: path.join('Media', 'Videos', 'TV Shows'),
      reason: 'TV episode / series naming convention',
      seriesName
    };
  }

  // Short clips, social, reels
  if (/(reel|tiktok|short|clip|story|status|meme|webm_)/i.test(name)) {
    return {
      category: 'Media/Videos/Clips',
      subpath: path.join('Media', 'Videos', 'Clips'),
      reason: 'Short form clip / reel'
    };
  }

  // Movies (1080p/4k bluray releases, movies with year e.g. (2022) or large size > 600MB)
  if (/(1080p|2160p|4k|bluray|web-dl|x264|x265|hevc|yify|yts|rarbg)/i.test(name) || (/\b(19\d\d|20\d\d)\b/.test(name) && fileSize > 300 * 1024 * 1024)) {
    return {
      category: 'Media/Videos/Movies',
      subpath: path.join('Media', 'Videos', 'Movies'),
      reason: 'Feature movie / high-definition release'
    };
  }

  return {
    category: 'Media/Videos',
    subpath: path.join('Media', 'Videos'),
    reason: 'Standard video file'
  };
}

function extractSeriesTitle(fileName) {
  const markers = [
    /(?:^|[^A-Za-z0-9])s\d{1,2}[\s._-]*e\d{1,3}(?!\d)/i,
    /(?:^|[^A-Za-z0-9])\d{1,2}[\s._-]*x[\s._-]*\d{2,3}(?!\d)/i,
    /(?:^|[^A-Za-z0-9])season[\s._-]*\d{1,2}[\s._-]+episode[\s._-]*\d{1,3}(?!\d)/i,
    /(?:^|[^A-Za-z0-9])(?:episode|ep)\s*[._-]*\d{1,3}(?!\d)/i
  ];
  const marker = markers
    .map(pattern => ({ match: pattern.exec(fileName) }))
    .filter(result => result.match)
    .sort((left, right) => left.match.index - right.match.index)[0]?.match;

  if (!marker) return null;

  let title = fileName.slice(0, marker.index);
  title = title.replace(/^\s*(?:\[[^\]]+\]\s*)+/, '');
  title = title
    .replace(/[._]+/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s.\-_]+$/g, '')
    .trim();

  return title || null;
}

/**
 * Classifies audio into music, podcasts, voice recordings, sound effects
 */
function classifyAudio(fileName) {
  const name = fileName.toLowerCase();

  if (/(voice[_\s-]?memo|recording|mic[_\s-]|dictation|audioclip|whatsapp[_\s-]audio)/i.test(name)) {
    return {
      category: 'Media/Audio/Voice Notes',
      subpath: path.join('Media', 'Audio', 'Voice Notes'),
      reason: 'Voice note or microphone recording'
    };
  }

  if (/(podcast|episode|ep\.\s*\d+|interview|broadcast)/i.test(name)) {
    return {
      category: 'Media/Audio/Podcasts',
      subpath: path.join('Media', 'Audio', 'Podcasts'),
      reason: 'Podcast or episodic audio'
    };
  }

  if (/(sfx|sound[_\s-]?effect|jingle|ringtone|sample|loop|foley|hit|whoosh|beep)/i.test(name)) {
    return {
      category: 'Media/Audio/Sound Effects',
      subpath: path.join('Media', 'Audio', 'Sound Effects'),
      reason: 'Sound effect / sample track'
    };
  }

  return {
    category: 'Media/Audio/Music',
    subpath: path.join('Media', 'Audio', 'Music'),
    reason: 'Music track'
  };
}

/**
 * Classifies archives into backups, disk images, and packages
 */
function classifyArchive(fileName, ext) {
  const name = fileName.toLowerCase();

  if (['.iso', '.img'].includes(ext) || /(disk|image|installer|bootable)/i.test(name)) {
    return {
      category: 'Archives/Disk Images',
      subpath: path.join('Archives', 'Disk Images'),
      reason: 'Disk image / boot media'
    };
  }

  if (/(backup|dump|snapshot|export|archive[_\s-]?\d+|db_)/i.test(name)) {
    return {
      category: 'Archives/Backups',
      subpath: path.join('Archives', 'Backups'),
      reason: 'Backup archive or system dump'
    };
  }

  return {
    category: 'Archives',
    subpath: 'Archives',
    reason: 'Compressed archive package'
  };
}

/**
 * Classifies executables by operating system
 */
function classifyExecutable(fileName, ext) {
  if (['.exe', '.msi'].includes(ext)) {
    return {
      category: 'Executables/Windows',
      subpath: path.join('Executables', 'Windows'),
      reason: 'Windows installer / application'
    };
  }

  if (['.AppImage', '.appimage', '.deb', '.rpm'].includes(ext)) {
    return {
      category: 'Executables/Linux',
      subpath: path.join('Executables', 'Linux'),
      reason: 'Linux package / binary'
    };
  }

  if (['.dmg', '.pkg'].includes(ext)) {
    return {
      category: 'Executables/macOS',
      subpath: path.join('Executables', 'macOS'),
      reason: 'macOS installer / disk image'
    };
  }

  return {
    category: 'Executables',
    subpath: 'Executables',
    reason: 'Application executable'
  };
}

/**
 * Master classification function for all files
 */
function classifyFile(fileName, ext, fileStat = {}, imageMeta = null, sourcePath = '') {
  const mapping = EXTENSION_MAP[ext];
  if (!mapping) {
    return null;
  }

  const baseCategory = mapping.baseCategory;

  if (baseCategory === 'Media/Images') {
    const imgClassification = classifyImageFile(fileName, imageMeta, sourcePath);
    return {
      category: imgClassification.category,
      subpath: imgClassification.subpath.split('/').join(path.sep),
      mime: mapping.mime,
      reason: imgClassification.reason
    };
  }

  if (baseCategory === 'Documents') {
    const docClassification = classifyDocument(fileName, ext);
    return {
      category: docClassification.category,
      subpath: docClassification.subpath,
      mime: mapping.mime,
      reason: docClassification.reason
    };
  }

  if (baseCategory === 'Media/Videos') {
    const vidClassification = classifyVideo(fileName, fileStat.size || 0);
    return {
      category: vidClassification.category,
      subpath: vidClassification.subpath,
      mime: mapping.mime,
      reason: vidClassification.reason,
      seriesName: vidClassification.seriesName
    };
  }

  if (baseCategory === 'Media/Audio') {
    const audioClassification = classifyAudio(fileName);
    return {
      category: audioClassification.category,
      subpath: audioClassification.subpath,
      mime: mapping.mime,
      reason: audioClassification.reason
    };
  }

  if (baseCategory === 'Archives') {
    const archClassification = classifyArchive(fileName, ext);
    return {
      category: archClassification.category,
      subpath: archClassification.subpath,
      mime: mapping.mime,
      reason: archClassification.reason
    };
  }

  if (baseCategory === 'Executables') {
    const execClassification = classifyExecutable(fileName, ext);
    return {
      category: execClassification.category,
      subpath: execClassification.subpath,
      mime: mapping.mime,
      reason: execClassification.reason
    };
  }

  return {
    category: baseCategory,
    subpath: baseCategory,
    mime: mapping.mime,
    reason: 'Extension mapping'
  };
}

module.exports = {
  EXTENSION_MAP,
  classifyFile,
  classifyDocument,
  classifyVideo,
  extractSeriesTitle,
  classifyAudio,
  classifyArchive,
  classifyExecutable
};
