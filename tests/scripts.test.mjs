// tests/scripts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DIR = path.resolve("plugin/skills/petty-thief/scripts");
// Built at runtime so no literal in the repo matches the pre-commit secret pattern.
const TOKEN = "pt_" + "abcdefgh".repeat(4);

function server(handler) {
  const requests = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      handler(req, res, body);
    });
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, requests, close: () => srv.close() })),
  );
}

// A HOME with no profile, so the developer's own ~/.petty-thief/profile.yaml never changes a result.
const EMPTY_HOME = mkdtempSync(path.join(tmpdir(), "pt-nohome-"));

function run(script, args, config, input = "", { cwd, home = EMPTY_HOME } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile("sh", [path.join(DIR, script), ...args], { cwd, env: { ...process.env, HOME: home, PETTY_THIEF_CONFIG: config } }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr, ms: Date.now() - started }),
    );
    // Always close stdin, so a script that reads it never waits.
    child.stdin.end(input);
  });
}

function configFile(url) {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "pt-")), "config.json");
  if (url) writeFileSync(f, `{\n  "url": "${url}",\n  "token": "${TOKEN}"\n}\n`);
  return f;
}

const okJson = (data) => (req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(data)); };

test("connect reads the token from stdin, writes a private config and checks the connection", async () => {
  const s = await server(okJson({ waiting: 2 }));
  const f = configFile();
  const r = await run("stash.sh", ["connect", `${s.url}/`], f, `${TOKEN}\n`);
  s.close();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "Connected. 2 links waiting.");
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.match(readFileSync(f, "utf8"), new RegExp(`"url": "${s.url}"`));
  assert.equal(s.requests[0].auth, `Bearer ${TOKEN}`);
});

test("connect refuses a token passed as an argument", async () => {
  const r = await run("stash.sh", ["connect", "http://127.0.0.1:9", TOKEN], configFile());
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /usage/i);
});

test("connect refuses malformed input", async () => {
  const badUrl = await run("stash.sh", ["connect", "not a url"], configFile(), `${TOKEN}\n`);
  assert.notEqual(badUrl.code, 0);
  assert.match(badUrl.stderr, /url looks wrong/i);
  const badToken = await run("stash.sh", ["connect", "http://127.0.0.1:9"], configFile(), "nope\n");
  assert.notEqual(badToken.code, 0);
  assert.match(badToken.stderr, /token looks wrong/i);
  const noToken = await run("stash.sh", ["connect", "http://127.0.0.1:9"], configFile(), "");
  assert.notEqual(noToken.code, 0);
});

test("count prints the number", async () => {
  const s = await server(okJson({ waiting: 3 }));
  const r = await run("stash.sh", ["count"], configFile(s.url));
  s.close();
  assert.equal(r.stdout.trim(), "3");
});

test("count fails with the HTTP status on an error page", async () => {
  const s = await server((req, res) => { res.statusCode = 502; res.end("<html>Bad gateway</html>"); });
  const r = await run("stash.sh", ["count"], configFile(s.url));
  s.close();
  assert.notEqual(r.code, 0);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /HTTP 502/);
});

test("list asks for 20 items by default and accepts a limit", async () => {
  const s = await server(okJson({ items: [] }));
  const f = configFile(s.url);
  await run("stash.sh", ["list"], f);
  await run("stash.sh", ["list", "done", "50"], f);
  const bad = await run("stash.sh", ["list", "waiting", "500"], f);
  s.close();
  assert.equal(s.requests[0].url, "/api/items?status=waiting&limit=20&untagged=only");
  assert.equal(s.requests[1].url, "/api/items?status=done&limit=50&untagged=only");
  assert.notEqual(bad.code, 0);
  assert.equal(s.requests.length, 2);
});

test("done sends valid JSON even with quotes, backslashes, newlines and Cyrillic", async () => {
  const s = await server(okJson({ ok: true }));
  const summary = 'Хук "в лоб"\\ и\nвторая строка';
  const r = await run("stash.sh", ["done", "abc123", "creator", summary, "loot/a b.md"], configFile(s.url));
  s.close();
  assert.equal(r.code, 0, r.stderr);
  const req = s.requests[0];
  assert.equal(req.method, "POST");
  assert.equal(req.url, "/api/items/abc123/done");
  const body = JSON.parse(req.body);
  assert.equal(body.lens, "creator");
  assert.equal(body.summary, 'Хук "в лоб"\\ и вторая строка');
  assert.equal(body.file, "loot/a b.md");
});

test("done rejects an unsafe id without calling the server", async () => {
  const s = await server(okJson({ ok: true }));
  const r = await run("stash.sh", ["done", "../../x"], configFile(s.url));
  s.close();
  assert.notEqual(r.code, 0);
  assert.equal(s.requests.length, 0);
});

test("commands explain what to do when not connected", async () => {
  const r = await run("stash.sh", ["count"], configFile());
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /not connected/);
});

test("session-start is silent without a config", async () => {
  const r = await run("session-start.sh", [], configFile());
  assert.deepEqual([r.code, r.stdout], [0, ""]);
});

test("session-start announces waiting links as SessionStart JSON", async () => {
  const s = await server(okJson({ waiting: 4 }));
  const r = await run("session-start.sh", [], configFile(s.url));
  s.close();
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /4 link\(s\) waiting/);
});

test("session-start stays silent when the count has not changed since its last reminder", async () => {
  const s = await server(okJson({ waiting: 4 }));
  const f = configFile(s.url);
  const first = await run("session-start.sh", [], f);
  const second = await run("session-start.sh", [], f);
  s.close();
  assert.match(first.stdout, /4 link\(s\) waiting/);
  assert.deepEqual([second.code, second.stdout], [0, ""]);
  assert.match(readFileSync(path.join(path.dirname(f), ".last-reminder"), "utf8"), /^4 [0-9]+\n$/);
});

test("session-start speaks again when the count changes or a day has passed", async () => {
  let n = 4;
  const s = await server((req, res) => okJson({ waiting: n })(req, res));
  const f = configFile(s.url);
  await run("session-start.sh", [], f);
  n = 5;
  const changed = await run("session-start.sh", [], f);
  writeFileSync(path.join(path.dirname(f), ".last-reminder"), `5 ${Math.floor(Date.now() / 1000) - 90_000}\n`);
  const nextDay = await run("session-start.sh", [], f);
  s.close();
  assert.match(changed.stdout, /5 link\(s\) waiting/);
  assert.match(nextDay.stdout, /5 link\(s\) waiting/);
});

test("session-start stays silent on zero, on an HTML error page, and on a slow server", async () => {
  const zero = await server(okJson({ waiting: 0 }));
  const html = await server((req, res) => { res.statusCode = 502; res.end("<html>Bad gateway</html>"); });
  const slow = await server((req, res) => setTimeout(() => res.end('{"waiting":9}'), 6000));
  const results = await Promise.all([zero, html, slow].map((s) => run("session-start.sh", [], configFile(s.url))));
  [zero, html, slow].forEach((s) => s.close());
  for (const r of results) assert.deepEqual([r.code, r.stdout], [0, ""]);
  assert.ok(results[2].ms < 4500, `slow server took ${results[2].ms} ms`);
});

test("connect accepts a token that ends in a carriage return (CRLF paste)", async () => {
  const s = await server(okJson({ waiting: 1 }));
  const f = configFile();
  const r = await run("stash.sh", ["connect", s.url], f, `${TOKEN}\r\n`);
  s.close();
  assert.equal(r.code, 0, r.stderr);
  assert.match(readFileSync(f, "utf8"), new RegExp(`"token": "${TOKEN}"\\n`));
});

test("connect refuses multi-line, non-https and shell-special urls without writing a config", async () => {
  const bad = [
    "http://127.0.0.1:9\nhttps://evil.test",
    "https://a.test/x\r",
    "http://evil.test",
    "ftp://a.test",
    "https://a.test/a$(touch${IFS}/tmp/pt_pwned)",
    "https://a.test/a`id`",
    "https://a.test/it's",
    'https://a.test/"x',
    "https://a.test/a\\b",
    "https://user@a.test",
  ];
  for (const url of bad) {
    const f = configFile();
    const r = await run("stash.sh", ["connect", url], f, `${TOKEN}\n`);
    assert.notEqual(r.code, 0, url);
    assert.match(r.stderr, /url looks wrong/i, url);
    assert.throws(() => statSync(f), undefined, url);
  }
});

test("connect allows https hosts with a port and a path", async () => {
  // The url is valid, so the script gets past validation and only fails to reach the host.
  const r = await run("stash.sh", ["connect", "https://pt.example.test:8443/base"], configFile(), `${TOKEN}\n`);
  assert.doesNotMatch(r.stderr, /url looks wrong/i);
});

test("done and skip reject a multi-line id without calling the server", async () => {
  const s = await server(okJson({ ok: true }));
  const f = configFile(s.url);
  const a = await run("stash.sh", ["done", "abc123\n../../x"], f);
  const b = await run("stash.sh", ["skip", "abc123\nfoo"], f);
  s.close();
  assert.notEqual(a.code, 0);
  assert.notEqual(b.code, 0);
  assert.equal(s.requests.length, 0);
});

test("done drops other control characters so the JSON stays valid", async () => {
  const s = await server(okJson({ ok: true }));
  const r = await run("stash.sh", ["done", "abc123", "creator", "a\x01b\x08c\x0bd\x0ce\x1bf\x1fg\th"], configFile(s.url));
  s.close();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(s.requests[0].body).summary, "abcdefg h");
});

test("session-start exits 0 silently when lib.sh is missing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pt-hook-"));
  const copy = path.join(dir, "session-start.sh");
  writeFileSync(copy, readFileSync(path.join(DIR, "session-start.sh")));
  const r = await new Promise((resolve) =>
    execFile("sh", [copy], { env: { ...process.env, PETTY_THIEF_CONFIG: configFile("http://127.0.0.1:9") } }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    ),
  );
  assert.deepEqual([r.code, r.stdout], [0, ""]);
});

test("session-start reads a zero-padded timestamp as decimal, not octal", async () => {
  const s = await server(okJson({ waiting: 4 }));
  const f = configFile(s.url);
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(path.join(path.dirname(f), ".last-reminder"), `4 00${now}\n`);
  const r = await run("session-start.sh", [], f);
  s.close();
  assert.deepEqual([r.code, r.stdout], [0, ""]);
});

test("session-start treats a timestamp from the future as expired", async () => {
  const s = await server(okJson({ waiting: 4 }));
  const f = configFile(s.url);
  writeFileSync(path.join(path.dirname(f), ".last-reminder"), `4 ${Math.floor(Date.now() / 1000) + 500_000}\n`);
  const r = await run("session-start.sh", [], f);
  s.close();
  assert.equal(r.code, 0);
  assert.match(r.stdout, /4 link\(s\) waiting/);
});

test("host prints the connected url and never the token", async () => {
  const connected = await run("stash.sh", ["host"], configFile("https://pt.example.test"));
  assert.equal(connected.code, 0);
  assert.equal(connected.stdout, "https://pt.example.test\n");
  assert.doesNotMatch(connected.stdout + connected.stderr, /pt_[a-z]{32}/);
  const none = await run("stash.sh", ["host"], configFile());
  assert.notEqual(none.code, 0);
  assert.equal(none.stdout, "");
});

// remind: false. Runs the hook with a chosen cwd (project) and HOME (global profile).
function runRemind({ project, global }) {
  const proj = mkdtempSync(path.join(tmpdir(), "pt-proj-"));
  const home = mkdtempSync(path.join(tmpdir(), "pt-home-"));
  if (project !== undefined) { mkdirSync(path.join(proj, ".petty-thief")); writeFileSync(path.join(proj, ".petty-thief", "profile.yaml"), project); }
  if (global !== undefined) { mkdirSync(path.join(home, ".petty-thief")); writeFileSync(path.join(home, ".petty-thief", "profile.yaml"), global); }
  return server(okJson({ waiting: 3 })).then((s) => new Promise((resolve) => {
    execFile("sh", [path.join(DIR, "session-start.sh")], { cwd: proj, env: { ...process.env, HOME: home, PETTY_THIEF_CONFIG: configFile(s.url) } }, (err, stdout) => {
      s.close();
      resolve({ code: err ? err.code : 0, stdout });
    });
  }));
}

test("session-start is silent when the project profile says remind: false", async () => {
  for (const line of ["remind: false", "  remind:   no   # quiet here", "remind: off"]) {
    const r = await runRemind({ project: `language: en\n${line}\n` });
    assert.deepEqual([r.code, r.stdout], [0, ""], line);
  }
});

test("session-start: global remind: false is overridden by project remind: true", async () => {
  const r = await runRemind({ global: "remind: false\n", project: "remind: true   # on\n" });
  assert.match(r.stdout, /3 link\(s\) waiting/);
  const g = await runRemind({ global: "remind: false\n" });
  assert.deepEqual([g.code, g.stdout], [0, ""]);
});

test("session-start still prints without any profile", async () => {
  const r = await runRemind({});
  assert.match(r.stdout, /3 link\(s\) waiting/);
});

// Project tags. A project dir (cwd) and a HOME, each with an optional profile.
function dirs({ project, global } = {}) {
  const proj = mkdtempSync(path.join(tmpdir(), "pt-proj-"));
  const home = mkdtempSync(path.join(tmpdir(), "pt-home-"));
  if (project !== undefined) { mkdirSync(path.join(proj, ".petty-thief")); writeFileSync(path.join(proj, ".petty-thief", "profile.yaml"), project); }
  if (global !== undefined) { mkdirSync(path.join(home, ".petty-thief")); writeFileSync(path.join(home, ".petty-thief", "profile.yaml"), global); }
  return { cwd: proj, home };
}

test("count and list pass the project's stash_tag, with untagged links by default", async () => {
  const s = await server((req, res) => okJson(req.url.startsWith("/api/count") ? { waiting: 2 } : { items: [] })(req, res));
  const f = configFile(s.url);
  const d = dirs({ project: 'stash_tag: "Brand"   # this project\n' });
  const c = await run("stash.sh", ["count"], f, "", d);
  await run("stash.sh", ["list"], f, "", d);
  await run("stash.sh", ["list", "done", "5"], f, "", d);
  s.close();
  assert.equal(c.stdout.trim(), "2");
  assert.deepEqual(s.requests.map((r) => r.url), [
    "/api/count?tag=brand&untagged=1",
    "/api/items?status=waiting&limit=20&tag=brand&untagged=1",
    "/api/items?status=done&limit=5&tag=brand&untagged=1",
  ]);
});

test("take_untagged: false asks for tagged links only", async () => {
  const s = await server(okJson({ waiting: 1, items: [] }));
  const f = configFile(s.url);
  const d = dirs({ project: "stash_tag: brand\ntake_untagged: false\n" });
  await run("stash.sh", ["count"], f, "", d);
  await run("stash.sh", ["list"], f, "", d);
  s.close();
  assert.deepEqual(s.requests.map((r) => r.url), ["/api/count?tag=brand&untagged=0", "/api/items?status=waiting&limit=20&tag=brand&untagged=0"]);
});

test("without stash_tag, count and list ask for untagged links only", async () => {
  const s = await server(okJson({ waiting: 1, items: [] }));
  const f = configFile(s.url);
  const d = dirs({ project: "language: en\n# stash_tag: brand\ntake_untagged: false\n" });
  await run("stash.sh", ["count"], f, "", d);
  await run("stash.sh", ["list"], f, "", d);
  s.close();
  assert.deepEqual(s.requests.map((r) => r.url), ["/api/count?untagged=only", "/api/items?status=waiting&limit=20&untagged=only"]);
});

test("an empty, null or ~ stash_tag in the project means no tag here, even with a global one", async () => {
  const s = await server(okJson({ waiting: 1 }));
  const f = configFile(s.url);
  for (const v of ["", "   # none", '""', "null", "~"]) {
    await run("stash.sh", ["count"], f, "", dirs({ global: "stash_tag: home\n", project: `stash_tag: ${v}\n` }));
  }
  s.close();
  assert.deepEqual(s.requests.map((r) => r.url), Array(5).fill("/api/count?untagged=only"));
});

test("take_untagged accepts true/false, yes/no, on/off and 1/0", async () => {
  const s = await server(okJson({ waiting: 1 }));
  const f = configFile(s.url);
  const values = { true: 1, yes: 1, on: 1, 1: 1, False: 0, no: 0, off: 0, 0: 0, '"false"': 0, "": 1 };
  for (const v of Object.keys(values)) {
    await run("stash.sh", ["count"], f, "", dirs({ project: `stash_tag: brand\ntake_untagged: ${v}\n` }));
  }
  s.close();
  assert.deepEqual(s.requests.map((r) => r.url), Object.values(values).map((u) => `/api/count?tag=brand&untagged=${u}`));
});

test("list <status> <limit> <tag> fetches exactly that tag's links, and checks it", async () => {
  const s = await server(okJson({ items: [] }));
  const f = configFile(s.url);
  const ok = await run("stash.sh", ["list", "waiting", "20", "home"], f, "", dirs({}));
  const bad = await run("stash.sh", ["list", "waiting", "20", "h&untagged=1"], f, "", dirs({}));
  s.close();
  assert.equal(ok.code, 0, ok.stderr);
  assert.notEqual(bad.code, 0);
  assert.deepEqual(s.requests.map((r) => r.url), ["/api/items?status=waiting&limit=20&tag=home&untagged=0"]);
});

test("tags prints waiting links per tag", async () => {
  const s = await server(okJson({ waiting: 1, tagged: { brand: 1, home: 2 } }));
  const r = await run("stash.sh", ["tags"], configFile(s.url));
  s.close();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(s.requests[0].url, "/api/count?by_tag=1");
  assert.equal(r.stdout, "brand 1\nhome 2\n");
});

test("the project's stash_tag wins over the global one; the global one applies when the project has none", async () => {
  const s = await server(okJson({ waiting: 1 }));
  const f = configFile(s.url);
  await run("stash.sh", ["count"], f, "", dirs({ global: "stash_tag: home\n", project: "stash_tag: brand\n" }));
  await run("stash.sh", ["count"], f, "", dirs({ global: "stash_tag: home\ntake_untagged: no\n", project: "language: en\n" }));
  s.close();
  assert.deepEqual(s.requests.map((r) => r.url), ["/api/count?tag=brand&untagged=1", "/api/count?tag=home&untagged=0"]);
});

test("a malformed stash_tag is refused before any request", async () => {
  const s = await server(okJson({ waiting: 1, items: [] }));
  const f = configFile(s.url);
  const bad = ["my brand", "-brand", "brand-", "bra_nd", "a".repeat(33), "x&untagged=0", "b$(touch${IFS}/tmp/pt_pwned)", "бренд", "a`id`"];
  for (const v of bad) {
    for (const args of [["count"], ["list"]]) {
      const r = await run("stash.sh", args, f, "", dirs({ project: `stash_tag: ${v}\n` }));
      assert.notEqual(r.code, 0, v);
      assert.match(r.stderr, /stash_tag/, v);
    }
  }
  s.close();
  assert.equal(s.requests.length, 0);
});

test("session-start counts with the tag filter and names the tag", async () => {
  const s = await server(okJson({ waiting: 2 }));
  const f = configFile(s.url);
  const r = await run("session-start.sh", [], f, "", dirs({ project: "stash_tag: brand\ntake_untagged: false\n" }));
  s.close();
  assert.equal(s.requests[0].url, "/api/count?tag=brand&untagged=0");
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^Petty Thief: 2 link\(s\) waiting for \*brand\./);
  assert.match(readFileSync(path.join(path.dirname(f), ".last-reminder-brand"), "utf8"), /^2 [0-9]+\n$/);
});

test("session-start keeps a separate reminder state per tag", async () => {
  const s = await server(okJson({ waiting: 2 }));
  const f = configFile(s.url);
  const brand = dirs({ project: "stash_tag: brand\n" });
  const a = await run("session-start.sh", [], f, "", brand);
  const b = await run("session-start.sh", [], f, "", dirs({ project: "stash_tag: home\n" }));
  const plain = await run("session-start.sh", [], f, "", dirs({}));
  const again = await run("session-start.sh", [], f, "", brand);
  s.close();
  assert.match(a.stdout, /waiting for \*brand/);
  assert.match(b.stdout, /waiting for \*home/);
  assert.match(plain.stdout, /2 link\(s\) waiting in the stash/);
  assert.equal(s.requests[2].url, "/api/count?untagged=only");
  assert.equal(again.stdout, "");
});

test("session-start stays silent on a malformed stash_tag and makes no request", async () => {
  const s = await server(okJson({ waiting: 2 }));
  const r = await run("session-start.sh", [], configFile(s.url), "", dirs({ project: "stash_tag: no good\n" }));
  s.close();
  assert.deepEqual([r.code, r.stdout], [0, ""]);
  assert.equal(s.requests.length, 0);
});
