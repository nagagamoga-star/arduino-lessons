// Serves the repo and drives the live page in headless Chrome.
// Starter lessons must reach Running with the signal they teach.
// Regressions cover the guards added after the first review:
//   saved edits, braceless loops, one-line if semicolons,
//   servo/tone timer clashes, and multi-int declarations.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function contentType(file){
  const ext = path.extname(file);
  return {
    '.html': 'text/html; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
  }[ext] || 'application/octet-stream';
}

function serve(dir){
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      rel = rel.replace(/^\/+/, '');
      const file = path.resolve(dir, rel);
      if (file !== dir && !file.startsWith(dir + path.sep)){
        res.writeHead(403); res.end('no'); return;
      }
      fs.readFile(file, (err, data) => {
        if (err){ res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function readSim(){
  const api = window.__pinbypin;
  const sim = api.sim;
  const lines = api.serialLines();
  const pin = p => ({ pwm: sim.pins[p].pwm, out: sim.pins[p].out, mode: sim.pins[p].mode });
  return {
    status: api.status(),
    text: lines.map(l => l.t).join('\n'),
    err: lines.filter(l => l.k === 'err').map(l => l.t).join(' | '),
    tonePin: sim.tone ? sim.tone.pin : null,
    servo3: sim.servos[3] ? sim.servos[3].pin : null,
    stepper: !!sim.stepper,
    lcd: sim.lcd && sim.lcd.on ? sim.lcd.buf.map(row => row.join('')).join('\n') : '',
    pins: { 2: pin(2), 3: pin(3), 5: pin(5), 6: pin(6), 8: pin(8), 9: pin(9), 10: pin(10), 11: pin(11), 13: pin(13) },
  };
}

const failures = [];
function check(cond, msg){
  if (cond){ console.log('  ok  ' + msg); return; }
  console.error('  FAIL ' + msg);
  failures.push(msg);
}

async function gotoLesson(page, n){
  await page.evaluate(n => { location.hash = '#lesson-' + n; }, n);
  await page.waitForFunction(n => (document.getElementById('eyebrow')?.textContent || '').startsWith('Lesson ' + n + ' '), n, { timeout: 8000 });
  await page.waitForFunction(() => {
    const s = window.__pinbypin.status();
    return s === 'running' || s === 'error';
  }, null, { timeout: 8000 });
}

async function until(page, pred, timeout){
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout){
    last = await page.evaluate(readSim);
    if (pred(last)) return last;
    if (last.status === 'error') return last;
    await sleep(40);
  }
  return last;
}

function detail(state){
  if (!state) return 'no state';
  return JSON.stringify({ status: state.status, err: state.err, text: (state.text || '').slice(0, 180) });
}

async function runSketch(page, code){
  await page.evaluate(code => {
    document.getElementById('code').value = code;
    document.getElementById('runBtn').click();
  }, code);
}

const server = await serve(root);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
});
const page = await browser.newPage();
page.setDefaultTimeout(8000);
const httpErrors = [];
const consoleErrors = [];
const pageErrors = [];
page.on('response', res => {
  if (res.status() >= 400) httpErrors.push(res.status() + ' ' + res.url());
});
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', err => pageErrors.push(String(err && err.message || err)));

try {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__pinbypin && document.getElementById('title'));

  console.log('starter lessons');

  // 1. Serial greeting and a whole second count.
  await gotoLesson(page, 1);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && s.text.includes('Hello from the board!') && /Seconds since start: 0/.test(s.text), 3000);
    check(s && s.status === 'running' && !s.err && s.text.includes('Hello from the board!') && /Seconds since start: 0/.test(s.text), 'lesson 1 prints Hello and seconds (' + detail(s) + ')');
  }

  // 2. Pin 13 actually toggles.
  await gotoLesson(page, 2);
  const blink = new Set();
  for (let i = 0; i < 16; i++){
    blink.add(await page.evaluate(() => window.__pinbypin.sim.pins[13].out));
    await sleep(200);
  }
  const blinkState = await page.evaluate(readSim);
  check(blinkState.status === 'running' && !blinkState.err && blink.has(0) && blink.has(1), 'lesson 2 pin 13 toggles (saw ' + [...blink].join(',') + ')');

  // 3. PWM on pin 9 moves.
  await gotoLesson(page, 3);
  const levels = new Set();
  for (let i = 0; i < 8; i++){
    levels.add(await page.evaluate(() => window.__pinbypin.sim.pins[9].pwm));
    await sleep(80);
  }
  const fadeState = await page.evaluate(readSim);
  check(fadeState.status === 'running' && !fadeState.err && levels.size >= 2, 'lesson 3 pin 9 PWM changes (saw ' + [...levels].join(',') + ')');

  // 4. Button pin is an input with the pullup on. Nothing is pressed, so no serial yet.
  await gotoLesson(page, 4);
  {
    const button = await until(page, s => s.status === 'running' && !s.err && s.pins[2].mode === 2, 2000);
    check(button && button.status === 'running' && !button.err && button.pins[2].mode === 2, 'lesson 4 pin 2 is INPUT_PULLUP (' + detail(button) + ')');
  }

  // 5–6, 8–16. Each one has a line or a pin we can see.
  await gotoLesson(page, 5);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && /Pot: \d+/.test(s.text) && /LED: \d+/.test(s.text), 3000);
    check(s && /Pot: \d+/.test(s.text) && /LED: \d+/.test(s.text) && !s.err, 'lesson 5 prints the knob and the LED level (' + detail(s) + ')');
  }

  await gotoLesson(page, 6);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && s.pins[9].pwm === 255, 2000);
    check(s && s.pins[9].pwm === 255 && !s.err, 'lesson 6 starts on red (pin 9 PWM 255) (' + detail(s) + ')');
  }

  await gotoLesson(page, 7);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && /Light: \d+/.test(s.text), 3000);
    check(s && /Light: \d+/.test(s.text) && !s.err, 'lesson 7 prints a light reading (' + detail(s) + ')');
  }

  await gotoLesson(page, 8);
  {
    // tone() marks pin 8 as an output and then plays. The scale is over in a couple of seconds, so the pin mode is the stable signal.
    const s = await until(page, s => s.status === 'running' && !s.err && s.pins[8].mode === 1, 3000);
    check(s && s.pins[8].mode === 1 && !s.err, 'lesson 8 drives the buzzer pin (' + detail(s) + ')');
  }

  await gotoLesson(page, 9);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && /Temperature: -?\d+\.\d °C/.test(s.text), 3000);
    check(s && /Temperature: -?\d+\.\d °C/.test(s.text) && !s.err, 'lesson 9 prints degrees C (' + detail(s) + ')');
  }

  await gotoLesson(page, 10);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && /Distance: \d+\.\d cm/.test(s.text), 3000);
    check(s && /Distance: \d+\.\d cm/.test(s.text) && !s.err, 'lesson 10 prints centimetres (' + detail(s) + ')');
  }

  await gotoLesson(page, 11);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && s.servo3 === 3, 2000);
    check(s && s.servo3 === 3 && !s.err, 'lesson 11 attaches a servo on pin 3 (' + detail(s) + ')');
  }

  await gotoLesson(page, 12);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && s.text.includes('Speeding up'), 3000);
    check(s && s.text.includes('Speeding up') && !s.err, 'lesson 12 prints Speeding up (' + detail(s) + ')');
  }

  await gotoLesson(page, 13);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && s.stepper && s.text.includes('Quarter turn one way'), 3000);
    check(s && s.stepper && s.text.includes('Quarter turn one way') && !s.err, 'lesson 13 steps and says so (' + detail(s) + ')');
  }

  await gotoLesson(page, 14);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && s.lcd.includes('Pin by Pin'), 2000);
    check(s && s.lcd.includes('Pin by Pin') && !s.err, 'lesson 14 writes Pin by Pin on the LCD (' + detail(s) + ')');
  }

  await gotoLesson(page, 15);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && s.lcd.includes('Moisture:') && /^\d+$/m.test(s.text), 3000);
    check(s && s.lcd.includes('Moisture:') && /^\d+$/m.test(s.text) && !s.err, 'lesson 15 shows moisture and prints the raw reading (' + detail(s) + ')');
  }

  await gotoLesson(page, 16);
  {
    const s = await until(page, s => s.status === 'running' && !s.err && /^\d+ cm$/m.test(s.text), 3000);
    check(s && /^\d+ cm$/m.test(s.text) && !s.err, 'lesson 16 prints a distance in cm (' + detail(s) + ')');
  }

  console.log('regressions');

  // Lost edit: typing then leaving inside the 400ms debounce must keep the sketch.
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => { location.hash = '#lesson-1'; });
  await page.waitForFunction(() => (document.getElementById('title')?.textContent || '').includes('Meet'));
  await page.waitForFunction(() => window.__pinbypin.status() === 'running' && (document.getElementById('code')?.value || '').includes('Hello from the board!'));
  await page.evaluate(() => {
    const el = document.getElementById('code');
    el.value = el.value.replace('Hello from the board!', 'HELLO-KEEP');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    location.hash = '#lesson-2';
  });
  await page.waitForFunction(() => (document.getElementById('title')?.textContent || '').includes('Blink'));
  await sleep(600);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('pinbypin:code') || '{}'));
  check(kept['0'] && kept['0'].includes('HELLO-KEEP'), 'edit survives a lesson change inside 400ms');

  // Run writes localStorage before it returns to the click handler.
  await page.evaluate(() => { location.hash = '#lesson-1'; });
  await page.waitForFunction(() => (document.getElementById('title')?.textContent || '').includes('Meet'));
  const ran = await page.evaluate(() => {
    const el = document.getElementById('code');
    el.value = el.value.replace(/Hello from the board!|HELLO-KEEP/g, 'HELLO-RUN');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('runBtn').click();
    return localStorage.getItem('pinbypin:code') || '';
  });
  check(ran.includes('HELLO-RUN'), 'Run saves the sketch immediately');

  // Braceless infinite loop must keep the page responsive, then Stop must work.
  const yielded = await page.evaluate(() => window.__pinbypin.transpile('void setup(){}\nvoid loop(){ while (1) digitalWrite(13, HIGH); }\n').js);
  check(/while\s*\(\s*1\s*\)\s*\{\s*await __tick\(\)/.test(yielded), 'braceless while transpiles to await __tick()');
  const emptyFor = await page.evaluate(() => window.__pinbypin.transpile('void setup(){}\nvoid loop(){ for(;;); }\n').js);
  check(/for\s*\(\s*;\s*;\s*\)\s*\{\s*await __tick\(\)/.test(emptyFor), 'empty for(;;) transpiles to await __tick()');
  await runSketch(page, 'void setup(){}\nvoid loop(){ while (1) digitalWrite(13, HIGH); }\n');
  let responsive = false;
  try {
    await page.waitForFunction(() => window.__pinbypin.sim.pins[13].out === 1, null, { timeout: 3000 });
    responsive = true;
  } catch (e) { responsive = false; }
  check(responsive, 'braceless while (1) digitalWrite stays responsive');
  if (responsive){
    await page.evaluate(() => document.getElementById('stopBtn').click());
    await page.waitForFunction(() => window.__pinbypin.status() === 'stopped', null, { timeout: 3000 });
    check(true, 'Stop still works during that loop');
  } else {
    check(false, 'Stop still works during that loop');
  }

  // A one-line if without a semicolon is an error. The same line with a semicolon runs.
  const missing = await page.evaluate(async () => {
    document.getElementById('code').value = 'void setup(){ Serial.begin(9600); }\nvoid loop(){\n  if (millis() < 50) Serial.println("a")\n  Serial.println("b");\n}\n';
    document.getElementById('runBtn').click();
    await new Promise(r => setTimeout(r, 250));
    return { status: window.__pinbypin.status(), text: window.__pinbypin.serialLines().map(l => l.t).join('\n') };
  });
  check(missing.status === 'error' && /Line 3 is missing a semicolon/.test(missing.text), 'one-line if without a semicolon names line 3 (' + missing.text.replace(/\n/g, ' | ') + ')');

  const present = await page.evaluate(async () => {
    document.getElementById('code').value = 'void setup(){ Serial.begin(9600); if (1) Serial.println("yes"); }\nvoid loop(){}\n';
    document.getElementById('runBtn').click();
    await new Promise(r => setTimeout(r, 250));
    return { status: window.__pinbypin.status(), text: window.__pinbypin.serialLines().map(l => l.t).join('\n') };
  });
  check(present.status === 'running' && present.text.includes('yes'), 'one-line if with a semicolon still runs');

  // Servo holds Timer1: analogWrite on 9 and 10 is ignored until detach().
  await runSketch(page, `#include <Servo.h>
Servo arm;
void setup() {
  arm.attach(9);
  analogWrite(9, 200);
  analogWrite(10, 180);
  analogWrite(5, 77);
  delay(2500);
  arm.detach();
  analogWrite(9, 210);
  analogWrite(10, 190);
  delay(2500);
}
void loop() {}
`);
  const servoMid = await page.waitForFunction(() => {
    const s = window.__pinbypin.sim;
    if (!s || s.pins[5].pwm !== 77) return null;
    return { p9: s.pins[9].pwm, p10: s.pins[10].pwm, p5: s.pins[5].pwm };
  }, null, { timeout: 4000 }).then(h => h.jsonValue()).catch(() => null);
  check(servoMid && servoMid.p9 === null && servoMid.p10 === null && servoMid.p5 === 77, 'servo attached: pins 9 and 10 ignore analogWrite, pin 5 does not (' + JSON.stringify(servoMid) + ')');
  const servoAfter = await page.waitForFunction(() => {
    const s = window.__pinbypin.sim;
    if (!s || s.pins[9].pwm !== 210) return null;
    return { p9: s.pins[9].pwm, p10: s.pins[10].pwm };
  }, null, { timeout: 5000 }).then(h => h.jsonValue()).catch(() => null);
  check(servoAfter && servoAfter.p9 === 210 && servoAfter.p10 === 190, 'detach() gives PWM on 9 and 10 back (' + JSON.stringify(servoAfter) + ')');

  // tone() holds Timer2: analogWrite on 3 and 11 is ignored until noTone().
  await runSketch(page, `void setup() {
  tone(8, 440);
  analogWrite(3, 180);
  analogWrite(11, 90);
  analogWrite(6, 60);
  delay(2500);
  noTone(8);
  analogWrite(3, 181);
  analogWrite(11, 91);
  delay(2500);
}
void loop() {}
`);
  const toneMid = await page.waitForFunction(() => {
    const s = window.__pinbypin.sim;
    if (!s || !s.tone || s.pins[6].pwm !== 60) return null;
    return { p3: s.pins[3].pwm, p11: s.pins[11].pwm, p6: s.pins[6].pwm, tone: s.tone.pin };
  }, null, { timeout: 4000 }).then(h => h.jsonValue()).catch(() => null);
  check(toneMid && toneMid.p3 === null && toneMid.p11 === null && toneMid.p6 === 60 && toneMid.tone === 8, 'tone() active: pins 3 and 11 ignore analogWrite, pin 6 does not (' + JSON.stringify(toneMid) + ')');
  const toneAfter = await page.waitForFunction(() => {
    const s = window.__pinbypin.sim;
    if (!s || s.tone || s.pins[3].pwm !== 181) return null;
    return { p3: s.pins[3].pwm, p11: s.pins[11].pwm, tone: s.tone };
  }, null, { timeout: 5000 }).then(h => h.jsonValue()).catch(() => null);
  check(toneAfter && toneAfter.p3 === 181 && toneAfter.p11 === 91 && toneAfter.tone === null, 'noTone() gives PWM on 3 and 11 back (' + JSON.stringify(toneAfter) + ')');

  // int a = 1, b = 2 must not create window.a / window.b. A bare assignment must not either.
  const declared = await page.evaluate(async () => {
    delete window.keptA; delete window.keptB;
    const code = 'void setup(){\n  Serial.begin(9600);\n  int keptA = 1, keptB = 2;\n  Serial.println(keptA);\n  Serial.println(keptB);\n}\nvoid loop(){}\n';
    document.getElementById('code').value = code;
    document.getElementById('runBtn').click();
    await new Promise(r => setTimeout(r, 300));
    return {
      status: window.__pinbypin.status(),
      text: window.__pinbypin.serialLines().map(l => l.t).join(','),
      a: Object.prototype.hasOwnProperty.call(window, 'keptA'),
      b: Object.prototype.hasOwnProperty.call(window, 'keptB'),
      js: window.__pinbypin.transpile(code).js,
    };
  });
  check(declared.status === 'running' && declared.text.includes('1') && declared.text.includes('2') && !declared.a && !declared.b && /let keptA = __int\(1\), keptB = __int\(2\)/.test(declared.js), 'int keptA = 1, keptB = 2 prints both and stays off window (' + declared.text + ')');

  const stray = await page.evaluate(async () => {
    delete window.strayGlobal;
    document.getElementById('code').value = 'void setup(){ strayGlobal = 4; }\nvoid loop(){}\n';
    document.getElementById('runBtn').click();
    await new Promise(r => setTimeout(r, 250));
    return {
      status: window.__pinbypin.status(),
      leaked: Object.prototype.hasOwnProperty.call(window, 'strayGlobal'),
      text: window.__pinbypin.serialLines().map(l => l.t).join(' | '),
    };
  });
  check(stray.status === 'error' && !stray.leaked, 'an undeclared assignment errors instead of leaking (' + stray.text + ')');

  check(httpErrors.length === 0, 'no HTTP errors' + (httpErrors.length ? ': ' + httpErrors.join('; ') : ''));
  check(consoleErrors.length === 0, 'no console errors' + (consoleErrors.length ? ': ' + consoleErrors.join('; ') : ''));
  check(pageErrors.length === 0, 'no uncaught page errors' + (pageErrors.length ? ': ' + pageErrors.join('; ') : ''));
} finally {
  await browser.close();
  server.close();
}

if (failures.length){
  console.error('\n' + failures.length + ' check(s) failed');
  process.exit(1);
}
console.log('\nall checks passed');
