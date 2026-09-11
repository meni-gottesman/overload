#!/usr/bin/env python3
"""Stamp the build and pin the CSP to the exact script that ships.

The page's only script is inline. A hash-based script-src means an injected
<script> — from any XSS path — does not execute, because its hash is not the
one in the policy. 'unsafe-inline' is gone. The hash must be recomputed after
every edit to the script (the BUILD stamp alone changes it), so this runs
before every commit. `node test.js` and `node test-sync.js` still pass on the
output because they read the script block, not the policy.

Usage: python3 build.py   (idempotent; safe to run twice)
"""
import base64, datetime, hashlib, re, sys

p = "index.html"
s = open(p, encoding="utf-8").read()

# 1. stamp
s = re.sub(r'const BUILD = "[^"]*";',
           'const BUILD = "%s";' % datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), s)

# 2. hash the inline script exactly as the browser will see it
m = re.search(r"<script>(.*?)</script>", s, re.S)
if not m:
    sys.exit("no inline script found")
digest = hashlib.sha256(m.group(1).encode("utf-8")).digest()
h = "sha256-" + base64.b64encode(digest).decode()

# 3. rewrite script-src in the CSP meta
new_csp = None
def fix(mm):
    global new_csp
    csp = mm.group(1)
    csp = re.sub(r"script-src [^;]*", "script-src '%s'" % h, csp)
    new_csp = csp
    return '<meta http-equiv="Content-Security-Policy" content="%s">' % csp
s2, n = re.subn(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">', fix, s, count=1)
if n != 1:
    sys.exit("CSP meta not found")
open(p, "w", encoding="utf-8").write(s2)
print("build stamped; script-src pinned to", h[:24] + "…")
