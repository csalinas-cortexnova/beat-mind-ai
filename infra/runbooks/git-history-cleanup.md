# Git History Cleanup Runbook

> **Purpose:** Remove `.env.local` and any `.env` files from the entire git history to prevent credential exposure.
>
> **When to run:** Once, before production launch. After this, `.gitignore` prevents future commits.

## Pre-Requisites

- All team members notified (they will need to re-clone after force push)
- Credentials already rotated (see `credential-rotation.md`)
- Clean working directory (`git stash` any changes)

## Method A: BFG Repo-Cleaner (Recommended)

BFG is faster and simpler than `git filter-branch` or `git filter-repo`.

### 1. Install BFG

```bash
# macOS
brew install bfg

# Linux (download jar)
wget https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar
alias bfg='java -jar bfg-1.14.0.jar'
```

### 2. Clone a fresh mirror

```bash
# Work in a temp directory
cd /tmp
git clone --mirror git@github.com:YOUR_ORG/beat-mind-ai.git
cd beat-mind-ai.git
```

### 3. Remove .env files from all history

```bash
# Remove specific files
bfg --delete-files '.env.local'
bfg --delete-files '.env'
bfg --delete-files '.env.production'
bfg --delete-files '.env.staging'
```

### 4. Clean up and verify

```bash
# Expire reflogs and garbage collect
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Verify files are gone
git log --all --full-history -- .env.local
# Should return empty
```

### 5. Force push

```bash
git push --force
```

### 6. Notify team

Send to all contributors:

> The git repository has been cleaned to remove accidentally committed environment files.
> Please delete your local clone and re-clone:
> ```
> rm -rf beat-mind-ai
> git clone git@github.com:YOUR_ORG/beat-mind-ai.git
> ```
> Do NOT `git pull` on existing clones — the history has been rewritten.

## Method B: git filter-repo (Alternative)

Use this if BFG is not available.

### 1. Install

```bash
# macOS
brew install git-filter-repo

# pip
pip install git-filter-repo
```

### 2. Run filter

```bash
# Must be run from a fresh clone (not a mirror)
git clone git@github.com:YOUR_ORG/beat-mind-ai.git /tmp/beat-mind-ai-clean
cd /tmp/beat-mind-ai-clean

git filter-repo --invert-paths \
    --path .env \
    --path .env.local \
    --path .env.production \
    --path .env.staging
```

### 3. Force push

```bash
git remote add origin git@github.com:YOUR_ORG/beat-mind-ai.git
git push --force --all
git push --force --tags
```

## Post-Cleanup Verification

```bash
# Clone fresh and verify
git clone git@github.com:YOUR_ORG/beat-mind-ai.git /tmp/verify
cd /tmp/verify

# Search entire history for env files
git log --all --full-history -- '.env*'
# Expected: empty output

# Search for credential patterns
git log --all -p | grep -i 'sk_live\|sk_test\|CLERK_SECRET' | head -5
# Expected: empty output

# Verify .gitignore still blocks env files
cat .gitignore | grep '.env'
# Expected: .env* line present
```

## Checklist

- [ ] All credentials rotated BEFORE cleanup (old values are compromised regardless)
- [ ] Mirror clone created (not in-place rewrite)
- [ ] BFG or filter-repo executed successfully
- [ ] `git log --all -- .env.local` returns empty
- [ ] Force push completed
- [ ] All team members notified to re-clone
- [ ] CI/CD pipelines reconfigured if needed
- [ ] Verified .gitignore still contains `.env*`
