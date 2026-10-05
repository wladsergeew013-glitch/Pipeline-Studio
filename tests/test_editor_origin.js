'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createEditorURLValidator, isEditorSender } = require('../desktop/editor-origin.cjs');
const editor = path.resolve('Профиль коллеги # 100%', 'app.asar', 'ui', 'Pipeline-Studio.html');
const url = pathToFileURL(editor).href;
const accepts = createEditorURLValidator(editor);
const checks = [];
const check = (name, condition) => { assert(condition, name); checks.push(name); console.log('PASS', name); };
check('Encoded Unicode, spaces and literal percent refer to the bundled editor', accepts(url));
if (process.platform === 'win32') {
  check('A lowercase Windows drive still refers to the bundled editor', accepts(url.replace(/^file:\/\/\/[A-Z]:/, match => match.toLowerCase())));
  check('Windows file path casing does not change the trusted editor', accepts(pathToFileURL(editor.toUpperCase()).href));
} else {
  check('POSIX paths remain case sensitive', !accepts(pathToFileURL(editor.toUpperCase()).href));
}
for (const [label, candidate] of [
  ['a different local document', pathToFileURL(path.join(path.dirname(editor), 'Author.html')).href],
  ['a similarly named sibling', pathToFileURL(editor + '.html').href],
  ['HTTP content', 'https://example.invalid/Pipeline-Studio.html'],
  ['script URLs', 'javascript:alert(1)'],
  ['data URLs', 'data:text/html,editor'],
  ['a malformed escape', url.replace('100%25', '100%')],
  ['an encoded path separator', url.replace('Pipeline-Studio.html', '%2FPipeline-Studio.html')],
  ['query parameters', url + '?document=Author.html'],
  ['a fragment', url + '#frame'],
  ['a missing URL', undefined],
]) check('Editor rejects ' + label, !accepts(candidate));
const frame = { url };
const contents = { mainFrame: frame, isDestroyed: () => false };
check('The editor main frame can call the file bridge', isEditorSender({ sender: contents, senderFrame: frame }, contents, accepts));
check('A different window cannot call the file bridge', !isEditorSender({ sender: {}, senderFrame: frame }, contents, accepts));
check('A child frame with the same URL cannot call the file bridge', !isEditorSender({ sender: contents, senderFrame: { url } }, contents, accepts));
check('A missing sender frame cannot call the file bridge', !isEditorSender({ sender: contents }, contents, accepts));
frame.url = pathToFileURL(path.join(path.dirname(editor), 'Author.html')).href;
check('The main frame of another document cannot call the file bridge', !isEditorSender({ sender: contents, senderFrame: frame }, contents, accepts));
check('Destroyed windows cannot call the file bridge', !isEditorSender({ sender: contents, senderFrame: frame }, { ...contents, isDestroyed: () => true }, accepts));
console.log('TOTAL', checks.length);
