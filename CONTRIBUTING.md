# Contributing

## Run the tests
```bash
cd worker && npm install && npx vitest run && npx tsc --noEmit && cd ..
node --test tests/*.test.mjs
claude plugin validate . && claude plugin validate plugin
```

The skill evals need a local fake stash and run real Claude sessions (they use your usage):
```bash
node plugin/evals/fake-stash.mjs &
claude plugin eval plugin --scaffold --allow-tools Bash Write Edit WebFetch --no-publish --threshold 0.5 --ablation none --trust-plugin
kill %1
```

Note: the eval runs Bash in the OS sandbox, which blocks 127.0.0.1 (the fake stash) unless your Claude settings allow it (`sandbox.network.allowedDomains`, plus `allowLocalBinding` on macOS). The graded evals have not been run yet for that reason.

## Turn on the secret guard (once per clone)
```bash
git config core.hooksPath .githooks
```

The pre-commit hook blocks commits that contain something shaped like a Telegram bot token or a Petty Thief API token. There is deliberately no npm `prepare` script that sets this for you: the repo root has no `package.json`, and a clone should never change your git config without you asking. In tests and docs, build token-shaped values at runtime (for example `"pt_" + "a".repeat(32)`) instead of writing them out.

## Add a lens or collection
Put it in `plugin/skills/petty-thief/lenses/` in the shape described in `docs/customize.md`, and add an eval case if it changes routing.
