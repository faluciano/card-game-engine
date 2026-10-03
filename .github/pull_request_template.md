## Summary

<!-- What does this PR change, and why? Link related issues. -->

## Type of change

<!-- Conventional Commit type used in the title: feat / fix / docs / refactor / test / chore -->

## Checklist

- [ ] `bun run lint` passes
- [ ] `bun run typecheck` passes
- [ ] Tests pass in every affected package (`cd packages/<pkg> && bunx vitest run`)
- [ ] `bun run validate` passes (rulesets still parse)
- [ ] `bun run schema:check` passes (JSON Schema regenerated if `validation.ts` changed)
- [ ] Docs updated (`README.md`, `docs/`, `AGENTS.md`) if behaviour or commands changed
- [ ] One concern per PR
