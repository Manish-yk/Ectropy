const fs = require('fs');
const path = require('path');

const LINK_FALLBACK_ERRORS = new Set(['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK']);

function copyFileNoReplace(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
}

async function copyFileNoReplaceAsync(sourcePath, destinationPath) {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.promises.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
}

function moveFileNoReplace(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

  try {
    fs.linkSync(sourcePath, destinationPath);
  } catch (error) {
    if (error.code === 'EEXIST' || !LINK_FALLBACK_ERRORS.has(error.code)) {
      throw error;
    }

    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  }

  try {
    fs.unlinkSync(sourcePath);
  } catch (unlinkError) {
    // Try chmod if delete fails due to permissions
    if (unlinkError.code === 'EACCES' || unlinkError.code === 'EPERM') {
      try {
        fs.chmodSync(path.dirname(sourcePath), 0o777);
        fs.chmodSync(sourcePath, 0o666);
        fs.unlinkSync(sourcePath);
        return;
      } catch {
        // Ignore chmod failure
      }
    }

    try {
      fs.unlinkSync(destinationPath);
    } catch {
      // Keep the original move error if cleanup is not possible.
    }

    if (unlinkError.code === 'EACCES' || unlinkError.code === 'EPERM') {
      const err = new Error(`Permission denied deleting source file '${path.basename(sourcePath)}'. Source folder is read-only. Use "Copy" mode to sort files without deleting source.`);
      err.code = unlinkError.code;
      err.canCopyInstead = true;
      throw err;
    }

    throw unlinkError;
  }
}

async function moveFileNoReplaceAsync(sourcePath, destinationPath) {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

  try {
    await fs.promises.link(sourcePath, destinationPath);
  } catch (error) {
    if (error.code === 'EEXIST' || !LINK_FALLBACK_ERRORS.has(error.code)) {
      throw error;
    }

    await fs.promises.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  }

  try {
    await fs.promises.unlink(sourcePath);
  } catch (unlinkError) {
    // Try chmod if delete fails due to permissions
    if (unlinkError.code === 'EACCES' || unlinkError.code === 'EPERM') {
      try {
        await fs.promises.chmod(path.dirname(sourcePath), 0o777);
        await fs.promises.chmod(sourcePath, 0o666);
        await fs.promises.unlink(sourcePath);
        return;
      } catch {
        // Ignore chmod failure
      }
    }

    try {
      await fs.promises.unlink(destinationPath);
    } catch {
      // Keep the original move error if cleanup is not possible.
    }

    if (unlinkError.code === 'EACCES' || unlinkError.code === 'EPERM') {
      const err = new Error(`Permission denied deleting source file '${path.basename(sourcePath)}'. Source folder is read-only. Use "Copy" mode to sort files without deleting source.`);
      err.code = unlinkError.code;
      err.canCopyInstead = true;
      throw err;
    }

    throw unlinkError;
  }
}

module.exports = {
  copyFileNoReplace,
  copyFileNoReplaceAsync,
  moveFileNoReplace,
  moveFileNoReplaceAsync
};
