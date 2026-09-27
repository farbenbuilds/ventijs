# Third-Party Notices

ventijs ships a prebuilt native addon. The addon statically links the
µWebZockets engine and its vendored dependencies, so their license texts are
included in each published platform artifact.

## Runtime components

µWebZockets is the first-party engine created for ventijs by the same author
and is pinned in `build.zig.zon`. The remaining runtime component is:

| Component                                              | Version or revision       | License |
| ------------------------------------------------------ | ------------------------- | ------- |
| [napi-zig](https://github.com/yuku-toolchain/napi-zig) | pinned in `build.zig.zon` | MIT     |

## Components vendored by the engine

These are pinned by the uWebZockets revision selected in `build.zig.zon`.
Each entry is the version or revision the engine's pinned manifest records.

| Component                   | Version or revision                      | License                            |
| --------------------------- | ---------------------------------------- | ---------------------------------- |
| zslay                       | 0.2.1                                    | MIT                                |
| libxev                      | 9ce8e8e6ff89e583258a7f8e7adeeeaeae8611bf | MIT                                |
| BoringSSL                   | 5fbad2285b096858fc9afa3e4c949fde39452070 | ISC-style and component licenses   |
| Fiat Crypto (via BoringSSL) | BoringSSL revision above                 | Apache-2.0                         |
| lsquic                      | 4.10.0                                   | MIT and bundled component licenses |
| ls-qpack                    | 2.7.0                                    | MIT                                |
| ls-hpack                    | 38ceca78054d4175ba3f6411b1b83ac5c485e542 | MIT                                |
| libdeflate                  | 1.26 (92e6a0d)                           | MIT                                |
| zlib                        | 1.3.2                                    | zlib License                       |

BoringSSL is distributed under an ISC-style license with additional component
licenses. lsquic bundles third-party code with its own notices. The complete
license texts are copied into `licenses/vendor` inside each published native
artifact and into the npm tarball. Every one of these libraries is compiled
into the addon from its pinned package sources, so none of them is resolved
from the host toolchain at build or run time.

## Vendored type definitions

`src/types/ws.d.ts` is adapted from the DefinitelyTyped declarations for `ws`
(MIT) and is embedded in `dist/index.d.mts`. No `ws` runtime code is
incorporated.

| Component                                                                            | License |
| ------------------------------------------------------------------------------------ | ------- |
| [@types/ws](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/ws) | MIT     |

## Vendored upstream documentation

| Component                             | Version or revision | License |
| ------------------------------------- | ------------------- | ------- |
| [`ws` API reference](docs/ventijs.md) | `ws` 8.21.3         | MIT     |

`docs/ventijs.md` is a copy of the upstream `ws` API reference document,
`doc/ws.md`, credited to the `ws` authors and the
[`websockets/ws`](https://github.com/websockets/ws) repository. The credit is at
the top of the file as well as here. Its body is the upstream document byte for
byte apart from the title, which is retitled for a ventijs reader. It is vendored
because it is the compatibility contract: it is what ventijs is compared
against. It is not ventijs documentation, it is not kept in sync by hand, and it
is replaced wholesale when the pinned `ws` version changes.

## Development-only tooling

The following are development dependencies. They are not shipped in the
published package and require no runtime attribution.

| Component   | License    |
| ----------- | ---------- |
| lefthook    | MIT        |
| oxfmt       | MIT        |
| oxlint      | MIT        |
| tsdown      | MIT        |
| vitest      | MIT        |
| vite        | MIT        |
| TypeScript  | Apache-2.0 |
| bumpp       | MIT        |
| @types/node | MIT        |
| @types/ws   | MIT        |
| ws          | MIT        |
| Node.js     | MIT        |
| pnpm        | MIT        |
| Zig         | MIT        |
| Nix         | LGPL-2.1   |

## CI-only conformance tooling

The RFC 6455 conformance suite is run in CI by pulling a container image. It is
never shipped in the package, and nothing from it is vendored into this
repository.

| Component                                                                         | Version or revision         | License    |
| --------------------------------------------------------------------------------- | --------------------------- | ---------- |
| [crossbario/autobahn-testsuite](https://github.com/crossbario/autobahn-testsuite) | `25.10.1`, pinned by digest | Apache-2.0 |

The Autobahn testsuite is copyright typedef int GmbH and is distributed under
the Apache License 2.0. The reference is by digest rather than by tag because
the repository publishes only `latest` and `25.10.1`, and both resolve to the
same manifest, `sha256:519915fb568b04c9383f70a1c405ae3ff44ab9e35835b085239c258b6fac3074`;
a tag would let a rebuilt image change the case set under the gate. Copyright
typedef int GmbH also holds the `autobahntestsuite` distribution this image is
built from.

## Benchmark provenance

The benchmark harness in `bench/` runs `ws` 8.21.3, a devDependency, alongside
the candidate build and writes a JSON report. It vendors no third-party code. A
report records its own provenance, so a number can be traced to the run that
produced it: the schema version, the commit and whether the tree was dirty, the
Node.js, pnpm, and Zig versions, the `pnpm-lock.yaml` hash, the resolved `ws`
version, and the CPU model, count, and memory of the host. No benchmark number is
recorded in this file; the retained reports are the evidence, as described in
[CI_CD_PIPELINE.md](CI_CD_PIPELINE.md).

## Maintenance

Every dependency change updates the pinned revision in `build.zig.zon`
together with this file. Binary releases copy the license texts for all
statically linked components; a release is not published while any shipped
component lacks an attribution entry.
