## Summary of Changes

<!-- What does this PR do? Why is it needed? Link the relevant issue(s).
     Closes #<issue-number> -->

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Refactor / code quality (no functional change)
- [ ] Documentation update
- [ ] CI / tooling change

## Testing Done

<!-- Describe the tests you ran to verify your changes. Include commands and
     relevant output where helpful. -->

**Contract (Rust)**
```
cargo test --manifest-path contracts/airdrop/Cargo.toml
```

**SDK / CLI / Web (TypeScript)**
```
pnpm test   # run from sdk/, cli/, or web/ as appropriate
```

## Checklist

- [ ] `cargo test` passes with no warnings
- [ ] `pnpm test` passes for any changed TypeScript packages
- [ ] New or changed behaviour is covered by tests
- [ ] Documentation updated (README, `docs/`, or inline doc comments)
- [ ] No secrets, private keys, or credentials are included in this PR
- [ ] Branch is up to date with `main`
