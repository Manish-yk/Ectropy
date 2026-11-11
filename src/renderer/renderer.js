// Ectropy UI Renderer Logic

// App State
let currentScanData = null;
let mappedFiles = [];
let sourceDirectory = '';
let targetDirectory = '';
let scanGeneration = 0;
let operationMode = 'move'; // 'move' | 'copy'
let lastFailedItems = [];

// DOM Elements
const inputSourceDir = document.getElementById('inputSourceDir');
const inputTargetDir = document.getElementById('inputTargetDir');
const btnBrowseSource = document.getElementById('btnBrowseSource');
const btnBrowseTarget = document.getElementById('btnBrowseTarget');
const btnResetTarget = document.getElementById('btnResetTarget');
const chkRecursive = document.getElementById('chkRecursive');
const btnScan = document.getElementById('btnScan');

const tableBodyPreview = document.getElementById('tableBodyPreview');
const chkHeaderSelect = document.getElementById('chkHeaderSelect');
const btnSelectAll = document.getElementById('btnSelectAll');
const btnDeselectAll = document.getElementById('btnDeselectAll');
const btnExecute = document.getElementById('btnExecute');
const badgeFileCount = document.getElementById('badgeFileCount');
const textSelectedSummary = document.getElementById('textSelectedSummary');
const textCategoryBreakdown = document.getElementById('textCategoryBreakdown');

const formatFilterBar = document.getElementById('formatFilterBar');
const formatFilterChips = document.getElementById('formatFilterChips');
const btnModeMove = document.getElementById('btnModeMove');
const btnModeCopy = document.getElementById('btnModeCopy');

const moveProgress = document.getElementById('moveProgress');
const moveProgressLabel = document.getElementById('moveProgressLabel');
const moveProgressCount = document.getElementById('moveProgressCount');
const moveProgressBar = document.getElementById('moveProgressBar');
const moveErrors = document.getElementById('moveErrors');
const moveErrorList = document.getElementById('moveErrorList');
const textErrorCount = document.getElementById('textErrorCount');
const btnCopyInstead = document.getElementById('btnCopyInstead');
const btnCopyMoveErrors = document.getElementById('btnCopyMoveErrors');
const btnClearMoveErrors = document.getElementById('btnClearMoveErrors');

const containerShieldedNotice = document.getElementById('containerShieldedNotice');
const textShieldedCount = document.getElementById('textShieldedCount');
const listShieldedFolders = document.getElementById('listShieldedFolders');

const drawerHistory = document.getElementById('drawerHistory');
const btnHistoryToggle = document.getElementById('btnHistoryToggle');
const btnCloseHistory = document.getElementById('btnCloseHistory');
const listHistory = document.getElementById('listHistory');

const btnMin = document.getElementById('btnMin');
const btnMax = document.getElementById('btnMax');
const btnClose = document.getElementById('btnClose');
const containerToast = document.getElementById('containerToast');
const undoDialog = document.getElementById('undoDialog');
const btnCancelUndo = document.getElementById('btnCancelUndo');
const btnConfirmUndo = document.getElementById('btnConfirmUndo');
let resolveUndoConfirmation = null;
let undoDialogPreviousFocus = null;

function updateMoveProgress(progress) {
  const total = Math.max(Number(progress?.total) || 0, 1);
  const completed = Math.min(Number(progress?.completed) || 0, total);
  const percent = completed / total;
  const isCopy = (progress?.mode || operationMode) === 'copy';
  const actionWord = isCopy ? 'Copy' : 'Move';
  const actionWordIng = isCopy ? 'Copying' : 'Moving';

  moveProgress?.classList.remove('hidden');
  if (moveProgressBar) {
    moveProgressBar.max = total;
    moveProgressBar.value = completed;
  }
  if (moveProgressCount) {
    moveProgressCount.textContent = `${completed} of ${progress?.total || 0}`;
  }
  if (moveProgressLabel) {
    const suffix = progress?.currentFile ? ` — ${progress.currentFile}` : '';
    if (completed >= total) {
      moveProgressLabel.textContent = progress?.failed
        ? `${actionWord} complete — ${progress.failed} failed`
        : `${actionWord} complete`;
    } else {
      const batchLabel = progress?.batch ? ` (batch ${progress.batch})` : '';
      moveProgressLabel.textContent = `${actionWordIng} files…${batchLabel}${suffix}`;
    }
  }
  moveProgress?.setAttribute('aria-valuenow', String(Math.round(percent * 100)));
}

window.electronAPI?.onMoveProgress?.(updateMoveProgress);

function renderMoveErrors(failed) {
  lastFailedItems = Array.isArray(failed) ? failed : [];
  if (!moveErrors || !moveErrorList) return;
  if (!lastFailedItems.length) {
    moveErrors.classList.add('hidden');
    moveErrorList.innerHTML = '';
    if (textErrorCount) textErrorCount.textContent = '';
    if (btnCopyInstead) btnCopyInstead.classList.add('hidden');
    return;
  }

  moveErrors.classList.remove('hidden');
  if (textErrorCount) {
    textErrorCount.textContent = `(${lastFailedItems.length} failed)`;
  }

  // Check for permission errors
  const hasPermError = lastFailedItems.some(file =>
    file.canCopyInstead || /permission denied|EACCES|EPERM|read-only/i.test(file.error || '')
  );
  if (btnCopyInstead) {
    btnCopyInstead.classList.toggle('hidden', !hasPermError);
  }

  moveErrorList.innerHTML = lastFailedItems.map(file =>
    `<div><strong>${escapeHtml(file.fileName || file.currentPath)}</strong><span>${escapeHtml(file.error || 'Unknown error')}</span></div>`
  ).join('');
}

btnClearMoveErrors?.addEventListener('click', () => renderMoveErrors([]));

btnCopyMoveErrors?.addEventListener('click', async () => {
  if (!lastFailedItems || lastFailedItems.length === 0) return;

  const errorReport = lastFailedItems.map(file =>
    `${file.fileName || file.currentPath}\n${file.error || 'Error'}`
  ).join('\n\n');

  let copied = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(errorReport);
      copied = true;
    }
  } catch {
    // Clipboard API failed or denied
  }

  if (!copied && typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = errorReport;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body?.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      copied = true;
    } catch {
      // execCommand fallback failed
    }
  }

  const originalContent = btnCopyMoveErrors.innerHTML;
  btnCopyMoveErrors.innerHTML = '<span class="button-icon" aria-hidden="true">✓</span> Copied!';
  setTimeout(() => {
    btnCopyMoveErrors.innerHTML = originalContent;
  }, 2000);
  showToast('Error details copied to clipboard.', 'info');
});

btnCopyInstead?.addEventListener('click', () => {
  if (!lastFailedItems.length) return;

  setOperationMode('copy');

  const failedPaths = new Set(lastFailedItems.map(f => f.currentPath));
  mappedFiles.forEach(file => {
    if (failedPaths.has(file.currentPath)) {
      file.selected = true;
    }
  });

  renderPreviewTable();
  updateSelectionSummary();
  showToast('Switched to Copy mode for failed files. Press "Copy files" to execute.', 'info', 5000);
});

function setOperationMode(mode) {
  operationMode = mode === 'copy' ? 'copy' : 'move';
  btnModeMove?.classList.toggle('is-active', operationMode === 'move');
  btnModeCopy?.classList.toggle('is-active', operationMode === 'copy');

  if (btnExecute) {
    btnExecute.innerHTML = operationMode === 'copy'
      ? '<span class="button-icon" aria-hidden="true">📋</span> Copy files'
      : '<span class="button-icon" aria-hidden="true">↗</span> Move files';
  }
  updateSelectionSummary();
}

btnModeMove?.addEventListener('click', () => setOperationMode('move'));
btnModeCopy?.addEventListener('click', () => setOperationMode('copy'));

function getFileFormat(fileName) {
  const name = fileName || '';
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === name.length - 1) return '(none)';
  return name.slice(dotIndex).toLowerCase();
}

function renderFormatFilters() {
  if (!formatFilterBar || !formatFilterChips) return;
  if (!mappedFiles || mappedFiles.length === 0) {
    formatFilterBar.classList.add('hidden');
    formatFilterChips.innerHTML = '';
    return;
  }

  const formatCounts = new Map();
  for (const file of mappedFiles) {
    const fmt = getFileFormat(file.fileName);
    formatCounts.set(fmt, (formatCounts.get(fmt) || 0) + 1);
  }

  const sortedFormats = Array.from(formatCounts.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedFormats.length === 0) {
    formatFilterBar.classList.add('hidden');
    formatFilterChips.innerHTML = '';
    return;
  }

  formatFilterBar.classList.remove('hidden');
  formatFilterChips.innerHTML = sortedFormats.map(([fmt, count]) => `
    <label class="format-chip" title="Toggle selection for ${escapeHtml(fmt)} files">
      <input type="checkbox" class="chk-format" data-format="${escapeHtml(fmt)}" checked>
      <span>${escapeHtml(fmt)}</span>
      <span class="format-count">(${count})</span>
    </label>
  `).join('');

  formatFilterChips.querySelectorAll('.chk-format').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const targetFmt = e.target.dataset.format;
      const isChecked = e.target.checked;
      mappedFiles.forEach(file => {
        if (getFileFormat(file.fileName) === targetFmt && !file.isAlreadyInDestination) {
          file.selected = isChecked;
        }
      });
      renderPreviewTable();
    });
  });
}

function syncFormatChips() {
  if (!formatFilterChips) return;
  const chipInputs = formatFilterChips.querySelectorAll('.chk-format');
  if (!chipInputs || chipInputs.length === 0) return;

  chipInputs.forEach(chk => {
    const fmt = chk.dataset.format;
    const filesOfFormat = mappedFiles.filter(f => getFileFormat(f.fileName) === fmt && !f.isAlreadyInDestination);
    const selectedCount = filesOfFormat.filter(f => f.selected).length;

    if (filesOfFormat.length > 0 && selectedCount === filesOfFormat.length) {
      chk.checked = true;
      chk.indeterminate = false;
    } else if (selectedCount === 0) {
      chk.checked = false;
      chk.indeterminate = false;
    } else {
      chk.checked = false;
      chk.indeterminate = true;
    }
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

// Window Controls
btnMin?.addEventListener('click', () => window.electronAPI?.minimizeWindow());
btnMax?.addEventListener('click', () => window.electronAPI?.maximizeWindow());
btnClose?.addEventListener('click', () => window.electronAPI?.closeWindow());

// Transaction History Drawer Toggle
btnHistoryToggle?.addEventListener('click', () => {
  setHistoryDrawerOpen(!drawerHistory.classList.contains('is-open'));
});

btnCloseHistory?.addEventListener('click', () => {
  setHistoryDrawerOpen(false, true);
});

function setHistoryDrawerOpen(isOpen, restoreFocus = false) {
  drawerHistory.classList.toggle('is-open', isOpen);
  drawerHistory.setAttribute('aria-hidden', String(!isOpen));
  drawerHistory.inert = !isOpen;
  btnHistoryToggle.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) {
    loadHistory();
  } else if (restoreFocus && btnHistoryToggle.isConnected) {
    btnHistoryToggle.focus();
  }
}

function getCategoryBadge(category) {
  return `<span class="type-badge">${escapeHtml(category.split('/').pop())}</span>`;
}

// Toast Notifications
function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} toast-entering`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const toastIcon = document.createElement('span');
  toastIcon.className = 'toast-icon';
  toastIcon.setAttribute('aria-hidden', 'true');
  toastIcon.textContent = ({ success: '✓', error: '!', warning: '!', info: '↗' })[type] || '•';

  const toastMessage = document.createElement('span');
  toastMessage.className = 'toast-message';
  toastMessage.textContent = message;
  toast.append(toastIcon, toastMessage);

  containerToast.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('toast-entering');
  });

  setTimeout(() => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

function closeUndoDialog(confirmed) {
  if (!resolveUndoConfirmation) return;

  const resolve = resolveUndoConfirmation;
  resolveUndoConfirmation = null;
  undoDialog.classList.remove('is-open');
  undoDialog.setAttribute('aria-hidden', 'true');
  undoDialog.inert = true;
  if (undoDialogPreviousFocus?.isConnected) undoDialogPreviousFocus.focus();
  undoDialogPreviousFocus = null;
  resolve(confirmed);
}

function requestUndoConfirmation() {
  return new Promise(resolve => {
    resolveUndoConfirmation = resolve;
    undoDialogPreviousFocus = document.activeElement;
    undoDialog.inert = false;
    undoDialog.classList.add('is-open');
    undoDialog.setAttribute('aria-hidden', 'false');
    btnCancelUndo.focus();
  });
}

btnCancelUndo?.addEventListener('click', () => closeUndoDialog(false));
btnConfirmUndo?.addEventListener('click', () => closeUndoDialog(true));
undoDialog?.addEventListener('click', event => {
  if (event.target === undoDialog) closeUndoDialog(false);
});

document.addEventListener('keydown', event => {
  if (!undoDialog.classList.contains('is-open')) {
    if (event.key === 'Escape' && drawerHistory.classList.contains('is-open')) {
      setHistoryDrawerOpen(false, true);
    }
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeUndoDialog(false);
  } else if (event.key === 'Tab') {
    const firstButton = btnCancelUndo;
    const lastButton = btnConfirmUndo;
    if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault();
      lastButton.focus();
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault();
      firstButton.focus();
    }
  }
});

// Directory Selectors
btnBrowseSource?.addEventListener('click', async () => {
  const res = await window.electronAPI.selectDirectory({ title: 'Select Source Directory to Organize' });
  if (!res.canceled && res.path) {
    sourceDirectory = res.path;
    inputSourceDir.value = res.path;
    if (!targetDirectory) {
      inputTargetDir.placeholder = res.path;
    }
    invalidatePreview();
    showToast(`Source selected: ${res.path}`, 'info');
  }
});

btnBrowseTarget?.addEventListener('click', async () => {
  const res = await window.electronAPI.selectDirectory({ title: 'Select Target Root Directory' });
  if (!res.canceled && res.path) {
    targetDirectory = res.path;
    inputTargetDir.value = res.path;
    btnResetTarget.classList.remove('hidden');
    invalidatePreview();
    showToast(`Custom destination selected: ${res.path}`, 'info');
  }
});

btnResetTarget?.addEventListener('click', () => {
  targetDirectory = '';
  inputTargetDir.value = '';
  inputTargetDir.placeholder = sourceDirectory || 'Same as source directory';
  btnResetTarget.classList.add('hidden');
  invalidatePreview();
  showToast('Destination reset to source root.', 'info');
});

chkRecursive?.addEventListener('change', invalidatePreview);

function invalidatePreview() {
  scanGeneration++;
  currentScanData = null;
  mappedFiles = [];
  renderFormatFilters();
  renderPreviewTable();
  renderShieldedNotice([]);
}

// Step 1: Scan & Map
btnScan?.addEventListener('click', async () => {
  if (!sourceDirectory) {
    showToast('Please select a source folder first.', 'warning');
    return;
  }

  const generation = scanGeneration;
  const scanSettings = {
    sourceDir: sourceDirectory,
    targetBaseDir: targetDirectory || sourceDirectory,
    recursive: chkRecursive.checked
  };
  btnScan.disabled = true;
  btnScan.textContent = 'Scanning…';

  try {
    const res = await window.electronAPI.scanAndMap(scanSettings);

    if (generation !== scanGeneration) return;

    if (!res.success) {
      showToast(`Scan failed: ${res.error}`, 'error');
      return;
    }

    currentScanData = res.data;
    mappedFiles = res.data.files || [];

    renderFormatFilters();
    renderPreviewTable();
    renderShieldedNotice(res.data.shieldedPaths || []);

    showToast(`Found ${mappedFiles.length} file(s) to organize.`, mappedFiles.length ? 'success' : 'info');
  } catch (err) {
    showToast(`Error scanning: ${err.message}`, 'error');
  } finally {
    btnScan.disabled = false;
    btnScan.textContent = '⌕ Scan & preview';
  }
});

// Shield Notice Rendering
function renderShieldedNotice(shieldedPaths) {
  if (!shieldedPaths || shieldedPaths.length === 0) {
    containerShieldedNotice.classList.add('hidden');
    return;
  }

  containerShieldedNotice.classList.remove('hidden');
  textShieldedCount.textContent = `${shieldedPaths.length} project folder(s) were shielded to prevent breaking code projects or modules.`;

  listShieldedFolders.innerHTML = shieldedPaths.map(s =>
    `<div title="${escapeHtml(s.path)}">${escapeHtml(s.path)} — ${escapeHtml(s.reason)}</div>`
  ).join('');
}

// Step 2: Render Interactive Preview Table
function renderPreviewTable() {
  if (!mappedFiles || mappedFiles.length === 0) {
    const emptyMessage = currentScanData
      ? 'No new files to organize. This folder may already be organized.'
      : 'Choose a source folder, then select Preview files.';
    tableBodyPreview.innerHTML = `<tr><td colspan="7" class="empty-state">${emptyMessage}</td></tr>`;
    badgeFileCount.textContent = '';
    btnExecute.disabled = true;
    updateSelectionSummary();
    return;
  }

  tableBodyPreview.innerHTML = mappedFiles.map((file, idx) => {
    return `
      <tr>
        <td class="select-column"><input type="checkbox" data-index="${idx}" class="item-checkbox" aria-label="Select ${escapeHtml(file.fileName)}" ${file.selected ? 'checked' : ''} ${file.isAlreadyInDestination ? 'disabled' : ''}></td>
        <td>${getCategoryBadge(file.category)}</td>
        <td class="file-name" title="${escapeHtml(file.fileName)}">${escapeHtml(file.fileName)}</td>
        <td class="file-reason" title="${escapeHtml(file.classificationReason || 'Pattern match')}">${escapeHtml(file.classificationReason || 'Pattern match')}${file.dimensionFormatted ? ` · ${escapeHtml(file.dimensionFormatted)} ${escapeHtml(file.ratioString || '')}` : ''}</td>
        <td>${escapeHtml(file.sizeFormatted)}</td>
        <td class="file-path" title="${escapeHtml(file.currentPath)}">${escapeHtml(file.currentPath)}</td>
        <td class="file-destination" title="${escapeHtml(file.destinationPath)}">${escapeHtml(file.destinationPath)}</td>
      </tr>
    `;
  }).join('');

  // Checkbox listeners
  document.querySelectorAll('.item-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index, 10);
      if (mappedFiles[index].isAlreadyInDestination) {
        e.target.checked = false;
        return;
      }
      mappedFiles[index].selected = e.target.checked;
      updateSelectionSummary();
    });
  });

  updateSelectionSummary();
}

// Summary bar calculations
function updateSelectionSummary() {
  const selectedCount = mappedFiles.filter(f => f.selected).length;
  textSelectedSummary.textContent = `${selectedCount} of ${mappedFiles.length} files selected to ${operationMode}`;

  if (selectedCount > 0) {
    badgeFileCount.textContent = `(${selectedCount} ${selectedCount === 1 ? 'file' : 'files'} selected)`;
  } else {
    badgeFileCount.textContent = '';
  }

  btnExecute.disabled = selectedCount === 0;

  if (selectedCount === mappedFiles.length && mappedFiles.length > 0) {
    chkHeaderSelect.checked = true;
    chkHeaderSelect.indeterminate = false;
  } else if (selectedCount === 0) {
    chkHeaderSelect.checked = false;
    chkHeaderSelect.indeterminate = false;
  } else {
    chkHeaderSelect.indeterminate = true;
  }

  const categoryCounts = {};
  for (const f of mappedFiles) {
    if (f.selected) {
      categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
    }
  }

  const breakdownBadges = Object.entries(categoryCounts).map(([cat, count]) =>
    `<span>${count} ${escapeHtml(cat.split('/').pop())}</span>`
  ).join(' · ');

  textCategoryBreakdown.innerHTML = breakdownBadges;
  syncFormatChips();
}

// Bulk Select / Deselect
chkHeaderSelect?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  mappedFiles.forEach(f => f.selected = checked && !f.isAlreadyInDestination);
  renderPreviewTable();
});

btnSelectAll?.addEventListener('click', () => {
  mappedFiles.forEach(f => f.selected = !f.isAlreadyInDestination);
  renderPreviewTable();
});

btnDeselectAll?.addEventListener('click', () => {
  mappedFiles.forEach(f => f.selected = false);
  renderPreviewTable();
});

// Step 3: Execute Moves & Save Transaction
btnExecute?.addEventListener('click', async () => {
  const selectedItems = mappedFiles.filter(f => f.selected);

  if (selectedItems.length === 0) {
    showToast(`No items selected to ${operationMode}.`, 'warning');
    return;
  }

  const isCopy = operationMode === 'copy';
  const actionVerb = isCopy ? 'Copy' : 'Move';
  const actionVerbIng = isCopy ? 'Copying' : 'Moving';

  btnExecute.disabled = true;
  btnExecute.textContent = `${actionVerbIng} files…`;
  renderMoveErrors([]);
  updateMoveProgress({ completed: 0, total: selectedItems.length, mode: operationMode });

  try {
    const res = await window.electronAPI.executeMoves({
      items: selectedItems,
      sourceDir: sourceDirectory,
      targetBaseDir: targetDirectory || sourceDirectory,
      mode: operationMode
    });

    if (!res.success) {
      showToast(`Execution failed: ${res.error}`, 'error');
      return;
    }

    const { successful, failed } = res.report;
    renderMoveErrors(failed);

    if (successful.length > 0) {
      const verbPast = isCopy ? 'Copied' : 'Moved';
      showToast(`${verbPast} ${successful.length} file(s). The changes are in move history.`, 'success', 5000);
    }

    if (failed.length > 0) {
      showToast(`Could not ${operationMode} ${failed.length} file(s). See the errors panel for details.`, 'error', 7000);
    }

    const successfulSources = new Set(successful.map(file => file.originalPath));
    if (isCopy) {
      // In copy mode, unselect successfully copied files
      mappedFiles.forEach(file => {
        if (successfulSources.has(file.currentPath)) {
          file.selected = false;
        }
      });
    } else {
      // In move mode, remove moved files from preview table
      mappedFiles = mappedFiles
        .filter(file => !successfulSources.has(file.currentPath))
        .map(file => ({ ...file, selected: false }));
    }
    renderFormatFilters();
    renderPreviewTable();

    if (drawerHistory.classList.contains('is-open')) {
      loadHistory();
    }
  } catch (err) {
    if (moveProgressLabel) moveProgressLabel.textContent = `${actionVerb} stopped`;
    showToast(`Error executing ${operationMode}: ${err.message}`, 'error');
  } finally {
    btnExecute.innerHTML = isCopy
      ? '<span class="button-icon" aria-hidden="true">📋</span> Copy files'
      : '<span class="button-icon" aria-hidden="true">↗</span> Move files';
    updateSelectionSummary();
  }
});

// Load Transaction History & Render Rollback Options
async function loadHistory() {
  listHistory.innerHTML = '<div class="history-loading">Loading move history…</div>';

  try {
    const res = await window.electronAPI.getHistory();
    if (!res.success || !res.history || res.history.length === 0) {
      listHistory.innerHTML = '<div class="history-empty">No moves to show yet.</div>';
      return;
    }

    listHistory.innerHTML = res.history.map(tx => {
      const isRolledBack = tx.status === 'rolled_back';
      const isPartial = tx.status === 'partially_rolled_back';
      const timeStr = new Date(tx.timestamp).toLocaleString();

      let statusBadge = '<span class="history-status">Completed</span>';
      if (isRolledBack) {
        statusBadge = '<span class="history-status rolled-back">Undone</span>';
      } else if (isPartial) {
        statusBadge = '<span class="history-status partial">Partially undone</span>';
      }

      return `
        <div class="history-card">
          <div class="history-card-top">
            <span class="history-date">${escapeHtml(timeStr)}</span>
            ${statusBadge}
          </div>
          <div class="history-count">${Number(tx.itemCount || tx.operations?.length || 0)} file(s) moved</div>
          <div class="history-path" title="${escapeHtml(tx.sourceDir)}">From: ${escapeHtml(tx.sourceDir)}</div>
          <div class="history-path" title="${escapeHtml(tx.targetBaseDir)}">To: ${escapeHtml(tx.targetBaseDir)}</div>
          ${!isRolledBack ? `
            <button data-txid="${escapeHtml(tx.id)}" class="btn-rollback button button-danger" type="button">Undo this move</button>
          ` : ''}
        </div>
      `;
    }).join('');

    listHistory.querySelectorAll('.btn-rollback').forEach(btn => {
      btn.addEventListener('click', async (event) => {
        const txId = event.currentTarget.dataset.txid;
        if (!await requestUndoConfirmation()) return;

        btn.disabled = true;
        btn.textContent = 'Restoring…';

        try {
          const result = await window.electronAPI.rollbackTransaction({ transactionId: txId });
          if (result.success) {
            showToast(`Restored ${result.restored.length} file(s).`, 'success');
            if (result.failed?.length) {
              showToast(`Some files could not be restored:\n${result.failed.map(file => `${file.fileName}: ${file.error}`).join('\n')}`, 'error', 10000);
            }
          } else {
            showToast(`Undo failed: ${result.error || result.message}`, 'error');
          }
          await loadHistory();
        } catch (err) {
          showToast(`Undo failed: ${err.message}`, 'error');
          await loadHistory();
        }
      });
    });
  } catch (err) {
    listHistory.innerHTML = `<div class="history-empty">Could not load history: ${escapeHtml(err.message)}</div>`;
  }
}
