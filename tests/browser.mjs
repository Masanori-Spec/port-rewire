/**
 * End-to-end QA for the shipped, standalone PortRewire HTML.
 * Browser execution is restricted to non-root GitHub-hosted Ubuntu 22.04.
 * Never run this on a local/cloud workstation or remove Chromium's sandbox.
 * Expectations come from own-authored fixture bytes and an independent Python
 * oracle, never from importing the application's parser/mapping/ZIP producer.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';

const ROOT = path.resolve(process.env.PORT_REWIRE_PROJECT_DIR || process.env.PROJECT_DIR || fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'artifacts', 'browser');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const FIXTURE = path.join(ROOT, 'fixtures', 'native');
const expect = baseExpect.configure({timeout: 10000});
const ERRORS = [], REQUESTS = [], EXTERNAL_REQUESTS = [];
const report = {schema: 'port-rewire/browser-1', ok: false, baseURL: BASE_URL, commit: process.env.GITHUB_SHA || null, startedAt: new Date().toISOString(), checks: [], screenshots: [], downloads: [], errors: ERRORS, externalRequests: EXTERNAL_REQUESTS};
let browser, currentPage, failure;
const oldModule = await readFile(path.join(FIXTURE, 'old', 'triplet.pd'));
const newModule = await readFile(path.join(FIXTURE, 'new', 'triplet.pd'));
const callerA = await readFile(path.join(FIXTURE, 'original', 'caller-a.pd'));
const callerB = await readFile(path.join(FIXTURE, 'original', 'caller-b.pd'));
const support = await readFile(path.join(FIXTURE, 'support', 'triplet-extra.pd'));
const originalCallers = [payload('caller-a.pd', callerA), payload('caller-b.pd', callerB), payload('triplet-extra.pd', support)];
const REQUIRED_MEMBERS = ['triplet.pd', 'caller-a.pd', 'caller-b.pd', 'triplet-extra.pd', 'migration.json', 'receipt.json', 'receipt.txt'];
await mkdir(path.join(OUT, 'downloads'), {recursive: true});

function payload(name, buffer, mimeType = 'text/plain') {return {name, mimeType, buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)};}
function sha256(bytes) {return createHash('sha256').update(bytes).digest('hex');}
async function check(name, action) {
  const item = {name, ok: false};
  report.checks.push(item);
  try {const detail = await action(); item.ok = true; if (detail !== undefined) item.detail = detail; console.log(`PASS ${name}`);}
  catch (error) {item.error = error.stack || String(error); throw error;}
}
async function screenshot(page, name) {
  currentPage = page;
  await page.screenshot({path: path.join(OUT, name), fullPage: true, animations: 'disabled'});
  report.screenshots.push(name);
}
async function noOverflow(page) {
  const geometry = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(n => {
    const r = n.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(n).position !== 'fixed';
  }).slice(0, 20).map(n => ({element: n.id || `${n.tagName}.${n.className}`, width: n.getBoundingClientRect().width, text: n.textContent.slice(0, 80)}))}));
  assert.ok(geometry.document <= geometry.viewport + 1, `Document horizontal overflow: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.body <= geometry.viewport + 1, `Body horizontal overflow: ${JSON.stringify(geometry)}`);
  return geometry;
}
async function cleared(page) {
  // Immediate reads, not retrying assertions: stale previews must clear before
  // any read/hash promise resolves. Exact same-task evidence is tested below.
  assert.equal(await page.locator('#export').isDisabled(), true, 'Stale export remained enabled');
  assert.equal(await page.locator('#result').evaluate(n => n.hidden && n.childElementCount === 0), true, 'Stale result survived');
  assert.equal(await page.locator('#emptyPreview').isVisible(), true);
}
async function blocked(page, message) {
  await expect(page.locator('#status')).toHaveAttribute('data-kind', 'error');
  if (message) await expect(page.locator('#status')).toContainText(message);
  await cleared(page);
}
async function language(page, desired) {
  if (await page.locator('html').getAttribute('lang') !== desired) await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', desired);
}
async function mapPorts(page, inputMap = [2, 0, 1], outputMap = [1, 0]) {
  for (const [key, values] of [['inputMap', inputMap], ['outputMap', outputMap]]) {
    for (let index = 0; index < values.length; index++) await page.locator(`#${key}-${index}`).selectOption(String(values[index]));
  }
}
async function review(page, keyboard = false) {
  await expect(page.locator('#review')).toBeEnabled();
  if (keyboard) {await page.locator('#review').focus(); await page.keyboard.press('Enter');}
  else await page.locator('#review').click();
  await expect(page.locator('#status')).toHaveAttribute('data-kind', 'success');
  await expect(page.locator('#export')).toBeEnabled();
  await expect(page.locator('#result')).toBeVisible();
}
async function demo(page, ready = false) {
  await page.locator('#demo').click();
  await expect(page.locator('#oldSummary')).toContainText('triplet.pd');
  await expect(page.locator('#portMaps select')).toHaveCount(5);
  await expect(page.locator('#instances input')).toHaveCount(2);
  await expect(page.locator('#inputMap-0')).toHaveValue('2');
  await expect(page.locator('#outputMap-0')).toHaveValue('1');
  await cleared(page);
  if (ready) await review(page);
}
async function importSource(page, id, files, summary, expectedName) {
  await page.locator(`#${id}`).setInputFiles(files);
  await expect(page.locator(`#${summary}`)).toContainText(expectedName);
  // A summary can render before the pending read finishes only for unrelated
  // fields. This summary was cleared synchronously by the input handler.
  await expect(page.locator('#status')).not.toHaveText(/Reading files|ファイルを読み込み中/);
}
async function importFixtures(page) {
  await page.locator('#reset').click();
  await importSource(page, 'oldFile', payload('triplet.pd', oldModule), 'oldSummary', 'triplet.pd');
  await importSource(page, 'newFile', payload('triplet.pd', newModule), 'newSummary', 'triplet.pd');
  await importSource(page, 'callerFiles', originalCallers, 'callerSummary', 'caller-b.pd');
  await expect(page.locator('#instances input')).toHaveCount(2);
}
async function importPlan(page, source) {
  await page.locator('.contract').evaluate(n => {n.open = true;});
  await page.locator('#planFile').setInputFiles(typeof source === 'string' ? source : payload('migration.json', JSON.stringify(source), 'application/json'));
  await expect(page.locator('#contractState')).toContainText(/Saved contract active|保存済み契約を使用中/);
}
async function saveZip(page, filename) {
  const waiting = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await waiting;
  assert.equal(await download.failure(), null);
  assert.equal(download.suggestedFilename(), 'triplet-migration.zip');
  const destination = path.join(OUT, 'downloads', filename);
  await download.saveAs(destination);
  const bytes = await readFile(destination);
  assert.ok(bytes.length > 100);
  report.downloads.push({filename: `downloads/${filename}`, suggestedFilename: download.suggestedFilename(), bytes: bytes.length, sha256: sha256(bytes)});
  return destination;
}
async function extractZip(zipPath, directory) {
  const destination = path.join(OUT, directory);
  // Python stdlib is the independent ZIP reader. Do not import src/zip.mjs.
  execFileSync('python3', ['-c', `
import json, pathlib, sys, zipfile
source, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
required = set(json.loads(sys.argv[3]))
assert not target.exists(), 'Refuse stale extracted artifacts; use a fresh checkout'
target.mkdir(parents=True)
with zipfile.ZipFile(source) as archive:
    names = archive.namelist()
    assert len(names) == len(set(names)), 'Duplicate ZIP members'
    assert set(names) == required, 'Unexpected or missing ZIP members'
    assert archive.testzip() is None, 'ZIP CRC mismatch'
    assert sum(m.file_size for m in archive.infolist()) <= 8_000_000, 'Unexpected expanded size'
    for member in archive.infolist():
        assert member.filename in required and not member.is_dir(), 'Unsafe archive member'
        assert pathlib.PurePosixPath(member.filename).name == member.filename, 'Archive path traversal'
        assert member.file_size <= 2_000_000, 'Unexpected member size'
        (target / member.filename).write_bytes(archive.read(member))
`, zipPath, destination, JSON.stringify(REQUIRED_MEMBERS)], {cwd: ROOT, encoding: 'utf8', timeout: 30000});
  return destination;
}
async function verifyZip(zipPath, directory, identity = false) {
  const destination = await extractZip(zipPath, directory);
  const oraclePath = path.join(OUT, `${directory}-verification.json`);
  const args = [path.join(ROOT, 'scripts', 'verify_export.py'), destination, '--report', oraclePath];
  if (identity) args.push('--identity');
  const verified = JSON.parse(execFileSync('python3', args, {cwd: ROOT, encoding: 'utf8', timeout: 30000}));
  assert.equal(verified.status, 'passed');
  assert.equal(verified.bundles[0].changedEndpointTokens, identity ? 0 : 16);
  return {directory: path.relative(ROOT, destination), oracle: verified};
}
async function openPage(viewport = {width: 1360, height: 900}, mobile = false, offline = false) {
  const context = await browser.newContext({viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true, locale: 'ja-JP', reducedMotion: 'reduce', offline});
  const page = await context.newPage();
  currentPage = page;
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => ERRORS.push({kind: 'pageerror', message: error.message}));
  page.on('console', message => {if (message.type() === 'error') ERRORS.push({kind: 'console', message: message.text()});});
  page.on('dialog', async dialog => {ERRORS.push({kind: 'unexpected-dialog', message: dialog.message()}); await dialog.dismiss();});
  page.on('requestfailed', request => ERRORS.push({kind: 'requestfailed', url: request.url(), message: request.failure()?.errorText}));
  page.on('request', request => {
    const url = request.url(); REQUESTS.push(url);
    if (/^https?:/.test(url) && (offline || new URL(url).origin !== new URL(BASE_URL).origin)) EXTERNAL_REQUESTS.push(url);
  });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && (offline || new URL(url).origin !== new URL(BASE_URL).origin)) return route.abort('blockedbyclient');
    return route.continue();
  });
  const url = offline ? pathToFileURL(path.join(ROOT, 'dist', 'port-rewire.html')).href : BASE_URL;
  const response = await page.goto(url, {waitUntil: 'load'});
  if (!offline) assert.ok(response?.ok(), `App HTTP status: ${response?.status()}`);
  await expect(page.locator('#status')).toHaveAttribute('role', 'status');
  await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#inputMap-0')).toHaveValue('2');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  return page;
}
async function sameTaskMutation(page, mutation) {
  const snapshot = await page.evaluate(({kind, selector, value, name, bytes}) => {
    const n = document.querySelector(selector);
    if (kind === 'select') n.value = value;
    else if (kind === 'check') n.checked = !n.checked;
    else if (kind === 'file') {const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], name, {type: 'text/plain'})); n.files = transfer.files;}
    n.dispatchEvent(new Event('change', {bubbles: true}));
    return {disabled: document.getElementById('export').disabled, hidden: document.getElementById('result').hidden, children: document.getElementById('result').childElementCount, emptyVisible: !document.getElementById('emptyPreview').hidden};
  }, mutation);
  assert.deepEqual(snapshot, {disabled: true, hidden: true, children: 0, emptyVisible: true}, 'Invalidation must happen synchronously inside the change handler');
  return snapshot;
}
async function keyboardAudit(page) {
  await demo(page, true);
  await page.locator('.contract').evaluate(n => {n.open = true;});
  await page.locator('.skip').focus();
  const skip = await page.locator('.skip').evaluate(n => ({top: n.getBoundingClientRect().top, width: n.getBoundingClientRect().width}));
  assert.ok(skip.top >= 0 && skip.width > 20, 'Focused skip link is not visible');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => location.hash), '#workspace');
  await page.keyboard.press('Tab');
  const firstAfterSkip = await page.evaluate(() => document.activeElement.id);
  assert.equal(firstAfterSkip, 'demo', 'Skip link should move the keyboard start point into the workspace');
  const required = new Set(['language', 'demo', 'reset', 'oldFile', 'newFile', 'callerFiles', 'planFile', 'newMapping', 'inputMap-0', 'inputMap-1', 'inputMap-2', 'outputMap-0', 'outputMap-1', 'review', 'export']);
  const visited = new Set(), evidence = [];
  await page.locator('.skip').focus();
  for (let count = 0; count < 90 && [...required].some(id => !visited.has(id)); count++) {
    await page.keyboard.press('Tab');
    const item = await page.evaluate(() => {
      const n = document.activeElement, s = getComputedStyle(n), r = n.getBoundingClientRect();
      return {id: n.id, instance: n.dataset.instance || null, visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight, focusVisible: n.matches(':focus-visible'), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth};
    });
    if (required.has(item.id) || item.instance) {
      assert.equal(item.visible, true, `Invisible keyboard focus: ${item.id || item.instance}`);
      assert.equal(item.focusVisible, true, `Missing focus-visible state: ${item.id || item.instance}`);
      assert.ok(item.outlineStyle !== 'none' && parseFloat(item.outlineWidth) > 0, `Missing focus indicator: ${item.id || item.instance}`);
      visited.add(item.id); evidence.push(item);
    }
  }
  assert.deepEqual([...required].filter(id => !visited.has(id)), [], 'Controls not reachable using Tab');
  const unlabeled = await page.locator('input, select, button').evaluateAll(nodes => nodes.filter(n => !(n.labels?.length || n.getAttribute('aria-label')?.trim() || n.getAttribute('aria-labelledby')?.trim() || (n.tagName === 'BUTTON' && n.textContent.trim()))).map(n => n.id));
  assert.deepEqual(unlabeled, [], 'A form control has no accessible name');
  await demo(page);
  await review(page, true);
  return {skip, firstAfterSkip, controls: evidence};
}
async function gateFileReads(page, method) {
  assert.ok(['arrayBuffer', 'text'].includes(method));
  await page.evaluate(method => {
    const original = File.prototype[method];
    window.__qaReadGate = {method, reads: []};
    window.__qaRestoreReadGate = () => {File.prototype[method] = original;};
    File.prototype[method] = function(...args) {
      const entry = {name: this.name, size: this.size, finished: false};
      window.__qaReadGate.reads.push(entry);
      entry.promise = new Promise((resolve, reject) => {
        entry.release = async () => {
          if (entry.released) throw new Error('Read gate already released');
          entry.released = true;
          try {resolve(await original.apply(this, args));}
          catch (error) {reject(error);}
          finally {entry.finished = true;}
        };
      });
      return entry.promise;
    };
  }, method);
}
async function waitGatedReads(page, count) {
  await expect.poll(() => page.evaluate(() => window.__qaReadGate.reads.length)).toBe(count);
}
async function releaseFileRead(page, index) {
  await page.evaluate(async index => {
    await window.__qaReadGate.reads[index].release();
    // Drain the consumer's read/decode/commit microtasks before inspecting UI.
    await new Promise(resolve => setTimeout(resolve, 0));
  }, index);
  await expect.poll(() => page.evaluate(index => window.__qaReadGate.reads[index].finished, index)).toBe(true);
}
async function restoreFileReads(page) {await page.evaluate(() => window.__qaRestoreReadGate());}
async function doubleText(page) {
  // Text-only enlargement: compute before mutation, double every rendered
  // element's font size, preserve layout dimensions. Root-only scaling misses
  // px-based text; deviceScaleFactor and pageScaleFactor are not text resizing.
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('body, body *')].filter(n => !['SCRIPT', 'STYLE'].includes(n.tagName));
    const sizes = nodes.map(n => parseFloat(getComputedStyle(n).fontSize));
    nodes.forEach((n, i) => n.style.setProperty('font-size', `${sizes[i] * 2}px`, 'important'));
    return {method: 'Every element computed font-size doubled; viewport unchanged', elements: nodes.length, bodyFontBefore: sizes[0], bodyFontAfter: parseFloat(getComputedStyle(document.body).fontSize)};
  });
}

try {
  await check('Hosted Ubuntu 22.04 non-root execution boundary', async () => {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Browser QA runs only in GitHub Actions; do not launch a local/cloud browser');
    assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Only GitHub-hosted runners are supported');
    assert.equal(process.env.RUNNER_OS, 'Linux');
    const release = await readFile('/etc/os-release', 'utf8');
    assert.match(release, /^ID=ubuntu$/m);
    assert.match(release, /^VERSION_ID="22\.04"$/m);
    assert.equal(typeof process.getuid, 'function');
    assert.notEqual(process.getuid(), 0, 'Never run Chromium as root or disable its sandbox');
    return {runner: process.env.RUNNER_ENVIRONMENT, os: 'Ubuntu 22.04', uid: process.getuid()};
  });
  browser = await chromium.launch({chromiumSandbox: true, args: []});
  await check('Chromium sandbox command line independently inspected', async () => {
    const session = await browser.newBrowserCDPSession();
    const {arguments: commandLine} = await session.send('Browser.getBrowserCommandLine');
    await session.detach();
    const forbidden = commandLine.filter(arg => /^--(?:no-sandbox|disable-setuid-sandbox|disable-namespace-sandbox|disable-seccomp-filter-sandbox|disable-gpu-sandbox|single-process)(?:=|$)/.test(arg));
    if (forbidden.length) {await browser.close(); throw new Error(`Unsafe Chromium launch stopped: ${forbidden.join(' ')}`);}
    report.browser = {version: browser.version(), chromiumSandbox: true, commandLine};
    return {chromiumSandbox: true, forbiddenFlags: forbidden};
  });
  const page = await openPage();
  await check('Japanese desktop preloaded example requires explicit review', async () => {
    await expect(page.locator('#review')).toBeEnabled();
    await expect(page.locator('#export')).toBeDisabled();
    await expect(page.locator('#status')).toContainText('動作例を読み込み済み');
    assert.deepEqual(await page.locator('#instances input').evaluateAll(ns => ns.map(n => n.dataset.instance)), ['caller-a.pd::root::7', 'caller-b.pd::root/2::7']);
    assert.deepEqual(await page.locator('#portMaps select').evaluateAll(ns => ns.map(n => n.value)), ['2', '0', '1', '1', '0']);
    await noOverflow(page);
    await review(page);
    assert.deepEqual(await page.locator('.stat b').allTextContents(), ['2', '16', '16']);
    await expect(page.locator('.change')).toHaveCount(16);
    await expect(page.locator('.bundle-list')).toContainText('triplet-extra.pd');
    await screenshot(page, 'desktop-ja-ready.png');
    return await noOverflow(page);
  });
  await check('Japanese and English preserve reviewed sources, maps and selection', async () => {
    const selectors = ['#demo', '#reset', '#review', '#export'];
    const ja = await Promise.all(selectors.map(s => page.locator(s).innerText()));
    ja.forEach(text => assert.match(text, /[\u3040-\u30ff\u3400-\u9fff]/));
    await language(page, 'en');
    const en = await Promise.all(selectors.map(s => page.locator(s).innerText()));
    en.forEach((text, i) => {assert.notEqual(text, ja[i]); assert.doesNotMatch(text, /[\u3040-\u30ff\u3400-\u9fff]/);});
    assert.deepEqual(await page.locator('#portMaps select').evaluateAll(ns => ns.map(n => n.value)), ['2', '0', '1', '1', '0']);
    assert.deepEqual(await page.locator('#instances input').evaluateAll(ns => ns.map(n => n.checked)), [true, true]);
    await expect(page.locator('#export')).toBeEnabled();
    await screenshot(page, 'desktop-en-ready.png');
    return {ja, en, dimensions: await noOverflow(page)};
  });
  let savedPlan, savedPlanPath;
  await check('Actual browser migration ZIP passes independent endpoint and byte oracle', async () => {
    const result = await verifyZip(await saveZip(page, 'triplet-migration.zip'), 'extracted');
    savedPlanPath = path.join(OUT, 'extracted', 'migration.json');
    savedPlan = JSON.parse(await readFile(savedPlanPath, 'utf8'));
    return result;
  });
  await check('Keyboard skip link, tab order, visible focus and Enter review', async () => keyboardAudit(page));
  await check('Raw source-file import preserves CRLF and requires every explicit map', async () => {
    assert.ok(callerB.includes(Buffer.from('\r\n')));
    await importFixtures(page);
    assert.deepEqual(await page.locator('#portMaps select').evaluateAll(ns => ns.map(n => n.value)), ['', '', '', '', '']);
    await page.locator('#review').click(); await blocked(page, 'Choose a unique revised index');
    await mapPorts(page);
    await review(page);
    return await verifyZip(await saveZip(page, 'imported-crlf-migration.zip'), 'imported-extracted');
  });
  await check('Incomplete and duplicate mappings are denied without stale exports', async () => {
    for (const value of ['', '0']) {
      await demo(page, true);
      await page.locator('#inputMap-0').selectOption(value);
      await cleared(page);
      await page.locator('#review').click();
      await blocked(page, 'Choose a unique revised index');
    }
    await demo(page, true);
    await page.locator('#outputMap-0').selectOption('0');
    await page.locator('#review').click(); await blocked(page, 'Choose a unique revised index');
  });
  await check('Empty instance selection is denied', async () => {
    await demo(page, true);
    for (const checkbox of await page.locator('#instances input').all()) await checkbox.uncheck();
    await cleared(page);
    await page.locator('#review').click(); await blocked(page, 'Select at least one');
  });
  await check('Nested-only selection changes the nested caller and preserves other bytes', async () => {
    await demo(page);
    await page.locator('input[data-instance="caller-a.pd::root::7"]').uncheck();
    await review(page);
    assert.deepEqual(await page.locator('.stat b').allTextContents(), ['1', '8', '8']);
    for (const text of await page.locator('.change-name').allTextContents()) assert.match(text, /^caller-b\.pd · root\/2 · /);
    const extracted = await extractZip(await saveZip(page, 'nested-only-migration.zip'), 'nested-extracted');
    assert.deepEqual(await readFile(path.join(extracted, 'caller-a.pd')), callerA);
    assert.deepEqual(await readFile(path.join(extracted, 'caller-b.pd')), await readFile(path.join(FIXTURE, 'remapped', 'caller-b.pd')));
    assert.deepEqual(await readFile(path.join(extracted, 'triplet-extra.pd')), support);
    const plan = JSON.parse(await readFile(path.join(extracted, 'migration.json'), 'utf8'));
    assert.deepEqual(plan.callers.map(c => c.instances), [[], [{canvas: 'root/2', index: 7}], []]);
    return {selected: 'caller-b.pd::root/2::7', unchanged: ['caller-a.pd', 'triplet-extra.pd'], changedTokens: 8};
  });
  await check('Identity mapping exports byte-identical callers and zero-change receipt', async () => {
    await demo(page); await mapPorts(page, [0, 1, 2], [0, 1]); await review(page);
    assert.deepEqual(await page.locator('.stat b').allTextContents(), ['2', '0', '0']);
    await expect(page.locator('#result')).toContainText('Identity mappings preserve caller bytes exactly');
    return await verifyZip(await saveZip(page, 'identity-migration.zip'), 'identity-extracted', true);
  });
  await check('Saved contract import locks mapping and selection and revalidates source hashes', async () => {
    await demo(page, true); await importPlan(page, savedPlanPath); await cleared(page);
    for (const control of await page.locator('#portMaps select, #instances input').all()) await expect(control).toBeDisabled();
    await review(page);
    return await verifyZip(await saveZip(page, 'saved-contract-migration.zip'), 'saved-contract-extracted');
  });
  for (const source of ['old', 'revised', 'caller']) {
    await check(`Saved contract rejects changed ${source} source hashes`, async () => {
      await demo(page); await importPlan(page, savedPlanPath);
      if (source === 'old') await importSource(page, 'oldFile', payload('triplet.pd', Buffer.concat([oldModule, Buffer.from('\n')])), 'oldSummary', 'triplet.pd');
      if (source === 'revised') await importSource(page, 'newFile', payload('triplet.pd', Buffer.concat([newModule, Buffer.from('\n')])), 'newSummary', 'triplet.pd');
      if (source === 'caller') await importSource(page, 'callerFiles', [payload('caller-a.pd', Buffer.concat([callerA, Buffer.from('\n')])), originalCallers[1], originalCallers[2]], 'callerSummary', 'caller-a.pd');
      await page.locator('#review').click(); await blocked(page, 'Source hash mismatch');
    });
  }
  await check('Double application of a saved contract to exported callers is denied', async () => {
    await demo(page); await importPlan(page, savedPlanPath);
    await importSource(page, 'callerFiles', ['caller-a.pd', 'caller-b.pd', 'triplet-extra.pd'].map(n => path.join(OUT, 'extracted', n)), 'callerSummary', 'caller-b.pd');
    await page.locator('#review').click(); await blocked(page, 'Source hash mismatch');
  });
  await check('New mapping exits saved contract and requires explicit choices again', async () => {
    await demo(page); await importPlan(page, savedPlanPath); await review(page);
    await page.locator('#newMapping').click(); await cleared(page);
    assert.deepEqual(await page.locator('#portMaps select').evaluateAll(ns => ns.map(n => ({disabled: n.disabled, value: n.value}))), Array.from({length: 5}, () => ({disabled: false, value: ''})));
    await page.locator('#review').click(); await blocked(page, 'Choose a unique revised index');
    await mapPorts(page); await review(page);
  });
  await check('Every map, selection and file change invalidates preview in the same event task', async () => {
    const mutations = [
      {kind: 'select', selector: '#inputMap-0', value: '0'},
      {kind: 'select', selector: '#outputMap-0', value: '0'},
      {kind: 'check', selector: 'input[data-instance="caller-b.pd::root/2::7"]'},
      {kind: 'file', selector: '#oldFile', name: 'triplet.pd', bytes: [...oldModule]},
      {kind: 'file', selector: '#newFile', name: 'triplet.pd', bytes: [...newModule]},
      {kind: 'file', selector: '#callerFiles', name: 'caller-a.pd', bytes: [...callerA]},
      {kind: 'file', selector: '#planFile', name: 'migration.json', bytes: [...Buffer.from(JSON.stringify(savedPlan))]},
    ];
    const snapshots = [];
    for (const mutation of mutations) {await demo(page, true); snapshots.push({selector: mutation.selector, ...await sameTaskMutation(page, mutation)}); await page.locator('#reset').click();}
    return snapshots;
  });
  await check('New mapping cancels a pending contract text read and releases the busy state', async () => {
    await demo(page, true);
    await page.locator('.contract').evaluate(n => {n.open = true;});
    await gateFileReads(page, 'text');
    await page.locator('#planFile').setInputFiles(savedPlanPath);
    await waitGatedReads(page, 1);
    await expect(page.locator('#review')).toBeDisabled();
    await cleared(page);
    await page.locator('#newMapping').click();
    await expect(page.locator('#contractState')).toContainText('New mapping.');
    await expect(page.locator('#review')).toBeEnabled();
    assert.deepEqual(await page.locator('#portMaps select').evaluateAll(ns => ns.map(n => ({disabled: n.disabled, value: n.value}))), Array.from({length: 5}, () => ({disabled: false, value: ''})));
    await releaseFileRead(page, 0);
    await restoreFileReads(page);
    await expect(page.locator('#contractState')).toContainText('New mapping.');
    await expect(page.locator('#planFile')).toHaveValue('');
    await expect(page.locator('#review')).toBeEnabled();
    assert.deepEqual(await page.locator('#portMaps select').evaluateAll(ns => ns.map(n => ({disabled: n.disabled, value: n.value}))), Array.from({length: 5}, () => ({disabled: false, value: ''})));
    await cleared(page);
    await mapPorts(page); await review(page);
    return {cancelledPendingContract: true, reviewUnlockedBeforeOldReadSettled: true};
  });
  await check('Independent old and revised file reads both commit when completed in reverse order', async () => {
    await demo(page, true);
    await gateFileReads(page, 'arrayBuffer');
    await page.locator('#oldFile').setInputFiles(payload('triplet.pd', oldModule));
    await waitGatedReads(page, 1);
    await page.locator('#newFile').setInputFiles(payload('triplet.pd', newModule));
    await waitGatedReads(page, 2);
    await expect(page.locator('#oldSummary')).toHaveText('No source loaded');
    await expect(page.locator('#newSummary')).toHaveText('No source loaded');
    await expect(page.locator('#review')).toBeDisabled(); await cleared(page);
    await releaseFileRead(page, 1);
    await expect(page.locator('#newSummary')).toHaveText(`triplet.pd · ${newModule.length} B`);
    await expect(page.locator('#oldSummary')).toHaveText('No source loaded');
    await expect(page.locator('#review')).toBeDisabled();
    await releaseFileRead(page, 0);
    await restoreFileReads(page);
    await expect(page.locator('#oldSummary')).toHaveText(`triplet.pd · ${oldModule.length} B`);
    await expect(page.locator('#newSummary')).toHaveText(`triplet.pd · ${newModule.length} B`);
    await expect(page.locator('#review')).toBeEnabled();
    await expect(page.locator('#instances input')).toHaveCount(2);
    assert.deepEqual(await page.locator('#portMaps select').evaluateAll(ns => ns.map(n => n.value)), ['', '', '', '', '']);
    await mapPorts(page); await review(page);
    return await verifyZip(await saveZip(page, 'concurrent-source-migration.zip'), 'concurrent-source-extracted');
  });
  await check('Latest same-field source replacement wins even when the older read finishes last', async () => {
    await demo(page, true);
    await gateFileReads(page, 'arrayBuffer');
    const stale = Buffer.concat([oldModule, Buffer.from('#X text 20 320 stale older source;\n')]);
    await page.locator('#oldFile').setInputFiles(payload('triplet.pd', stale));
    await waitGatedReads(page, 1);
    await page.locator('#oldFile').setInputFiles(payload('triplet.pd', oldModule));
    await waitGatedReads(page, 2);
    await releaseFileRead(page, 1);
    await expect(page.locator('#oldSummary')).toHaveText(`triplet.pd · ${oldModule.length} B`);
    await expect(page.locator('#review')).toBeEnabled();
    await mapPorts(page); await review(page);
    const reviewed = await page.locator('#result').innerText();
    // Settling an obsolete read must neither overwrite the newer source nor
    // invalidate its already-reviewed result or leave a read counter stuck.
    await releaseFileRead(page, 0);
    await restoreFileReads(page);
    await expect(page.locator('#oldSummary')).toHaveText(`triplet.pd · ${oldModule.length} B`);
    await expect(page.locator('#review')).toBeEnabled();
    await expect(page.locator('#export')).toBeEnabled();
    assert.equal(await page.locator('#result').innerText(), reviewed);
    return await verifyZip(await saveZip(page, 'latest-read-migration.zip'), 'latest-read-extracted');
  });
  await check('Pending contract and caller reads disable all remaining map and instance controls', async () => {
    const evidence = [];
    for (const [id, method, files, expectedReads, expectedControls] of [
      ['planFile', 'text', savedPlanPath, 1, 7],
      ['callerFiles', 'arrayBuffer', originalCallers, 3, 5],
    ]) {
      await demo(page, true);
      await page.locator('.contract').evaluate(n => {n.open = true;});
      await gateFileReads(page, method);
      await page.locator(`#${id}`).setInputFiles(files);
      await waitGatedReads(page, expectedReads);
      const controls = page.locator('#portMaps select, #instances input');
      await expect(controls).toHaveCount(expectedControls);
      for (const control of await controls.all()) await expect(control).toBeDisabled();
      await expect(page.locator('#review')).toBeDisabled(); await cleared(page);
      evidence.push({field: id, disabledControls: expectedControls, pendingReads: expectedReads});
      for (let i = expectedReads - 1; i >= 0; i--) await releaseFileRead(page, i);
      await restoreFileReads(page);
      await expect(page.locator('#review')).toBeEnabled();
      if (id === 'planFile') await page.locator('#newMapping').click();
      for (const control of await page.locator('#portMaps select, #instances input').all()) await expect(control).toBeEnabled();
      await mapPorts(page); await review(page);
    }
    return evidence;
  });
  await check('Reset cancels a delayed File.arrayBuffer read without resurrecting sources', async () => {
    await demo(page, true);
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      window.__qaFileRead = {started: false, finished: false};
      File.prototype.arrayBuffer = function(...args) {
        window.__qaFileRead.started = true;
        return new Promise((resolve, reject) => {window.__qaReleaseRead = async () => {
          File.prototype.arrayBuffer = original;
          try {resolve(await original.apply(this, args));} catch (error) {reject(error);} finally {window.__qaFileRead.finished = true;}
        };});
      };
    });
    await page.locator('#oldFile').setInputFiles(payload('triplet.pd', oldModule));
    await expect.poll(() => page.evaluate(() => window.__qaFileRead.started)).toBe(true);
    await cleared(page); await expect(page.locator('#review')).toBeDisabled();
    await page.locator('#reset').click();
    await page.evaluate(async () => {await window.__qaReleaseRead(); await new Promise(resolve => setTimeout(resolve, 0));});
    await expect.poll(() => page.evaluate(() => window.__qaFileRead.finished)).toBe(true);
    await expect(page.locator('#oldSummary')).toHaveText('No source loaded');
    await expect(page.locator('#newSummary')).toHaveText('No source loaded');
    await expect(page.locator('#callerSummary')).toHaveText('No source loaded');
    await expect(page.locator('#portMaps select')).toHaveCount(0);
    await expect(page.locator('#review')).toBeDisabled(); await cleared(page);
    await expect(page.locator('#status')).toContainText('Reset.');
    await demo(page, true);
  });
  await check('Reset cancels a delayed SHA-256 review result without resurrecting export', async () => {
    await demo(page);
    await page.evaluate(() => {
      const original = crypto.subtle.digest.bind(crypto.subtle);
      window.__qaDigest = {started: false, finished: false, contractFinished: false};
      window.__qaRestoreDigest = () => {crypto.subtle.digest = original;};
      crypto.subtle.digest = (...args) => {
        // The final contract digest is a completion fence independent of timing.
        const contract = new TextDecoder().decode(args[1]).startsWith('{"schema":"port-rewire/migration-1"');
        const compute = () => original(...args).finally(() => {if (contract) window.__qaDigest.contractFinished = true;});
        if (window.__qaDigest.started) return compute();
        window.__qaDigest.started = true;
        return new Promise((resolve, reject) => {window.__qaReleaseDigest = async () => {
          try {resolve(await compute());} catch (error) {reject(error);} finally {window.__qaDigest.finished = true;}
        };});
      };
    });
    await page.locator('#review').click();
    await expect.poll(() => page.evaluate(() => window.__qaDigest.started)).toBe(true);
    await expect(page.locator('#review')).toBeDisabled(); await cleared(page);
    await page.locator('#reset').click();
    await page.evaluate(async () => {await window.__qaReleaseDigest();});
    await expect.poll(() => page.evaluate(() => window.__qaDigest.finished)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__qaDigest.contractFinished)).toBe(true);
    await page.evaluate(async () => {window.__qaRestoreDigest(); await new Promise(resolve => setTimeout(resolve, 0));});
    await expect(page.locator('#status')).toContainText('Reset.');
    await expect(page.locator('#oldSummary')).toHaveText('No source loaded');
    await expect(page.locator('#review')).toBeDisabled(); await cleared(page);
    await demo(page, true);
  });
  await check('Read failures are contained, clear stale results and allow recovery', async () => {
    await demo(page, true);
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function() {File.prototype.arrayBuffer = original; return Promise.reject(new DOMException('Synthetic read failure', 'NotReadableError'));};
    });
    await page.locator('#oldFile').setInputFiles(payload('triplet.pd', oldModule));
    await blocked(page, 'Validation failed');
    await expect(page.locator('#review')).toBeDisabled();
    await demo(page, true);
  });
  await check('Malformed and unsupported contracts fail closed and recover', async () => {
    for (const text of ['{"schema":', JSON.stringify({...savedPlan, schema: 'unknown-9'}), JSON.stringify({...savedPlan, callers: [null]})]) {
      await demo(page, true);
      await page.locator('.contract').evaluate(n => {n.open = true;});
      await page.locator('#planFile').setInputFiles(payload('migration.json', text, 'application/json'));
      await blocked(page);
    }
    await demo(page); await importPlan(page, savedPlanPath); await review(page);
  });
  await check('Invalid UTF-8 and unsupported signal-port sources cannot preserve old exports', async () => {
    for (const [buffer, message] of [[Buffer.from([0xff, 0xfe]), 'valid UTF-8'], [Buffer.from(oldModule.toString('utf8').replace('inlet;', 'inlet~;')), 'Signal ports']]) {
      await demo(page, true);
      await page.locator('#oldFile').setInputFiles(payload('triplet.pd', buffer));
      await blocked(page, message);
      await expect(page.locator('#review')).toBeDisabled();
    }
  });
  await check('Oversized file, too many callers and oversized aggregate are rejected', async () => {
    await demo(page, true);
    await page.locator('#oldFile').setInputFiles(payload('triplet.pd', Buffer.alloc(524289, 32)));
    await blocked(page, 'File size or count limit exceeded');
    await demo(page, true);
    await page.locator('#callerFiles').setInputFiles(Array.from({length: 21}, (_, i) => payload(`caller-${i}.pd`, callerA)));
    await blocked(page, 'File size or count limit exceeded');
    await demo(page, true);
    const padded = Buffer.concat([callerA, Buffer.alloc(500000 - callerA.length, 32)]);
    await importSource(page, 'callerFiles', Array.from({length: 9}, (_, i) => payload(`caller-${i}.pd`, padded)), 'callerSummary', 'caller-8.pd');
    await mapPorts(page); await page.locator('#review').click(); await blocked(page, 'File size or count limit exceeded');
    await demo(page, true);
    await page.locator('.contract').evaluate(n => {n.open = true;});
    await page.locator('#planFile').setInputFiles(payload('migration.json', Buffer.alloc(524289, 32), 'application/json'));
    await blocked(page, 'File size or count limit exceeded');
    return {perFileBytes: 524289, callerCount: 21, aggregateCallerBytes: 4500000, contractBytes: 524289};
  });
  await check('Hostile filenames render literally and cannot enter a ZIP', async () => {
    await demo(page, true);
    const hostile = '<img src=x onerror=alert(42)>.pd';
    await importSource(page, 'callerFiles', [payload(hostile, callerA), originalCallers[1], originalCallers[2]], 'callerSummary', hostile);
    await expect(page.locator('#callerSummary img, #instances img')).toHaveCount(0);
    await mapPorts(page); await page.locator('#review').click(); await blocked(page, 'Use safe plain .pd filenames');
    await noOverflow(page);
  });
  await check('Hostile patch comment text is displayed as text without DOM execution', async () => {
    await demo(page);
    const hostile = '<img src=x onerror=alert(42)>';
    const bytes = Buffer.concat([oldModule, Buffer.from(`#X text 60 50 ${hostile};\n`)]);
    await importSource(page, 'oldFile', payload('triplet.pd', bytes), 'oldSummary', 'triplet.pd');
    await expect(page.locator('#portMaps')).toContainText(hostile);
    await expect(page.locator('#portMaps img')).toHaveCount(0);
    await mapPorts(page); await review(page);
    await expect(page.locator('script')).toHaveCount(1);
    return {literalText: hostile, injectedImageElements: await page.locator('img').count()};
  });
  await check('Standalone file:// offline page reviews and exports independently verified ZIP', async () => {
    const offline = await openPage({width: 1360, height: 900}, false, true);
    assert.equal(new URL(offline.url()).protocol, 'file:');
    await review(offline);
    await screenshot(offline, 'offline-file-ready.png');
    await noOverflow(offline);
    const result = await verifyZip(await saveZip(offline, 'offline-migration.zip'), 'offline-extracted');
    await offline.context().close();
    currentPage = page;
    return {offline: true, protocol: 'file:', ...result};
  });
  const mobile = await openPage({width: 390, height: 844}, true);
  await check('390px Japanese mobile reviewed result has no horizontal overflow', async () => {
    await review(mobile); await screenshot(mobile, 'mobile-ja-ready.png');
    return await noOverflow(mobile);
  });
  await check('390px English mobile reviewed result preserves state without overflow', async () => {
    await language(mobile, 'en');
    await expect(mobile.locator('#export')).toBeEnabled();
    assert.deepEqual(await mobile.locator('.stat b').allTextContents(), ['2', '16', '16']);
    await screenshot(mobile, 'mobile-en-ready.png');
    return await noOverflow(mobile);
  });
  for (const [label, viewport, isMobile] of [['desktop', {width: 1360, height: 900}, false], ['mobile', {width: 390, height: 844}, true]]) {
    for (const locale of ['ja', 'en']) {
      await check(`200% text ${locale} ${label} preserves a usable reviewed result without overflow`, async () => {
        const enlarged = await openPage(viewport, isMobile);
        await language(enlarged, locale); await review(enlarged);
        const text = await doubleText(enlarged);
        assert.equal(text.bodyFontAfter, text.bodyFontBefore * 2);
        await expect(enlarged.locator('#review')).toBeVisible();
        await expect(enlarged.locator('#export')).toBeEnabled();
        await screenshot(enlarged, `${label}-${locale}-text-200.png`);
        const dimensions = await noOverflow(enlarged);
        await enlarged.context().close(); currentPage = mobile;
        return {...text, dimensions};
      });
    }
  }
  await check('No external requests, failed loads, uncaught errors or injection dialogs', async () => {
    assert.deepEqual(EXTERNAL_REQUESTS, []);
    assert.deepEqual(ERRORS, []);
    const urls = [...new Set(REQUESTS)];
    // The built HTML must not silently fall back to module/CSS requests.
    const httpPaths = urls.filter(u => /^https?:/.test(u)).map(u => new URL(u).pathname);
    assert.deepEqual([...new Set(httpPaths)], [new URL(BASE_URL).pathname]);
    return {requests: urls, externalRequests: 0, browserErrors: 0};
  });
  report.ok = true;
} catch (error) {
  failure = error; report.failure = error.stack || String(error);
  if (currentPage && !currentPage.isClosed()) {
    try {await screenshot(currentPage, 'failure.png');} catch (screenshotError) {report.screenshotError = String(screenshotError);}
  }
} finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  report.requests = [...new Set(REQUESTS)];
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
if (failure) {console.error(failure.stack || failure); process.exitCode = 1;}
else console.log(`PASS ${report.checks.length} browser checks; artifacts: ${OUT}`);
