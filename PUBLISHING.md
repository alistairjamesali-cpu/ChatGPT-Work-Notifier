# Publishing to GitHub

This directory is ready to use as the repository root.

## First publish

Create an empty GitHub repository, then run these commands from this directory:

```powershell
git init
git add .
git commit -m "Initial ChatGPT Work Notifier v2.4.0 release"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

The CI workflow validates the JavaScript regression suite and Python audits on Windows.

## Build the Windows installer

You can build the installer manually with Inno Setup 6 by compiling:

`installer\ChatGPTWorkNotifier.iss`

The output is:

`dist\ChatGPT-Work-Notifier-Setup-2.4.0.exe`

You can also open **Actions → Build Windows Installer → Run workflow** on GitHub. The workflow uploads the compiled EXE as an Actions artifact.

## Publish a GitHub Release

Push a version tag:

```powershell
git tag v2.4.0
git push origin v2.4.0
```

The release workflow validates the repository, builds the EXE, computes its SHA-256 file, creates the GitHub Release when needed, and uploads both release assets.

## Before making the repository public

Choose the repository visibility you want and add an open-source license only if you intend to grant reuse rights. No license choice has been imposed by this packaging pass.
