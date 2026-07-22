# Contributing

Issues and focused pull requests are welcome. By contributing, you agree that your contribution is licensed under the repository's MIT License.

Do not include credentials, production domains, IP addresses, database exports, user content or third-party assets without redistribution permission. Keep deployment-specific configuration outside tracked files.

Before requesting review, run:

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run extension:test
npm run build
npm run extension:build
```

Authentication, authorization, outbound networking, image import, account import/export, migrations, deployment or backup changes require security and recovery tests. User-facing changes should include proportional component or Playwright coverage.
