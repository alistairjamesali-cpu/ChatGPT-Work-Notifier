# Contributing

Use a feature branch and keep changes narrowly scoped. Run the JavaScript regression suite and the Python audits before opening a pull request.

On Windows:

```powershell
node installer/run-node-tests.js
python tests/static-audit.py
python tests/final-100-audit.py
```

Changes to runtime behavior should include a regression test where practical. Do not commit cookies, browser profiles, session tokens, runtime state, diagnostic bundles, or user-specific paths.
