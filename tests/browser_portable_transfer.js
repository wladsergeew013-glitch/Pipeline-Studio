'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { spawn, execFileSync } = require('node:child_process');
const { playwright } = require('./browser_runtime');
const root = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const original = process.env.STUDIO_PORTABLE_EXE || path.join(root, 'desktop/dist', `Pipeline-Studio-${version}-x64.exe`);
const diagnose = process.argv.includes('--diagnose');
const startupTimeout = Number(process.env.STUDIO_PORTABLE_STARTUP_TIMEOUT || 45000);
assert(Number.isFinite(startupTimeout) && startupTimeout > 0, 'Invalid portable startup timeout');
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
const fixture = fs.mkdtempSync(path.join(root, 'qa/portable-transfer-'));
// Exercise the launcher's normal Windows runtime environment independently
// from delivery-folder synchronization, while keeping EXE/HTML in that folder.
const runtimeFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-portable-runtime-'));
const delivery = path.join(fixture, 'Другой компьютер', 'dist');
fs.mkdirSync(delivery, { recursive: true });
const exe = path.join(delivery, path.basename(original));
fs.copyFileSync(original, exe);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const payloadFiles = new Map([
  ['main.cjs', 'desktop/main.cjs'],
  ['preload.cjs', 'desktop/preload.cjs'],
  ['file-bridge.cjs', 'desktop/file-bridge.cjs'],
  ['editor-origin.cjs', 'desktop/editor-origin.cjs'],
  ['ui/Pipeline-Studio.html', 'Pipeline-Studio.html'],
]);

function verifyPortablePayload(uiURL) {
  const { extractFile } = require('../desktop/node_modules/@electron/asar');
  const archive = path.dirname(path.dirname(fileURLToPath(uiURL)));
  assert.equal(path.basename(archive), 'app.asar');
  const payload = {};
  for (const [entry, source] of payloadFiles) {
    const bytes = extractFile(archive, entry);
    assert(bytes.equals(fs.readFileSync(path.join(root, source))), 'Packaged source differs: ' + source);
    payload[entry] = hash(bytes);
  }
  return { appAsarSha256: hash(fs.readFileSync(archive)), payload };
}

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function inspector(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextID = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  return {
    async evaluate(expression) {
      const id = ++nextID;
      const reply = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      const result = await reply;
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    close() { socket.close(); },
  };
}

async function runCase(label, lowerDrive = false) {
  const base = path.join(runtimeFixture, label);
  const temp = path.join(base, 'Temp');
  fs.mkdirSync(temp, { recursive: true });
  const profile = path.join(base, 'profile');
  const report = path.join(base, 'startup.json');
  const source = path.join(delivery, label + '.html');
  const savedAs = path.join(delivery, label + ' сохранённый.html');
  const project = { format: 'pipeline-studio', schemaVersion: 6, id: label, title: label, revision: 0, materials: [], pages: [{ id: 'p', title: 'Лист', nodes: [], edges: [], buses: [], groups: [], drawings: [] }] };
  fs.writeFileSync(source, '<script id="pipeline-document" type="application/json">' + JSON.stringify(project) + '</script>');
  const debugPort = await freePort();
  const mainPort = await freePort();
  const env = { ...process.env, TEMP: lowerDrive ? temp.replace(/^[A-Z]:/, drive => drive.toLowerCase()) : temp, TMP: lowerDrive ? temp.replace(/^[A-Z]:/, drive => drive.toLowerCase()) : temp };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, ['--studio-test-profile', profile, '--studio-no-register', '--studio-hidden', '--studio-smoke-report', report, '--remote-debugging-port=' + debugPort, '--inspect=' + mainPort], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let launchError;
  let log = '';
  child.on('error', error => { launchError = error; });
  child.stdout.on('data', data => { log += data; });
  child.stderr.on('data', data => { log += data; });
  let browser, main;
  const result = { label, lowerDrive };
  try {
    const deadline = Date.now() + startupTimeout;
    while (!fs.existsSync(report)) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error('Portable exited before startup: ' + log);
      if (Date.now() > deadline) throw new Error('Portable startup timed out: ' + log);
      await delay(200);
    }
    const startup = JSON.parse(fs.readFileSync(report, 'utf8'));
    result.expectedURL = startup.uiURL;
    assert.equal(startup.version, version);
    if (!diagnose) result.bundle = verifyPortablePayload(startup.uiURL);
    browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 10000 });
    const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('file:'));
    assert(page);
    await page.locator('#home-open').waitFor();
    result.actualURL = page.url();
    result.read = await page.evaluate(async source => {
      try { return { ok: (await STUDIO_DESKTOP.call('read-document', { nativePath: source })).text.includes('pipeline-document') }; }
      catch (error) { return { ok: false, error: error.message }; }
    }, source);
    if (diagnose) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      assert.equal(result.read.ok, true, result.read.error);
      main = await inspector(mainPort);
      await main.evaluate(`(() => { const electron = typeof require === 'function' ? require('electron') : process.mainModule.require('electron'); electron.dialog.showOpenDialog = async () => ({canceled: false, filePaths: [${JSON.stringify(source)}]}); electron.dialog.showSaveDialog = async () => ({canceled: false, filePath: ${JSON.stringify(savedAs)}}); return true; })()`);
      await page.locator('#home-open').evaluate(button => button.click());
      await page.locator('#stage').waitFor({ timeout: 10000 });
      assert.equal(await page.evaluate(() => Studio.document.nativePath), source);
      await page.evaluate(async () => { Studio.change(() => { Studio.state.project.title += ' исправленный'; }); await Studio.saveDocument(); });
      assert(fs.readFileSync(source, 'utf8').includes('исправленный'));
      await page.evaluate(() => Studio.saveDocument(true));
      assert(fs.existsSync(savedAs));
      assert.equal(await page.evaluate(() => Studio.document.nativePath), savedAs);
      result.openAndSave = true;
      console.log('PASS Copied portable EXE opens and saves HTML:', label, lowerDrive ? '(lowercase drive)' : '');
    }
    await page.close();
    await browser.close();
    browser = null;
    if (main) { main.close(); main = null; }
    const deadlineExit = Date.now() + 10000;
    while (child.exitCode === null && Date.now() < deadlineExit) await delay(100);
    assert.equal(child.exitCode, 0, 'Portable launcher exits cleanly');
    results.push(result);
  } finally {
    if (main) main.close();
    if (browser) await browser.close().catch(() => {});
    if (child.pid && child.exitCode === null) {
      try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    }
    fs.writeFileSync(path.join(base, 'launcher.log'), log);
  }
}

(async () => {
  await runCase('Профиль коллеги');
  await runCase('Профиль коллеги lowercase', true);
  await runCase("Профиль O'Connor # 100% тест");
  if (!diagnose) {
    for (const result of results) assert.deepEqual(result.bundle, results[0].bundle);
    const exeSha256 = hash(fs.readFileSync(exe));
    assert.equal(exeSha256, hash(fs.readFileSync(original)));
    fs.writeFileSync(path.join(root, 'qa', 'portable-payload.json'),
      JSON.stringify({version, exeSha256, ...results[0].bundle, testedLaunches: results.length}, null, 2) + '\n');
    console.log('PASS All 5 files in the portable EXE app.asar match checkout bytes');
  }
  fs.writeFileSync(path.join(root, 'qa', diagnose ? 'portable-transfer-before.json' : 'portable-transfer.json'), JSON.stringify({ version, fixture, runtimeFixture, results }, null, 2));
  console.log('TOTAL', results.length);
})().catch(error => { console.error(error); process.exitCode = 1; });
