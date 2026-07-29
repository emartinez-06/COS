# Contributing to COS

Thanks for your interest.
COS is early: the highest-value contributions right now are real-world club problems, opinions on the [open questions](docs/OPEN-QUESTIONS.md), and code toward the [current roadmap phase](docs/ROADMAP.md).

## Ways to contribute

- **Report a problem you had running a club.** Open an issue describing the situation, not a proposed feature. The best COS features come from real officer pain.
- **Weigh in on an open question.** Every entry in [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) is an invitation.
- **Code.** Pick an issue, comment that you're taking it, and open a PR.

## Development setup

The monorepo uses [pnpm](https://pnpm.io) workspaces.

```sh
git clone https://github.com/emartinez-06/COS.git
cd COS
pnpm install
```

Per-package dev instructions live in each package's own README as they gain code.

## Pull requests

- Keep PRs scoped to one change.
- Say how you tested it. PRs without a testing story will be asked for one.
- New behavior needs tests once the package it touches has a test setup.
- Match the surrounding code style; don't reformat things you didn't change.

## Ground rules

- Be respectful. Assume good intent, especially with first-time contributors.
- Architecture-changing proposals belong in an issue before a PR.

## License

By contributing you agree that your contributions are licensed under [AGPL-3.0](LICENSE), the same license as the project.
