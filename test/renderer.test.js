const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '../src/renderer/index.html');
const rendererPath = path.join(__dirname, '../src/renderer/renderer.js');
const html = fs.readFileSync(htmlPath, 'utf8');
const rendererSource = fs.readFileSync(rendererPath, 'utf8');

class FakeElement {
  constructor(document, id = '') {
    this.ownerDocument = document;
    this.id = id;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.attributes = {};
    this.listeners = new Map();
    this.dataset = {};
    this.isConnected = true;
    this.inert = false;
    this.innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.rollbackButtonsHtml = null;
    this.rollbackButtons = [];
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  trigger(type, event = {}) {
    const dispatchedEvent = {
      target: this,
      currentTarget: this,
      preventDefault() { this.defaultPrevented = true; },
      ...event
    };
    return (this.listeners.get(type) || []).map(handler => handler(dispatchedEvent));
  }

  click() {
    return this.trigger('click');
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  append(...elements) {
    this.children.push(...elements);
  }

  appendChild(element) {
    this.children.push(element);
  }

  remove() {
    this.isConnected = false;
  }

  querySelectorAll(selector) {
    if (this.id !== 'listHistory' || selector !== '.btn-rollback') return [];
    if (this.rollbackButtonsHtml === this.innerHTML) return this.rollbackButtons;

    this.rollbackButtonsHtml = this.innerHTML;
    this.rollbackButtons = [...this.innerHTML.matchAll(/data-txid="([^"]+)"/g)].map((match) => {
      const button = new FakeElement(this.ownerDocument);
      button.dataset.txid = match[1];
      return button;
    });
    return this.rollbackButtons;
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  contains(className) {
    return this.element.className.split(/\s+/).includes(className);
  }

  add(className) {
    if (!this.contains(className)) {
      this.element.className = `${this.element.className} ${className}`.trim();
    }
  }

  remove(className) {
    this.element.className = this.element.className
      .split(/\s+/)
      .filter(existingClass => existingClass && existingClass !== className)
      .join(' ');
  }

  toggle(className, force) {
    const shouldAdd = force ?? !this.contains(className);
    if (shouldAdd) this.add(className);
    else this.remove(className);
    return shouldAdd;
  }
}

function createRenderer() {
  const document = {
    elements: new Map(),
    activeElement: null,
    listeners: new Map(),
    getElementById(id) {
      return this.elements.get(id) || null;
    },
    createElement() {
      return new FakeElement(this);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    },
    trigger(type, event = {}) {
      const dispatchedEvent = {
        preventDefault() { this.defaultPrevented = true; },
        ...event
      };
      return (this.listeners.get(type) || []).map(handler => handler(dispatchedEvent));
    }
  };

  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) {
    document.elements.set(id, new FakeElement(document, id));
  }

  const rollbackCalls = [];
  const window = {
    electronAPI: {
      async getHistory() {
        return {
          success: true,
          history: [{
            id: 'transaction-1',
            timestamp: '2026-01-01T00:00:00.000Z',
            status: 'completed',
            itemCount: 1,
            sourceDir: '/source',
            targetBaseDir: '/target'
          }]
        };
      },
      async rollbackTransaction({ transactionId }) {
        rollbackCalls.push(transactionId);
        return { success: true, restored: [{}] };
      }
    }
  };

  vm.runInNewContext(rendererSource, {
    document,
    window,
    Date,
    Set,
    String,
    Number,
    Object,
    Array,
    parseInt,
    requestAnimationFrame: callback => callback(),
    setTimeout: () => 1
  }, { filename: rendererPath });

  return { document, rollbackCalls };
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test('history drawer opens, closes accessibly, restores focus, and can reopen immediately', async () => {
  const { document } = createRenderer();
  const drawer = document.getElementById('drawerHistory');
  const toggle = document.getElementById('btnHistoryToggle');
  const close = document.getElementById('btnCloseHistory');

  toggle.click();
  await settlePromises();
  assert.equal(drawer.classList.contains('is-open'), true);
  assert.equal(drawer.getAttribute('aria-hidden'), 'false');
  assert.equal(drawer.inert, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');

  close.click();
  assert.equal(drawer.classList.contains('is-open'), false);
  assert.equal(drawer.getAttribute('aria-hidden'), 'true');
  assert.equal(drawer.inert, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, toggle);

  toggle.click();
  close.click();
  toggle.click();
  await settlePromises();
  assert.equal(drawer.classList.contains('is-open'), true);
  assert.equal(drawer.getAttribute('aria-hidden'), 'false');
});

test('undo dialog traps keyboard focus and Escape cancels while restoring focus', async () => {
  const { document, rollbackCalls } = createRenderer();
  document.getElementById('btnHistoryToggle').click();
  await settlePromises();
  const rollbackButton = document.getElementById('listHistory').querySelectorAll('.btn-rollback')[0];
  rollbackButton.focus();

  const [undoPromise] = rollbackButton.click();
  const dialog = document.getElementById('undoDialog');
  const cancel = document.getElementById('btnCancelUndo');
  const confirm = document.getElementById('btnConfirmUndo');
  assert.equal(dialog.classList.contains('is-open'), true);
  assert.equal(dialog.getAttribute('aria-hidden'), 'false');
  assert.equal(dialog.inert, false);
  assert.equal(document.activeElement, cancel);

  document.trigger('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(document.activeElement, confirm);
  document.trigger('keydown', { key: 'Tab' });
  assert.equal(document.activeElement, cancel);
  document.trigger('keydown', { key: 'Escape' });

  await undoPromise;
  assert.deepEqual(rollbackCalls, []);
  assert.equal(dialog.classList.contains('is-open'), false);
  assert.equal(dialog.getAttribute('aria-hidden'), 'true');
  assert.equal(dialog.inert, true);
  assert.equal(document.activeElement, rollbackButton);

  const [reopenedUndoPromise] = rollbackButton.click();
  assert.equal(dialog.classList.contains('is-open'), true);
  cancel.click();
  await reopenedUndoPromise;
  assert.deepEqual(rollbackCalls, []);
});

test('confirming the redesigned dialog proceeds with the selected rollback', async () => {
  const { document, rollbackCalls } = createRenderer();
  document.getElementById('btnHistoryToggle').click();
  await settlePromises();
  const rollbackButton = document.getElementById('listHistory').querySelectorAll('.btn-rollback')[0];
  rollbackButton.focus();
  const [rollbackPromise] = rollbackButton.click();

  document.getElementById('btnConfirmUndo').click();
  await rollbackPromise;

  assert.deepEqual(rollbackCalls, ['transaction-1']);
  assert.equal(document.getElementById('undoDialog').getAttribute('aria-hidden'), 'true');
  assert.equal(document.getElementById('undoDialog').inert, true);
  assert.equal(document.activeElement, rollbackButton);
});

test('UI elements reflect refined branding, aesthetic tagline, and selection-driven counter', () => {
  const { document } = createRenderer();
  const badgeFileCount = document.getElementById('badgeFileCount');

  // Verify elements requested for removal / update
  assert.equal(html.includes('brand-caption'), false, 'FILE ORGANIZER caption should be removed');
  assert.equal(html.includes('section-mark'), false, '01 section marker should be removed');
  assert.equal(html.includes('intro-art'), false, 'intro arrow box should be removed');
  assert.equal(html.includes('intro-tagline'), true, 'aesthetic tagline should be present');
  assert.equal(badgeFileCount.textContent, '', 'selection count should be empty initially');
});

test('Format filter chips, operation mode toggles, and error copy actions are rendered and interactive', () => {
  const { document } = createRenderer();
  const formatFilterBar = document.getElementById('formatFilterBar');
  const formatFilterChips = document.getElementById('formatFilterChips');
  const btnModeMove = document.getElementById('btnModeMove');
  const btnModeCopy = document.getElementById('btnModeCopy');
  const btnCopyMoveErrors = document.getElementById('btnCopyMoveErrors');
  const btnCopyInstead = document.getElementById('btnCopyInstead');
  const btnExecute = document.getElementById('btnExecute');

  assert.ok(formatFilterBar, 'Format filter bar exists');
  assert.ok(formatFilterChips, 'Format filter chips container exists');
  assert.ok(btnModeMove, 'Move mode button exists');
  assert.ok(btnModeCopy, 'Copy mode button exists');
  assert.ok(btnCopyMoveErrors, 'Copy errors button exists');
  assert.ok(btnCopyInstead, 'Copy instead button exists');

  // Test toggling operation mode to Copy
  btnModeCopy.click();
  assert.equal(btnModeCopy.classList.contains('is-active'), true);
  assert.equal(btnModeMove.classList.contains('is-active'), false);
  assert.match(btnExecute.innerHTML, /Copy files/);

  // Test toggling operation mode back to Move
  btnModeMove.click();
  assert.equal(btnModeMove.classList.contains('is-active'), true);
  assert.equal(btnModeCopy.classList.contains('is-active'), false);
  assert.match(btnExecute.innerHTML, /Move files/);
});