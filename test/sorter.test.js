const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { scanAndMap, executeMoves, executeMovesAsync, checkProjectBoundary } = require('../src/main/sorter');
const { getImageMetadata, classifyImageFile } = require('../src/main/imageAnalyzer');
const HistoryManager = require('../src/main/history');

function createDummyPngBuffer(width, height) {
  const buf = Buffer.alloc(33);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buf, 0);
  // IHDR length 13
  buf.writeUInt32BE(13, 8);
  // IHDR type
  Buffer.from('IHDR').copy(buf, 12);
  // Width & height
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // bit depth, color type, compression, filter, interlace
  buf.writeUInt8(8, 24);
  buf.writeUInt8(2, 25);
  buf.writeUInt8(0, 26);
  buf.writeUInt8(0, 27);
  buf.writeUInt8(0, 28);
  return buf;
}

function createId3Frame(id, value) {
  const data = Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')]);
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
}

function createId3Buffer({ artist, title, album }) {
  const frames = Buffer.concat([
    createId3Frame('TPE1', artist),
    createId3Frame('TIT2', title),
    createId3Frame('TALB', album)
  ]);
  const length = frames.length;
  const tagSize = Buffer.from([
    (length >> 21) & 0x7f,
    (length >> 14) & 0x7f,
    (length >> 7) & 0x7f,
    length & 0x7f
  ]);
  return Buffer.concat([Buffer.from('ID3\x03\x00\x00', 'binary'), tagSize, frames]);
}

function createTempDir(prefix = 'ectropy_test_') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

test('Project Boundary Shield detects signatures and ignores developer folders', async () => {
  const tempDir = createTempDir('shield_test_');

  try {
    const projectSubdir = path.join(tempDir, 'my_react_app');
    fs.mkdirSync(projectSubdir, { recursive: true });
    fs.writeFileSync(path.join(projectSubdir, 'package.json'), '{"name": "test"}');
    fs.writeFileSync(path.join(projectSubdir, 'secret.pdf'), 'content');

    const venvSubdir = path.join(tempDir, 'python_project', 'venv');
    fs.mkdirSync(venvSubdir, { recursive: true });
    fs.writeFileSync(path.join(venvSubdir, 'lib.txt'), 'content');

    const gitSubdir = path.join(tempDir, 'git_project', '.git');
    fs.mkdirSync(gitSubdir, { recursive: true });
    fs.writeFileSync(path.join(path.dirname(gitSubdir), 'code_doc.pdf'), 'content');

    const regularSubdir = path.join(tempDir, 'downloads');
    fs.mkdirSync(regularSubdir, { recursive: true });
    fs.writeFileSync(path.join(regularSubdir, 'invoice.pdf'), 'content');

    // Test checkProjectBoundary
    const shield1 = checkProjectBoundary(projectSubdir);
    assert.strictEqual(shield1.isShielded, true);
    assert.ok(shield1.matchedSignatures.includes('package.json'));

    const shield2 = checkProjectBoundary(regularSubdir);
    assert.strictEqual(shield2.isShielded, false);

    // Scan should shield my_react_app, python_project, git_project and only map regularSubdir/invoice.pdf
    const scanResult = await scanAndMap(tempDir);
    assert.strictEqual(scanResult.files.length, 1);
    assert.strictEqual(scanResult.files[0].fileName, 'invoice.pdf');
    assert.strictEqual(scanResult.files[0].category, 'Documents/Financial');

    assert.ok(scanResult.shieldedPaths.some(p => p.path.includes('my_react_app')));
    assert.ok(scanResult.shieldedPaths.some(p => p.path.includes('python_project') && p.reason.includes('venv')));
    assert.ok(scanResult.shieldedPaths.some(p => p.path.includes('git_project') && p.reason.includes('.git')));
  } finally {
    cleanupDir(tempDir);
  }
});

test('Scan & Map correctly classifies all target extensions and smart categories', async () => {
  const tempDir = createTempDir('classification_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    fs.mkdirSync(sourceDir, { recursive: true });
    const testFiles = [
      { name: 'general_doc.pdf', expectedCategory: 'Documents', expectedFolder: 'Documents' },
      { name: 'invoice_2026.pdf', expectedCategory: 'Documents/Financial', expectedFolder: 'Documents' },
      { name: 'my_resume.docx', expectedCategory: 'Documents/Resumes', expectedFolder: 'Documents' },
      { name: 'quarterly_report.docx', expectedCategory: 'Documents/Reports', expectedFolder: 'Documents' },
      { name: 'budget_tracker.xlsx', expectedCategory: 'Documents/Spreadsheets', expectedFolder: 'Documents' },
      { name: 'pitch_deck.pptx', expectedCategory: 'Documents/Presentations', expectedFolder: 'Documents' },
      { name: 'service_agreement.pdf', expectedCategory: 'Documents/Contracts', expectedFolder: 'Documents' },
      { name: 'quick_notes.txt', expectedCategory: 'Documents/Notes', expectedFolder: 'Documents' },
      { name: 'great_novel.epub', expectedCategory: 'Documents/Books', expectedFolder: 'Documents' },
      { name: 'song_track.mp3', expectedCategory: 'Media/Audio/Music', expectedFolder: 'Music' },
      { name: 'podcast_ep12.mp3', expectedCategory: 'Media/Audio/Podcasts', expectedFolder: 'Podcasts' },
      { name: 'voice_memo_01.m4a', expectedCategory: 'Media/Audio/Voice Notes', expectedFolder: 'Voice Notes' },
      { name: 'sfx_explosion.wav', expectedCategory: 'Media/Audio/Sound Effects', expectedFolder: 'Sound Effects' },
      { name: 'movie.1080p.bluray.mp4', expectedCategory: 'Media/Videos/Movies', expectedFolder: 'Movies' },
      { name: 'series.S01E04.mkv', expectedCategory: 'Media/Videos/TV Shows', expectedFolder: path.join('TV Shows', 'series') },
      { name: 'screen_recording_zoom.mp4', expectedCategory: 'Media/Videos/Recordings', expectedFolder: 'Recordings' },
      { name: 'tiktok_reel_clip.mp4', expectedCategory: 'Media/Videos/Clips', expectedFolder: 'Clips' },
      { name: 'photo.png', expectedCategory: 'Media/Images', expectedFolder: 'Images' },
      { name: 'vector.svg', expectedCategory: 'Media/Images', expectedFolder: 'Images' },
      { name: 'backup_system.zip', expectedCategory: 'Archives/Backups', expectedFolder: 'Archives' },
      { name: 'ubuntu_installer.iso', expectedCategory: 'Archives/Disk Images', expectedFolder: 'Archives' },
      { name: 'archive.tar.gz', expectedCategory: 'Archives', expectedFolder: 'Archives' },
      { name: 'setup.exe', expectedCategory: 'Executables/Windows', expectedFolder: 'Applications' },
      { name: 'app.AppImage', expectedCategory: 'Executables/Linux', expectedFolder: 'Applications' },
      { name: 'package.deb', expectedCategory: 'Executables/Linux', expectedFolder: 'Applications' },
      { name: 'installer.dmg', expectedCategory: 'Executables/macOS', expectedFolder: 'Applications' }
    ];

    for (const f of testFiles) {
      fs.writeFileSync(path.join(sourceDir, f.name), 'dummy content');
    }

    const scanResult = await scanAndMap(sourceDir, { targetBaseDir: tempDir });
    assert.strictEqual(scanResult.files.length, testFiles.length);

    for (const tf of testFiles) {
      const match = scanResult.files.find(f => f.fileName === tf.name);
      assert.ok(match, `File ${tf.name} should be mapped`);
      assert.strictEqual(match.category, tf.expectedCategory, `Category mismatch for ${tf.name}`);
      assert.strictEqual(path.dirname(match.destinationPath), path.join(tempDir, tf.expectedFolder));
    }
  } finally {
    cleanupDir(tempDir);
  }
});

test('Name collision handling creates unique destination filenames', async () => {
  const tempDir = createTempDir('collision_test_');

  try {
    const sub1 = path.join(tempDir, 'folder1');
    const sub2 = path.join(tempDir, 'folder2');
    fs.mkdirSync(sub1, { recursive: true });
    fs.mkdirSync(sub2, { recursive: true });

    fs.writeFileSync(path.join(sub1, 'document.pdf'), 'content 1');
    fs.writeFileSync(path.join(sub2, 'document.pdf'), 'content 2');

    const scanResult = await scanAndMap(tempDir);
    assert.strictEqual(scanResult.files.length, 2);

    const destPaths = scanResult.files.map(f => f.destinationPath);
    assert.notStrictEqual(destPaths[0], destPaths[1]);
    assert.ok(destPaths.some(p => p.endsWith('document.pdf')));
    assert.ok(destPaths.some(p => p.endsWith('document (1).pdf')));
    assert.ok(destPaths.every(destinationPath => path.dirname(destinationPath) === path.join(tempDir, 'Documents')));
  } finally {
    cleanupDir(tempDir);
  }
});

test('Series episodes reuse an existing normalized series folder across common naming styles', async () => {
  const tempDir = createTempDir('series_grouping_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    const targetDir = path.join(tempDir, 'library');
    const seriesDir = path.join(targetDir, 'mentalist');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(seriesDir, { recursive: true });

    const episodeNames = [
      'The.Mentalist.S01E01.Pilot.mkv',
      'The.Mentalist.S01E02.Red.Hair.and.Silver.Tape.720p.mkv',
      'The_Mentalist_1x03_Red_John.mkv',
      'The_Mentalist_Season_1_Episode_04.mkv',
      'The Mentalist - Episode 05 - Red.mkv',
      'The.Mentalist.S01.E06.mkv',
      'The.Mentalist.1x07.1080p.mkv',
      '[WEB-DL] The.Mentalist.S01E08.mkv',
      'The Mentalist - S01 E09.mkv',
      'The.Mentalist.S01E10.[Group].mkv'
    ];

    for (const episodeName of episodeNames) {
      fs.writeFileSync(path.join(sourceDir, episodeName), episodeName);
    }

    const scanResult = await scanAndMap(sourceDir, { targetBaseDir: targetDir });
    assert.equal(scanResult.files.length, episodeNames.length);
    for (const episode of scanResult.files) {
      assert.equal(episode.category, 'Media/Videos/TV Shows');
      assert.equal(path.dirname(episode.destinationPath), seriesDir,
        `${episode.fileName} should be grouped in the existing Mentalist folder`);
    }

    const moveResult = executeMoves(scanResult.files);
    assert.equal(moveResult.successful.length, episodeNames.length);
    assert.equal((await scanAndMap(sourceDir, { targetBaseDir: targetDir })).files.length, 0,
      'a repeated scan should find no files left in the source');
  } finally {
    cleanupDir(tempDir);
  }
});

test('Short Ep markers classify and group without treating ordinary numbers as series', async () => {
  const tempDir = createTempDir('short_episode_marker_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    fs.mkdirSync(sourceDir, { recursive: true });
    const episodeName = 'The.Mentalist.Ep_11.mkv';
    fs.writeFileSync(path.join(sourceDir, episodeName), 'episode');
    fs.writeFileSync(path.join(sourceDir, 'video_2024.mkv'), 'movie');

    const files = (await scanAndMap(sourceDir, { targetBaseDir: tempDir })).files;
    const episode = files.find(file => file.fileName === episodeName);
    const video = files.find(file => file.fileName === 'video_2024.mkv');

    assert.ok(episode);
    assert.equal(episode.category, 'Media/Videos/TV Shows');
    assert.equal(path.dirname(episode.destinationPath), path.join(tempDir, 'TV Shows', 'The Mentalist'));
    assert.ok(video);
    assert.equal(path.dirname(video.destinationPath), path.join(tempDir, 'Videos'));
  } finally {
    cleanupDir(tempDir);
  }
});

test('Ambiguous episode markers fall back to the TV Shows folder', async () => {
  const tempDir = createTempDir('series_fallback_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    fs.mkdirSync(sourceDir, { recursive: true });
    const episodeName = 'Season 1 Episode 2.mkv';
    fs.writeFileSync(path.join(sourceDir, episodeName), 'episode');

    const [episode] = (await scanAndMap(sourceDir, { targetBaseDir: tempDir })).files;
    assert.ok(episode);
    assert.equal(episode.category, 'Media/Videos/TV Shows');
    assert.equal(path.dirname(episode.destinationPath), path.join(tempDir, 'TV Shows'));
  } finally {
    cleanupDir(tempDir);
  }
});

test('Ambiguous or shielded series folders safely fall back to TV Shows', async () => {
  const tempDir = createTempDir('series_folder_safety_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    const ambiguousTarget = path.join(tempDir, 'ambiguous');
    const shieldedTarget = path.join(tempDir, 'shielded');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(path.join(ambiguousTarget, 'The Mentalist'), { recursive: true });
    fs.mkdirSync(path.join(ambiguousTarget, 'the-mentalist'), { recursive: true });
    fs.mkdirSync(path.join(shieldedTarget, 'The Mentalist'), { recursive: true });
    fs.writeFileSync(path.join(shieldedTarget, 'The Mentalist', 'package.json'), '{}');

    const episodeName = 'The.Mentalist.S01E01.Pilot.mkv';
    fs.writeFileSync(path.join(sourceDir, episodeName), 'episode');

    const [ambiguousPlan] = (await scanAndMap(sourceDir, { targetBaseDir: ambiguousTarget })).files;
    const [shieldedPlan] = (await scanAndMap(sourceDir, { targetBaseDir: shieldedTarget })).files;
    assert.equal(path.dirname(ambiguousPlan.destinationPath), path.join(ambiguousTarget, 'TV Shows'));
    assert.equal(path.dirname(shieldedPlan.destinationPath), path.join(shieldedTarget, 'TV Shows'));
  } finally {
    cleanupDir(tempDir);
  }
});

test('Series episodes reuse an existing folder inside TV Shows', async () => {
  const tempDir = createTempDir('nested_series_folder_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    const seriesDir = path.join(tempDir, 'TV Shows', 'The Mentalist');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(seriesDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'The.Mentalist.S01E01.Pilot.mkv'), 'episode');

    const [episode] = (await scanAndMap(sourceDir, { targetBaseDir: tempDir })).files;
    assert.equal(path.dirname(episode.destinationPath), seriesDir);
  } finally {
    cleanupDir(tempDir);
  }
});

test('Protected and symlinked category folders do not receive files', async () => {
  const tempDir = createTempDir('unsafe_category_folder_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    const protectedTarget = path.join(tempDir, 'protected-target');
    const linkedTarget = path.join(tempDir, 'linked-target');
    const outsideDir = path.join(tempDir, 'outside');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(path.join(protectedTarget, 'Images'), { recursive: true });
    fs.mkdirSync(path.join(protectedTarget, 'TV Shows'), { recursive: true });
    fs.mkdirSync(linkedTarget, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(protectedTarget, 'Images', 'package.json'), '{}');
    fs.writeFileSync(path.join(protectedTarget, 'TV Shows', 'package.json'), '{}');
    fs.symlinkSync(outsideDir, path.join(linkedTarget, 'Images'), 'dir');
    fs.writeFileSync(path.join(sourceDir, 'photo.png'), 'image');
    fs.writeFileSync(path.join(sourceDir, 'The.Mentalist.S01E01.Pilot.mkv'), 'episode');

    const protectedPlans = (await scanAndMap(sourceDir, { targetBaseDir: protectedTarget })).files;
    const linkedPlans = (await scanAndMap(sourceDir, { targetBaseDir: linkedTarget })).files;

    assert.equal(path.dirname(protectedPlans.find(file => file.fileName === 'photo.png').destinationPath), protectedTarget);
    assert.equal(path.dirname(protectedPlans.find(file => file.fileName.includes('.mkv')).destinationPath), protectedTarget);
    assert.equal(path.dirname(linkedPlans.find(file => file.fileName === 'photo.png').destinationPath), linkedTarget);
    assert.equal(fs.readdirSync(outsideDir).length, 0);
  } finally {
    cleanupDir(tempDir);
  }
});

test('Scanning the destination itself leaves sorted files in place and groups nested files', async () => {
  const tempDir = createTempDir('same_source_destination_test_');

  try {
    const seriesDir = path.join(tempDir, 'The Mentalist');
    const nestedDir = path.join(tempDir, 'incoming');
    const existingEpisode = path.join(seriesDir, 'The.Mentalist.S01E01.Pilot.mkv');
    const nestedEpisode = path.join(nestedDir, 'The.Mentalist.S01E02.Red.Hair.mkv');
    const documentsDir = path.join(tempDir, 'Documents');
    const topLevelDocument = path.join(documentsDir, 'already-here.pdf');
    const nestedDocument = path.join(nestedDir, 'move-to-root.pdf');
    fs.mkdirSync(seriesDir, { recursive: true });
    fs.mkdirSync(documentsDir, { recursive: true });
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(existingEpisode, 'existing episode');
    fs.writeFileSync(nestedEpisode, 'incoming episode');
    fs.writeFileSync(topLevelDocument, 'already in destination');
    fs.writeFileSync(nestedDocument, 'nested document');

    const scanResult = await scanAndMap(tempDir);
    assert.equal(scanResult.files.length, 2);
    assert.equal(path.dirname(scanResult.files.find(file => file.fileName === path.basename(nestedEpisode)).destinationPath), seriesDir);
    assert.equal(path.dirname(scanResult.files.find(file => file.fileName === path.basename(nestedDocument)).destinationPath), documentsDir);

    const moveResult = executeMoves(scanResult.files);
    assert.equal(moveResult.successful.length, 2);
    assert.equal(fs.readFileSync(existingEpisode, 'utf8'), 'existing episode');
    assert.equal(fs.readFileSync(topLevelDocument, 'utf8'), 'already in destination');
    assert.equal(fs.existsSync(path.join(seriesDir, path.basename(nestedEpisode))), true);
    assert.equal(fs.existsSync(path.join(documentsDir, path.basename(nestedDocument))), true);
    assert.equal((await scanAndMap(tempDir)).files.length, 0, 'a repeated scan should leave the sorted files alone');
  } finally {
    cleanupDir(tempDir);
  }
});

test('Move execution refuses to overwrite a destination created after preview', async () => {
  const tempDir = createTempDir('late_collision_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    const targetDir = path.join(tempDir, 'destination');
    fs.mkdirSync(sourceDir, { recursive: true });
    const sourcePath = path.join(sourceDir, 'invoice.pdf');
    fs.writeFileSync(sourcePath, 'original content');
    const [plannedFile] = (await scanAndMap(sourceDir, { targetBaseDir: targetDir })).files;
    fs.mkdirSync(path.dirname(plannedFile.destinationPath), { recursive: true });
    fs.writeFileSync(plannedFile.destinationPath, 'new destination content');

    const result = executeMoves([plannedFile]);
    assert.equal(result.successful.length, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'original content');
    assert.equal(fs.readFileSync(plannedFile.destinationPath, 'utf8'), 'new destination content');
  } finally {
    cleanupDir(tempDir);
  }
});

test('Cross-device move fallback also supports undo without overwriting files', async () => {
  const tempDir = createTempDir('cross_device_move_test_');
  const historyPath = path.join(tempDir, 'history.json');
  const originalLinkSync = fs.linkSync;

  try {
    const sourceDir = path.join(tempDir, 'source');
    const sourcePath = path.join(sourceDir, 'episode.mkv');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(sourcePath, 'episode content');

    fs.linkSync = () => {
      const error = new Error('simulated cross-device link');
      error.code = 'EXDEV';
      throw error;
    };

    const [plannedFile] = (await scanAndMap(sourceDir, { targetBaseDir: path.join(tempDir, 'target') })).files;
    const moveResult = executeMoves([plannedFile]);
    assert.equal(moveResult.successful.length, 1);
    assert.equal(fs.existsSync(sourcePath), false);

    const historyManager = new HistoryManager(historyPath);
    const transaction = historyManager.logTransaction({
      operations: moveResult.successful,
      sourceDir,
      targetBaseDir: path.join(tempDir, 'target')
    });
    const rollback = historyManager.rollbackTransaction(transaction.id);

    assert.equal(rollback.success, true);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'episode content');
  } finally {
    fs.linkSync = originalLinkSync;
    cleanupDir(tempDir);
  }
});

test('Execute moves confirmed files and HistoryManager performs perfect rollback', async () => {
  const tempDir = createTempDir('exec_rollback_test_');
  const historyPath = path.join(tempDir, 'test_history.json');

  try {
    const sourceDir = path.join(tempDir, 'unorganized');
    const targetDir = path.join(tempDir, 'organized');
    fs.mkdirSync(sourceDir, { recursive: true });

    const file1 = path.join(sourceDir, 'sample.pdf');
    const file2 = path.join(sourceDir, 'photo.jpg');
    fs.writeFileSync(file1, 'PDF content');
    fs.writeFileSync(file2, 'JPG content');

    const historyManager = new HistoryManager(historyPath);

    // Step 1: Scan & Map
    const scanResult = await scanAndMap(sourceDir, { targetBaseDir: targetDir });
    assert.strictEqual(scanResult.files.length, 2);

    // Step 2: Simulate Preview & confirmation
    const itemsToMove = scanResult.files;

    // Step 3: Execute & Log
    const execResult = executeMoves(itemsToMove);
    assert.strictEqual(execResult.successful.length, 2);
    assert.strictEqual(execResult.failed.length, 0);

    // Verify files moved to target directories
    assert.strictEqual(fs.existsSync(file1), false);
    assert.strictEqual(fs.existsSync(file2), false);

    const destPdf = path.join(targetDir, 'Documents', 'sample.pdf');
    const destJpg = path.join(targetDir, 'Images', 'photo.jpg');

    assert.strictEqual(fs.existsSync(destPdf), true);
    assert.strictEqual(fs.existsSync(destJpg), true);
    assert.strictEqual(fs.readFileSync(destPdf, 'utf-8'), 'PDF content');
    assert.strictEqual(fs.readFileSync(destJpg, 'utf-8'), 'JPG content');

    // Log transaction
    const tx = historyManager.logTransaction({
      operations: execResult.successful,
      sourceDir,
      targetBaseDir: targetDir
    });

    const historyList = historyManager.getHistory();
    assert.strictEqual(historyList.length, 1);
    assert.strictEqual(historyList[0].id, tx.id);
    assert.strictEqual(historyList[0].status, 'completed');

    // Step 4: Transaction Rollback (Undo)
    const rollbackResult = historyManager.rollbackTransaction(tx.id);
    assert.strictEqual(rollbackResult.success, true);
    assert.strictEqual(rollbackResult.restored.length, 2);

    // Verify files restored back to original paths
    assert.strictEqual(fs.existsSync(file1), true);
    assert.strictEqual(fs.existsSync(file2), true);
    assert.strictEqual(fs.readFileSync(file1, 'utf-8'), 'PDF content');
    assert.strictEqual(fs.readFileSync(file2, 'utf-8'), 'JPG content');

    // Verify history status updated
    const updatedHistory = historyManager.getHistory();
    assert.strictEqual(updatedHistory[0].status, 'rolled_back');
  } finally {
    cleanupDir(tempDir);
  }
});

test('Smart Image Analysis accurately detects Wallpapers, Screenshots, Pinterest, and Memes', async () => {
  const tempDir = createTempDir('image_analysis_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    fs.mkdirSync(sourceDir, { recursive: true });
    // 1. High-res Desktop Wallpaper (1920x1080)
    const wallpaperPng = path.join(sourceDir, 'nature_scenery.png');
    fs.writeFileSync(wallpaperPng, createDummyPngBuffer(1920, 1080));

    // 2. 4K Wallpaper (3840x2160)
    const wallpaper4k = path.join(sourceDir, 'cyberpunk_city.png');
    fs.writeFileSync(wallpaper4k, createDummyPngBuffer(3840, 2160));

    // 3. Mobile Wallpaper (1080x2400)
    const mobileWall = path.join(sourceDir, 'phone_art.png');
    fs.writeFileSync(mobileWall, createDummyPngBuffer(1080, 2400));

    // 4. Wallpaper by keyword
    const keywordWall = path.join(sourceDir, 'dark_amoled_wallpaper.png');
    fs.writeFileSync(keywordWall, createDummyPngBuffer(800, 600));

    // 5. Screenshot by OS pattern
    const screenshot1 = path.join(sourceDir, 'Screenshot 2024-05-12 14.30.00.png');
    fs.writeFileSync(screenshot1, createDummyPngBuffer(1920, 1080));

    // 6. Screenshot by cleanshot / snip
    const screenshot2 = path.join(sourceDir, 'CleanShot_2024.png');
    fs.writeFileSync(screenshot2, createDummyPngBuffer(1200, 800));

    // 7. Pinterest pin by aspect ratio (736x1104, 2:3 vertical pin)
    const pinterestPin = path.join(sourceDir, 'aesthetic_outfit.png');
    fs.writeFileSync(pinterestPin, createDummyPngBuffer(736, 1104));

    // 8. Pinterest image by hash name (e.g. 32-char hex)
    const pinterestHash = path.join(sourceDir, 'a1b2c3d4e5f60718293a4b5c6d7e8f90.png');
    fs.writeFileSync(pinterestHash, createDummyPngBuffer(600, 800));

    // 9. Meme keyword
    const memeFile = path.join(sourceDir, 'funny_cat_meme.png');
    fs.writeFileSync(memeFile, createDummyPngBuffer(500, 500));

    // 10. General standard image
    const regularImage = path.join(sourceDir, 'profile_avatar.png');
    fs.writeFileSync(regularImage, createDummyPngBuffer(400, 400));

    const scanResult = await scanAndMap(sourceDir, { targetBaseDir: tempDir });
    assert.strictEqual(scanResult.files.length, 10);

    const findFile = (name) => scanResult.files.find(f => f.fileName === name);

    // Assertions
    assert.strictEqual(findFile('nature_scenery.png').category, 'Media/Images/Wallpapers');
    assert.strictEqual(findFile('cyberpunk_city.png').category, 'Media/Images/Wallpapers');
    assert.strictEqual(findFile('phone_art.png').category, 'Media/Images/Wallpapers');
    assert.strictEqual(findFile('dark_amoled_wallpaper.png').category, 'Media/Images/Wallpapers');

    assert.strictEqual(findFile('Screenshot 2024-05-12 14.30.00.png').category, 'Media/Images/Screenshots');
    assert.strictEqual(findFile('CleanShot_2024.png').category, 'Media/Images/Screenshots');

    assert.strictEqual(findFile('aesthetic_outfit.png').category, 'Media/Images/Pinterest');
    assert.strictEqual(findFile('a1b2c3d4e5f60718293a4b5c6d7e8f90.png').category, 'Media/Images/Pinterest');
    assert.strictEqual(findFile('funny_cat_meme.png').category, 'Media/Images/Pinterest');

    assert.strictEqual(findFile('profile_avatar.png').category, 'Media/Images');

    assert.equal(path.dirname(findFile('nature_scenery.png').destinationPath), path.join(tempDir, 'Images', 'Wallpapers'));
    assert.equal(path.dirname(findFile('Screenshot 2024-05-12 14.30.00.png').destinationPath), path.join(tempDir, 'Images', 'Screenshots'));
    assert.equal(path.dirname(findFile('aesthetic_outfit.png').destinationPath), path.join(tempDir, 'Images', 'Pinterest'));
    assert.equal(path.dirname(findFile('profile_avatar.png').destinationPath), path.join(tempDir, 'Images'));

    // Check metadata fields
    const wallItem = findFile('nature_scenery.png');
    assert.strictEqual(wallItem.dimensionFormatted, '1920×1080');
    assert.strictEqual(wallItem.ratioString, '16:9');
  } finally {
    cleanupDir(tempDir);
  }
});

test('Music uses artist folders, album folders, and filename fallbacks', async () => {
  const tempDir = createTempDir('music_grouping_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    const targetDir = path.join(tempDir, 'library');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'Ado - New Genesis.mp3'), createId3Buffer({
      artist: 'Ado', title: 'New Genesis', album: 'Kyougen'
    }));
    fs.writeFileSync(path.join(sourceDir, 'Ado - Usseewa.mp3'), createId3Buffer({
      artist: 'Ado', title: 'Usseewa', album: 'Usseewa'
    }));
    fs.writeFileSync(path.join(sourceDir, 'Ado - Value.mp3'), createId3Buffer({
      artist: 'Ado', title: 'Value', album: 'Zanmu'
    }));
    fs.writeFileSync(path.join(sourceDir, 'YOASOBI - Idol.mp3'), 'not valid audio metadata');

    const scanResult = await scanAndMap(sourceDir, { targetBaseDir: targetDir });
    const destinationFor = (fileName) => scanResult.files.find(file => file.fileName === fileName).destinationPath;

    assert.equal(destinationFor('Ado - New Genesis.mp3'), path.join(targetDir, 'Music', 'Ado', 'Kyougen - Ado', 'Ado - New Genesis.mp3'));
    assert.equal(destinationFor('Ado - Usseewa.mp3'), path.join(targetDir, 'Music', 'Ado', 'Ado - Usseewa.mp3'));
    assert.equal(destinationFor('Ado - Value.mp3'), path.join(targetDir, 'Music', 'Ado', 'Zanmu - Ado', 'Ado - Value.mp3'));
    assert.equal(destinationFor('YOASOBI - Idol.mp3'), path.join(targetDir, 'Music', 'YOASOBI', 'YOASOBI - Idol.mp3'));
  } finally {
    cleanupDir(tempDir);
  }
});

test('Music albums and image source folders safely fall back around protected paths', async () => {
  const tempDir = createTempDir('nested_category_safety_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    const targetDir = path.join(tempDir, 'library');
    const protectedAlbum = path.join(targetDir, 'Music', 'Ado', 'Kyougen - Ado');
    const imagesDir = path.join(targetDir, 'Images');
    const outsideDir = path.join(tempDir, 'outside');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(protectedAlbum, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(protectedAlbum, 'package.json'), '{}');
    fs.symlinkSync(outsideDir, path.join(imagesDir, 'WhatsApp'), 'dir');
    fs.writeFileSync(path.join(sourceDir, 'Ado - New Genesis.mp3'), createId3Buffer({
      artist: 'Ado', title: 'New Genesis', album: 'Kyougen'
    }));
    const imagePath = path.join(sourceDir, 'WhatsApp Images', 'photo.png');
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, createDummyPngBuffer(400, 400));

    const { files } = await scanAndMap(sourceDir, { targetBaseDir: targetDir });
    const albumTrack = files.find(file => file.fileName === 'Ado - New Genesis.mp3');
    const sourcedImage = files.find(file => file.fileName === 'photo.png');

    assert.equal(path.dirname(albumTrack.destinationPath), path.join(targetDir, 'Music', 'Ado'));
    assert.equal(path.dirname(sourcedImage.destinationPath), imagesDir);
    assert.equal(fs.readdirSync(outsideDir).length, 0);
  } finally {
    cleanupDir(tempDir);
  }
});

test('Images from identified source folders and screenshots get distinct folders', async () => {
  const tempDir = createTempDir('image_source_grouping_test_');

  try {
    const sourceDir = path.join(tempDir, 'incoming');
    const targetDir = path.join(tempDir, 'library');
    const files = [
      ['Screenshots', 'screen-1.png', 'Screenshots'],
      ['WhatsApp Images', 'photo.png', 'WhatsApp'],
      [path.join('DCIM', 'Camera'), 'IMG_0001.png', 'Camera'],
      ['Telegram', 'photo.png', 'Telegram']
    ];

    for (const [folder, fileName] of files) {
      const filePath = path.join(sourceDir, folder, fileName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, createDummyPngBuffer(400, 400));
    }

    const scanResult = await scanAndMap(sourceDir, { targetBaseDir: targetDir });
    for (const [folder, fileName, expectedCategory] of files) {
      const plannedFile = scanResult.files.find(file => file.fileName === fileName && file.currentPath.includes(folder));
      assert.ok(plannedFile, `${fileName} from ${folder} should be included`);
      assert.equal(path.dirname(plannedFile.destinationPath), path.join(targetDir, 'Images', expectedCategory));
    }
  } finally {
    cleanupDir(tempDir);
  }
});

test('HistoryManager rolls back copy transactions by removing destination copies', () => {
  const tempDir = createTempDir('history_copy_rollback_test_');
  const historyPath = path.join(tempDir, 'history.json');
  const manager = new HistoryManager(historyPath);

  try {
    const sourcePath = path.join(tempDir, 'source.txt');
    const destPath = path.join(tempDir, 'dest.txt');
    fs.writeFileSync(sourcePath, 'original source content');
    fs.writeFileSync(destPath, 'copied content');

    const tx = manager.logTransaction({
      mode: 'copy',
      sourceDir: tempDir,
      targetBaseDir: tempDir,
      operations: [{
        originalPath: sourcePath,
        newPath: destPath,
        fileName: 'dest.txt',
        action: 'copy'
      }]
    });

    const rollbackResult = manager.rollbackTransaction(tx.id);
    assert.equal(rollbackResult.success, true);
    assert.equal(fs.existsSync(sourcePath), true);
    assert.equal(fs.existsSync(destPath), false);
  } finally {
    cleanupDir(tempDir);
  }
});

test('executeMovesAsync handles copy mode and adaptive batching', async () => {
  const tempDir = createTempDir('async_moves_test_');
  try {
    const items = [];
    for (let i = 0; i < 15; i++) {
      const src = path.join(tempDir, `src_${i}.txt`);
      const dest = path.join(tempDir, 'out', `dest_${i}.txt`);
      fs.writeFileSync(src, `file content ${i}`);
      items.push({ currentPath: src, destinationPath: dest, fileName: `src_${i}.txt` });
    }

    const progressReports = [];
    const report = await executeMovesAsync(items, (p) => progressReports.push(p), { mode: 'copy', batchSize: 5 });

    assert.equal(report.successful.length, 15);
    assert.equal(report.failed.length, 0);
    assert.equal(report.mode, 'copy');
    assert.ok(progressReports.length >= 3);
    assert.equal(fs.existsSync(items[0].currentPath), true);
    assert.equal(fs.existsSync(items[0].destinationPath), true);
  } finally {
    cleanupDir(tempDir);
  }
});
