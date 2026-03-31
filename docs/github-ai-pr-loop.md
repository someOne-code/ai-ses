# Controlled AI PR Loop

This repo uses a controlled AI pull request loop, not a fully automatic self-merge loop.

The goal is:

1. local coding agent writes code
2. a draft PR is opened fast
3. GitHub Copilot reviews the draft
4. a maintainer can trigger one focused AI fix pass
5. a human still owns final review and merge

## Repo-owned pieces

- `.github/copilot-instructions.md`
- `.github/workflows/copilot-controlled-autofix.yml`
- `scripts/open-ai-draft-pr.ps1`
- `scripts/copilot-autofix.mjs`

## One-time GitHub setup

These settings must be enabled in GitHub. They cannot be fully enforced from the repository alone.

1. Repository `Settings -> Rules -> Rulesets -> New branch ruleset`.
2. Turn on `Automatically request Copilot code review`.
3. Turn on `Review new pushes` if you want Copilot to review after later human pushes.
4. Turn on `Review draft pull requests`.
5. Repository `Settings -> Copilot -> Code review`: keep `Use custom instructions when reviewing pull requests` enabled so `.github/copilot-instructions.md` is used.
6. Ensure Copilot coding agent access is allowed for the repository if you want `/copilot-autofix` to work.
7. Keep normal branch protection and required human approval in place. Copilot review is advisory, not your merge gate.

## Daily flow

1. Work locally in VS Code with your coding agent.
2. Push the branch.
3. Run `.\scripts\open-ai-draft-pr.ps1`.
4. Wait for Copilot review on the draft PR.
5. If the review is useful and you want one AI repair pass, comment `/copilot-autofix` on the PR.
6. The workflow collects unresolved Copilot review threads and posts one focused `@copilot` change request back onto the same draft PR.
7. Re-review manually, run the relevant checks, then mark the PR ready when it is actually safe.

## Guardrails

- `/copilot-autofix` only works on draft pull requests.
- Only repository collaborators, members, or owners can trigger it from a PR comment.
- The workflow only forwards unresolved Copilot review threads.
- It does not auto-merge, auto-approve, or mark the PR ready.
- Duplicate requests for the same head SHA are ignored.
- Treat it as one controlled repair pass, not as an unattended loop controller.

## Notes

- `scripts/open-ai-draft-pr.ps1` expects GitHub CLI `v2.88.0` or newer so `@copilot` can be requested as a reviewer.
- If your current branch already has a PR, the script reuses it and only refreshes the Copilot review request.
- If Copilot review automation was enabled after a draft PR was already open, push one more commit to retrigger review on that PR.
- If you prefer, you can also run the workflow manually from the Actions tab with a PR number.
