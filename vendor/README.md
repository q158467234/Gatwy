# vendor/

Prebuilt third-party packages that are not on a public registry. Each file here is referenced by
a `file:` dependency, so `npm install` and the Docker build work without network access to its
source.

| File | Used by | Source |
|---|---|---|
| `devolutions-iron-remote-desktop-rdp-<version>-gatwy.<commit>.tgz` | `packages/client` | Fork of [Devolutions/IronRDP](https://github.com/Devolutions/IronRDP) with EGFX + WebCodecs H.264 for the web client; see [docs/rdp-webcodecs-poc-result.md](../docs/rdp-webcodecs-poc-result.md). The suffix is the fork commit it was built from. |

## Updating the IronRDP package

1. Commit the change in the fork (`/home/ljz/Documents/LWL/IronRDP-poc`).
2. `./poc/build-web.sh --pack <gatwy>/vendor` — refuses to pack an uncommitted tree.
3. Delete the previous tarball, point `packages/client/package.json` at the new file name, run `npm install`.
4. Rebuild and test the client; commit the tarball, `package.json` and `package-lock.json` together.
