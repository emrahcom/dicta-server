# Releasing

How to release a new version of dicta-server. This is for the maintainers.

## Version numbers

The version is in `package.json`, as `MAJOR.MINOR.PATCH`, for example `0.1.0`.

While the major number is 0:

- Raise the minor number when a change breaks existing setups. For example, a
  setting is removed or renamed, or a default changes what the server does.
  `0.1.3` becomes `0.2.0`.
- Raise the patch number for everything else: fixes and new features that do not
  break setups. `0.1.3` becomes `0.1.4`.

dicta-server and dicta-js have their own version numbers. They work together
through the protocol version, the `v1` in `/dicta/v1/listen`. A change that
breaks the protocol needs a new protocol version, not only a new version number.

## Steps

1. Run all checks on the commit you want to release:

   ```sh
   npm run check
   npm run lint
   npm run test
   ```

   Also run the tests against the real speech-to-text services, with your keys:

   ```sh
   MISTRAL_API_KEY=... DEEPGRAM_API_KEY=... npm run test:live
   ```

2. Set the new version, without a tag:

   ```sh
   npm version 0.2.0 --no-git-tag-version
   ```

   It changes `package.json` and `package-lock.json`. Commit both with the
   message `chore: release 0.2.0` and push.

3. On GitHub, create a release for that commit:
   - Tag: `v0.2.0`, created on the release commit.
   - Title: `v0.2.0`.
   - Notes: a few lines about what changed. Say clearly if setups must change.
   - Leave "Set as the latest release" on.

## Docker image

Publishing a release starts the workflow "image". It builds the Docker image and
pushes it to the GitHub registry as `ghcr.io/emrahcom/dicta-server`, with two
tags: the version, like `0.2.0`, and `latest`. The image contains the latest
dicta-js release.

So release dicta-js first when both change. A new dicta-js release reaches the
image only with the next dicta-server release. If dicta-server has no other
change, make a patch release, and write the new dicta-js version in the notes.

The workflow fails while dicta-js has no release at all.

After the first push, the image is private. Make it public once: on GitHub, open
the package `dicta-server`, then "Package settings", then "Change visibility".
