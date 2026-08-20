# Worktrees move inside the checkout: `.worktree/<task>`, git-ignored

Linked git worktrees now live at `.worktree/<task>` inside the repository instead of as sibling
directories outside it; the directory is git-ignored so a broad `git add` in the main tree can
never swallow a task checkout, and AGENTS.md records the convention (create with
`git worktree add .worktree/<task> -b <branch>`, remove the folder once its branch has merged).
