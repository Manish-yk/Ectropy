const fs = require('fs');
const path = require('path');
const { moveFileNoReplace } = require('./fileMove');

/**
 * Manages local JSON transaction history and atomic undo / rollback operations.
 */
class HistoryManager {
  /**
   * @param {string} [storagePath] - Custom path to history.json. If omitted, defaults to app data or local directory.
   */
  constructor(storagePath) {
    this.storagePath = storagePath || path.join(__dirname, '..', '..', 'history.json');
    this.ensureHistoryFile();
  }

  /**
   * Ensures history file exists with valid JSON structure.
   */
  ensureHistoryFile() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(this.storagePath)) {
        fs.writeFileSync(this.storagePath, JSON.stringify({ transactions: [] }, null, 2), 'utf-8');
      } else {
        // Validate JSON content
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        try {
          JSON.parse(raw);
        } catch {
          fs.writeFileSync(this.storagePath, JSON.stringify({ transactions: [] }, null, 2), 'utf-8');
        }
      }
    } catch (err) {
      console.error('Error initializing history file:', err);
    }
  }

  /**
   * Reads all transactions from history.json.
   * @returns {Array<object>}
   */
  getHistory() {
    this.ensureHistoryFile();
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf-8');
      const data = JSON.parse(raw);
      return (data && Array.isArray(data.transactions)) ? data.transactions : [];
    } catch (err) {
      console.error('Failed to read history:', err);
      return [];
    }
  }

  /**
   * Logs a new sorting transaction to history.json.
   * @param {object} transactionData
   * @param {Array<object>} transactionData.operations - List of moved files with originalPath and newPath
   * @param {string} [transactionData.sourceDir]
   * @param {string} [transactionData.targetBaseDir]
   * @returns {object} The created transaction
   */
  logTransaction(transactionData) {
    this.ensureHistoryFile();
    const history = this.getHistory();

    const transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      status: 'completed', // 'completed' | 'rolled_back' | 'partially_rolled_back'
      mode: transactionData.mode || 'move', // 'move' | 'copy'
      sourceDir: transactionData.sourceDir || '',
      targetBaseDir: transactionData.targetBaseDir || '',
      itemCount: transactionData.operations.length,
      operations: transactionData.operations.map(op => ({
        id: op.id || `item_${Math.random().toString(36).substr(2, 6)}`,
        fileName: op.fileName || path.basename(op.newPath),
        originalPath: op.originalPath,
        newPath: op.newPath,
        category: op.category || 'General',
        size: op.size || 0,
        action: op.action || transactionData.mode || 'move',
        movedAt: op.movedAt || new Date().toISOString(),
        isReverted: false
      }))
    };

    history.unshift(transaction); // Most recent first

    fs.writeFileSync(this.storagePath, JSON.stringify({ transactions: history }, null, 2), 'utf-8');
    return transaction;
  }

  /**
   * Reverses file movements for a specified transaction, restoring files to original paths.
   * @param {string} transactionId
   * @returns {{ success: boolean, transaction: object, restored: Array, failed: Array, message: string }}
   */
  rollbackTransaction(transactionId) {
    this.ensureHistoryFile();
    const history = this.getHistory();
    const txIndex = history.findIndex(t => t.id === transactionId);

    if (txIndex === -1) {
      throw new Error(`Transaction with ID "${transactionId}" not found.`);
    }

    const tx = history[txIndex];
    if (tx.status === 'rolled_back') {
      throw new Error(`Transaction "${transactionId}" has already been completely rolled back.`);
    }

    const restored = [];
    const failed = [];

    for (const op of tx.operations) {
      if (op.isReverted) {
        continue;
      }

      const currentPath = op.newPath;
      const originalPath = op.originalPath;

      try {
        if (!fs.existsSync(currentPath)) {
          failed.push({
            ...op,
            error: `File not found at current path: ${currentPath}`
          });
          continue;
        }

        // For copy operations, rolling back simply deletes the copied file at destination
        if (op.action === 'copy' || tx.mode === 'copy') {
          fs.unlinkSync(currentPath);
          op.isReverted = true;
          op.revertedAt = new Date().toISOString();
          restored.push({
            ...op,
            restoredTo: '(copy removed)'
          });

          try {
            const currentDir = path.dirname(currentPath);
            if (fs.readdirSync(currentDir).length === 0) {
              fs.rmdirSync(currentDir);
            }
          } catch {
            // Ignore directory cleanup failure
          }
          continue;
        }

        const originalDir = path.dirname(originalPath);
        if (!fs.existsSync(originalDir)) {
          fs.mkdirSync(originalDir, { recursive: true });
        }

        // If target originalPath already exists, avoid overwriting
        if (fs.existsSync(originalPath) && path.resolve(currentPath) !== path.resolve(originalPath)) {
          failed.push({
            ...op,
            error: `Original destination already exists: ${originalPath}`
          });
          continue;
        }

        // Move back without replacing a file created since the transaction.
        moveFileNoReplace(currentPath, originalPath);
        op.isReverted = true;
        op.revertedAt = new Date().toISOString();

        restored.push({
          ...op,
          restoredTo: originalPath
        });

        // Optionally remove empty directory left behind
        try {
          const destDir = path.dirname(currentPath);
          const remaining = fs.readdirSync(destDir);
          if (remaining.length === 0) {
            fs.rmdirSync(destDir);
          }
        } catch {
          // Non-critical cleanup
        }
      } catch (err) {
        failed.push({
          ...op,
          error: err.message
        });
      }
    }

    // Update transaction overall status
    const allReverted = tx.operations.every(op => op.isReverted);
    const anyReverted = tx.operations.some(op => op.isReverted);

    if (allReverted) {
      tx.status = 'rolled_back';
      tx.rolledBackAt = new Date().toISOString();
    } else if (anyReverted) {
      tx.status = 'partially_rolled_back';
    }

    history[txIndex] = tx;
    fs.writeFileSync(this.storagePath, JSON.stringify({ transactions: history }, null, 2), 'utf-8');

    return {
      success: restored.length > 0,
      transaction: tx,
      restored,
      failed,
      message: `Restored ${restored.length} of ${tx.operations.length} file(s).`
    };
  }

  /**
   * Clears transaction history
   */
  clearHistory() {
    this.ensureHistoryFile();
    fs.writeFileSync(this.storagePath, JSON.stringify({ transactions: [] }, null, 2), 'utf-8');
    return { success: true };
  }
}

module.exports = HistoryManager;
