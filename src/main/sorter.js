const fs = require('fs');
const path = require('path');
const { parseFile } = require('music-metadata');
const { getImageMetadata } = require('./imageAnalyzer');
const { EXTENSION_MAP, classifyFile } = require('./fileClassifier');
const {
  moveFileNoReplace,
  moveFileNoReplaceAsync,
  copyFileNoReplace,
  copyFileNoReplaceAsync
} = require('./fileMove');

/**
 * Developer environment signatures.
 * If a directory contains any of these files or directories, or is named as one of these,
 * the directory scanner immediately aborts traversing it to shield code projects.
 */
const PROJECT_BOUNDARY_SIGNATURES = [
  'package.json',
  'package-lock.json',
  '.git',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  'node_modules',
  'venv',
  '.venv',
  'env',
  'virtualenv',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'requirements.txt',
  'Pipfile',
  'pyproject.toml',
  'Gemfile',
  'composer.json',
  'tsconfig.json',
  '.idea',
  '.vscode'
];

/**
 * Extension classification metadata used for file-type analysis.
 */
const EXTENSION_TO_CATEGORY = EXTENSION_MAP;

/**
 * Checks if a given directory contains any developer environment signatures.
 * @param {string} dirPath - Absolute directory path
 * @returns {{ isShielded: boolean, matchedSignatures: string[] }}
 */
function checkProjectBoundary(dirPath) {
  try {
    const dirName = path.basename(dirPath);
    if (PROJECT_BOUNDARY_SIGNATURES.includes(dirName)) {
      return { isShielded: true, matchedSignatures: [dirName] };
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const matched = [];

    for (const entry of entries) {
      if (PROJECT_BOUNDARY_SIGNATURES.includes(entry.name)) {
        matched.push(entry.name);
      }
    }

    return {
      isShielded: matched.length > 0,
      matchedSignatures: matched
    };
  } catch (err) {
    // If directory cannot be read, treat safely as shielded
    return { isShielded: true, matchedSignatures: [`Error reading directory: ${err.message}`] };
  }
}

/**
 * Extracts normalized file extension, with support for compound extensions like .tar.gz
 * @param {string} filename 
 * @returns {string} lowercased extension with dot
 */
function getFileExtension(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz')) {
    return '.tar.gz';
  }
  return path.extname(filename).toLowerCase();
}

/**
 * Formats byte size to human readable string
 * @param {number} bytes 
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function normalizeFolderName(name) {
  return String(name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(?:the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

function sanitizeFolderComponent(value) {
  const component = String(value || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100);

  if (!component || component === '.' || component === '..') return '';
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(component) ? `_${component}` : component;
}

function getSafeChildFolder(parentDir, folderName) {
  if (normalizeFolderName(path.basename(parentDir)) === normalizeFolderName(folderName)) {
    return { path: parentDir, usable: true };
  }

  const categoryFolder = path.join(parentDir, folderName);
  let stat;
  try {
    stat = fs.lstatSync(categoryFolder);
  } catch (error) {
    return error.code === 'ENOENT'
      ? { path: categoryFolder, usable: true }
      : { path: parentDir, usable: false };
  }

  if (!stat.isDirectory() || stat.isSymbolicLink() || checkProjectBoundary(categoryFolder).isShielded) {
    return { path: parentDir, usable: false };
  }

  return { path: categoryFolder, usable: true };
}

function getSafeCategoryFolder(targetBaseDir, folderName) {
  return getSafeChildFolder(targetBaseDir, folderName).path;
}

function getCategoryFolderNames(category) {
  if (category.startsWith('Documents')) return ['Documents'];
  if (category.startsWith('Media/Images')) {
    const imageType = category.slice('Media/Images'.length).replace(/^\//, '');
    return ['Images', ...(imageType ? imageType.split('/') : [])];
  }
  if (category.startsWith('Media/Videos/Movies')) return ['Movies'];
  if (category.startsWith('Media/Videos/TV Shows')) return ['TV Shows'];
  if (category.startsWith('Media/Videos/Recordings')) return ['Recordings'];
  if (category.startsWith('Media/Videos/Clips')) return ['Clips'];
  if (category === 'Media/Videos') return ['Videos'];
  if (category.startsWith('Media/Audio/')) return [category.slice('Media/Audio/'.length)];
  if (category.startsWith('Archives')) return ['Archives'];
  if (category.startsWith('Executables')) return ['Applications'];
  return [];
}

function getSafeCategoryPath(targetBaseDir, folderNames) {
  let currentPath = targetBaseDir;
  for (const folderName of folderNames) {
    const result = getSafeChildFolder(currentPath, folderName);
    if (!result.usable) break;
    currentPath = result.path;
  }
  return currentPath;
}

async function getMusicMetadata(filePath) {
  try {
    const metadata = await parseFile(filePath, { duration: false, skipCovers: true });
    const common = metadata.common || {};
    return {
      artist: common.artist || common.albumartist || common.artists?.[0] || '',
      album: common.album || '',
      title: common.title || ''
    };
  } catch {
    return { artist: '', album: '', title: '' };
  }
}

function getFilenameArtist(fileName) {
  const stem = path.basename(fileName, path.extname(fileName));
  const match = stem.match(/^\s*(.+?)\s+-\s+(.+?)\s*$/);
  return match ? sanitizeFolderComponent(match[1]) : '';
}

function getFilenameTrackTitle(fileName) {
  const stem = path.basename(fileName, path.extname(fileName));
  const match = stem.match(/^\s*.+?\s+-\s+(.+?)\s*$/);
  return match ? match[1] : stem;
}

function getMusicTargetFolder(targetBaseDir, fileName, metadata) {
  const musicResult = getSafeChildFolder(targetBaseDir, 'Music');
  if (!musicResult.usable) return targetBaseDir;

  const musicFolder = musicResult.path;
  const artist = sanitizeFolderComponent(metadata.artist) || getFilenameArtist(fileName);
  if (!artist) return musicFolder;

  const artistResult = getSafeChildFolder(musicFolder, artist);
  if (!artistResult.usable) return musicFolder;

  const artistFolder = artistResult.path;
  if (!metadata.album || artistFolder === musicFolder) return artistFolder;

  const album = sanitizeFolderComponent(metadata.album);
  const title = normalizeFolderName(metadata.title || getFilenameTrackTitle(fileName));
  if (!album || normalizeFolderName(album) === title) return artistFolder;

  const albumFolder = sanitizeFolderComponent(`${album} - ${artist}`);
  if (!albumFolder) return artistFolder;
  return getSafeChildFolder(artistFolder, albumFolder).path;
}

function findExistingSeriesFolder(targetBaseDir, seriesName) {
  const normalizedSeriesName = normalizeFolderName(seriesName);
  if (!normalizedSeriesName) return targetBaseDir;

  const tvShowsFolder = getSafeCategoryFolder(targetBaseDir, 'TV Shows');
  const searchRoots = [...new Set([targetBaseDir, tvShowsFolder])];
  const matchingFolders = [];

  for (const searchRoot of searchRoots) {
    let entries;
    try {
      entries = fs.readdirSync(searchRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if ((entry.isDirectory() || entry.isSymbolicLink()) && normalizeFolderName(entry.name) === normalizedSeriesName) {
        const seriesFolder = path.join(searchRoot, entry.name);
        let stat;
        try {
          stat = fs.lstatSync(seriesFolder);
        } catch {
          matchingFolders.push({ path: seriesFolder, safe: false });
          continue;
        }

        const safe = stat.isDirectory() && !stat.isSymbolicLink() && !checkProjectBoundary(seriesFolder).isShielded;
        matchingFolders.push({ path: seriesFolder, safe });
      }
    }
  }

  if (matchingFolders.length === 1 && matchingFolders[0].safe) {
    return matchingFolders[0].path;
  }
  if (matchingFolders.length > 0) return tvShowsFolder;
  if (tvShowsFolder === targetBaseDir) return targetBaseDir;

  return path.join(tvShowsFolder, seriesName);
}

/**
 * Recursively scans directory while strictly respecting the Project Boundary Shield.
 * Strictly uses native `fs` and `path` modules.
 *
 * @param {string} rootDir - Starting directory to scan
 * @param {object} options
 * @param {boolean} options.recursive - Whether to traverse subdirectories (default: true)
 * @param {string} options.targetBaseDir - Target root folder for organized structure (default: rootDir)
 * @returns {{ files: Array, shieldedPaths: Array, totalScanned: number }}
 */
async function scanAndMap(rootDir, options = {}) {
  const recursive = options.recursive !== false;
  const targetBaseDir = options.targetBaseDir || rootDir;

  if (!fs.existsSync(rootDir)) {
    throw new Error(`Directory does not exist: ${rootDir}`);
  }

  const stat = fs.statSync(rootDir);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${rootDir}`);
  }

  const files = [];
  const shieldedPaths = [];
  let totalScanned = 0;

  // Track planned destination paths to handle collision within the same batch
  const plannedDestinations = new Map();

  function generateUniqueDestination(targetDir, fileName) {
    const ext = getFileExtension(fileName);
    const base = ext === '.tar.gz' 
      ? fileName.slice(0, -7) 
      : path.basename(fileName, path.extname(fileName));
    
    let candidateName = fileName;
    let candidatePath = path.join(targetDir, candidateName);
    let counter = 1;

    while (plannedDestinations.has(candidatePath) || fs.existsSync(candidatePath)) {
      candidateName = `${base} (${counter})${ext}`;
      candidatePath = path.join(targetDir, candidateName);
      counter++;
    }

    plannedDestinations.set(candidatePath, true);
    return { destinationPath: candidatePath, destinationFileName: candidateName };
  }

  async function traverse(currentDir, isRoot = false) {
    // Project Boundary Shield check (skip check for rootDir itself if user explicitly targeted it,
    // but check all child directories; or if rootDir itself is shielded, report it)
    if (!isRoot) {
      const shieldCheck = checkProjectBoundary(currentDir);
      if (shieldCheck.isShielded) {
        shieldedPaths.push({
          path: currentDir,
          reason: `Project boundary detected (${shieldCheck.matchedSignatures.join(', ')})`
        });
        return; // Abort traversing this folder immediately!
      }
    } else {
      // Check if root directory itself is a project root
      const rootShieldCheck = checkProjectBoundary(currentDir);
      if (rootShieldCheck.isShielded) {
        // If the root is a project folder, user may have intentionally selected it, but we log the warning
        shieldedPaths.push({
          path: currentDir,
          reason: `Root directory contains project signatures (${rootShieldCheck.matchedSignatures.join(', ')})`
        });
      }
    }

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      shieldedPaths.push({
        path: currentDir,
        reason: `Cannot read directory: ${err.message}`
      });
      return;
    }

    // Sort entries to process directories and files deterministically
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isSymbolicLink()) {
        // Ignore symlinks for safety
        continue;
      }

      if (entry.isDirectory()) {
        // Check if the directory name itself matches ignore list
        if (PROJECT_BOUNDARY_SIGNATURES.includes(entry.name)) {
          shieldedPaths.push({
            path: fullPath,
            reason: `Ignored developer environment folder (${entry.name})`
          });
          continue;
        }

        if (recursive) {
          await traverse(fullPath, false);
        }
      } else if (entry.isFile()) {
        totalScanned++;

        // Don't move developer signature files directly if at root
        if (PROJECT_BOUNDARY_SIGNATURES.includes(entry.name)) {
          continue;
        }

        const ext = getFileExtension(entry.name);
        if (EXTENSION_TO_CATEGORY[ext]) {
          try {
            const fileStat = fs.statSync(fullPath);
            let imageMeta = null;

            if (EXTENSION_TO_CATEGORY[ext].baseCategory === 'Media/Images') {
              imageMeta = getImageMetadata(fullPath, ext);
            }

            const classification = classifyFile(entry.name, ext, fileStat, imageMeta, path.dirname(fullPath));
            if (!classification) continue;

            const musicMetadata = classification.category === 'Media/Audio/Music'
              ? await getMusicMetadata(fullPath)
              : null;

            const categoryFolderNames = getCategoryFolderNames(classification.category);
            if (!categoryFolderNames.length) continue;

            const targetFolder = classification.seriesName
              ? findExistingSeriesFolder(targetBaseDir, classification.seriesName)
              : classification.category === 'Media/Audio/Music'
                ? getMusicTargetFolder(targetBaseDir, entry.name, musicMetadata || {})
                : getSafeCategoryPath(targetBaseDir, categoryFolderNames);
            const isAlreadyInDestination = path.resolve(currentDir) === path.resolve(targetFolder);
            if (isAlreadyInDestination) continue;

            const { destinationPath, destinationFileName } = generateUniqueDestination(targetFolder, entry.name);

            files.push({
              id: `file_${files.length + 1}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              fileName: entry.name,
              currentPath: fullPath,
              currentDir: currentDir,
              targetDir: targetFolder,
              destinationPath: destinationPath,
              destinationFileName: destinationFileName,
              category: classification.category,
              mimeType: classification.mime,
              extension: ext,
              size: fileStat.size,
              sizeFormatted: formatFileSize(fileStat.size),
              modifiedTime: fileStat.mtime.toISOString(),
              imageMeta: imageMeta,
              dimensionFormatted: imageMeta ? imageMeta.dimensionFormatted : null,
              ratioString: imageMeta ? imageMeta.ratioString : null,
              classificationReason: classification.reason,
              isAlreadyInDestination: false,
              selected: true
            });
          } catch (statErr) {
            // Ignore file if unreadable
          }
        }
      }
    }
  }

  await traverse(rootDir, true);

  return {
    rootDir,
    targetBaseDir,
    files,
    shieldedPaths,
    totalScanned,
    mappedCount: files.length
  };
}

/**
 * Moves confirmed files and returns execution report for transaction logging.
 *
 * @param {Array<{ currentPath: string, destinationPath: string, id?: string }>} itemsToMove
 * @returns {{ successful: Array, failed: Array, timestamp: string }}
 */
/**
 * Moves or copies confirmed files synchronously.
 *
 * @param {Array<{ currentPath: string, destinationPath: string, id?: string }>} itemsToMove
 * @param {object} [options]
 * @param {'move'|'copy'} [options.mode='move']
 * @returns {{ successful: Array, failed: Array, timestamp: string, mode: string }}
 */
function executeMoves(itemsToMove, options = {}) {
  const timestamp = new Date().toISOString();
  const successful = [];
  const failed = [];
  const mode = options.mode === 'copy' ? 'copy' : 'move';

  for (const item of itemsToMove) {
    const { currentPath, destinationPath } = item;

    try {
      if (!fs.existsSync(currentPath)) {
        failed.push({
          ...item,
          error: 'Source file does not exist'
        });
        continue;
      }

      // Check if source and destination are identical
      if (path.resolve(currentPath) === path.resolve(destinationPath)) {
        continue;
      }

      if (mode === 'copy') {
        copyFileNoReplace(currentPath, destinationPath);
      } else {
        moveFileNoReplace(currentPath, destinationPath);
      }

      successful.push({
        id: item.id || `op_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        fileName: item.fileName || path.basename(currentPath),
        originalPath: currentPath,
        newPath: destinationPath,
        category: item.category || 'Unknown',
        size: item.size || 0,
        movedAt: timestamp,
        action: mode
      });
    } catch (err) {
      failed.push({
        ...item,
        error: err.message,
        errorCode: err.code,
        canCopyInstead: err.canCopyInstead || err.code === 'EACCES' || err.code === 'EPERM'
      });
    }
  }

  return {
    successful,
    failed,
    timestamp,
    mode
  };
}

// Moves or copies files in batches so UI stays responsive
async function executeMovesAsync(itemsToMove, onProgress, options = {}) {
  const timestamp = new Date().toISOString();
  const successful = [];
  const failed = [];
  const total = itemsToMove.length;
  const mode = options.mode === 'copy' ? 'copy' : 'move';

  const explicitBatchSize = options.batchSize;
  const isAdaptive = options.adaptive !== false && !explicitBatchSize;

  let currentBatchSize = explicitBatchSize || (total > 100 ? 25 : Math.min(total, 50));
  const minBatchSize = 5;
  const maxBatchSize = 50;

  let processedCount = 0;
  let batchIndex = 0;

  while (processedCount < total) {
    batchIndex++;
    const batchLength = Math.min(currentBatchSize, total - processedCount);
    const batch = itemsToMove.slice(processedCount, processedCount + batchLength);
    const batchStartTime = Date.now();
    let batchFailedCount = 0;

    // Run up to 8 operations in parallel
    const concurrency = Math.min(8, batch.length);
    let itemIdx = 0;

    const worker = async () => {
      while (itemIdx < batch.length) {
        const index = itemIdx++;
        const item = batch[index];
        const { currentPath, destinationPath } = item;

        try {
          await fs.promises.access(currentPath, fs.constants.F_OK);

          if (path.resolve(currentPath) === path.resolve(destinationPath)) {
            continue;
          }

          if (mode === 'copy') {
            await copyFileNoReplaceAsync(currentPath, destinationPath);
          } else {
            await moveFileNoReplaceAsync(currentPath, destinationPath);
          }

          successful.push({
            id: item.id || `op_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            fileName: item.fileName || path.basename(currentPath),
            originalPath: currentPath,
            newPath: destinationPath,
            category: item.category || 'Unknown',
            size: item.size || 0,
            movedAt: timestamp,
            action: mode
          });
        } catch (err) {
          batchFailedCount++;
          let errorMsg = `${err.code || 'MOVE_ERROR'}: ${err.message}`;
          if (err.code === 'ENOENT') {
            errorMsg = 'Source file does not exist';
          } else if (err.code === 'EACCES' || err.code === 'EPERM') {
            errorMsg = `Permission denied: unable to remove source file from read-only directory. Tip: Use "Copy" mode. (${err.message})`;
          }

          failed.push({
            ...item,
            error: errorMsg,
            errorCode: err.code,
            canCopyInstead: err.canCopyInstead || err.code === 'EACCES' || err.code === 'EPERM'
          });
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    processedCount += batch.length;
    const batchDuration = Date.now() - batchStartTime;

    onProgress?.({
      completed: processedCount,
      total,
      successful: successful.length,
      failed: failed.length,
      batch: batchIndex,
      batchSize: batch.length,
      mode
    });

    // Adjust batch size if operations are slow or failing
    if (isAdaptive) {
      if (batchFailedCount > 0 || batchDuration > 1500) {
        currentBatchSize = Math.max(minBatchSize, Math.floor(currentBatchSize / 2));
        await new Promise(resolve => setTimeout(resolve, 25));
      } else if (batchDuration < 300 && currentBatchSize < maxBatchSize) {
        currentBatchSize = Math.min(maxBatchSize, currentBatchSize + 5);
      }
    }

    await new Promise(resolve => setImmediate(resolve));
  }

  return {
    successful,
    failed,
    timestamp,
    mode
  };
}

module.exports = {
  PROJECT_BOUNDARY_SIGNATURES,
  EXTENSION_TO_CATEGORY,
  checkProjectBoundary,
  getFileExtension,
  formatFileSize,
  scanAndMap,
  executeMoves,
  executeMovesAsync
};
