'use strict';
const path = require('node:path');
const { fileURLToPath } = require('node:url');

function createEditorURLValidator(editorPath) {
  const normalize = value => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const expected = normalize(editorPath);
  return raw => {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'file:' || url.search || url.hash) return false;
      return normalize(fileURLToPath(url)) === expected;
    } catch {
      return false;
    }
  };
}

function isEditorSender(event, contents, isEditorURL) {
  return Boolean(contents && !contents.isDestroyed() && event?.sender === contents &&
    event.senderFrame && event.senderFrame === contents.mainFrame && isEditorURL(event.senderFrame.url));
}

module.exports = { createEditorURLValidator, isEditorSender };
