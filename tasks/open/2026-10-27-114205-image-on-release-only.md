# Image on releases only

Build the image only when a release is published, per `architecture.md` (Image
workflow).

- `.github/workflows/image.yml`: remove `workflow_dispatch` and the lookup of
  the latest `dicta-server` release; the tag is always the release's tag.
- Docs: `docs/releasing.md` (Docker image) drops the run by hand, says that a
  new `dicta-js` release needs a `dicta-server` release to reach the image, and
  that `dicta-js` is released first.
- Check: the workflow file is valid YAML and its shell has no syntax errors.
