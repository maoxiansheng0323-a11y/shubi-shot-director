# Refined White Mannequin v1

## License and source

The bundled GLB is a segmented derivative of **Human Base Meshes v1.4.1** by
Blender Studio and community contributors, published as a CC0 asset bundle on
the official
[Blender demo files and asset bundles page](https://www.blender.org/download/demo-files/#assets).
The derivative is distributed under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

- Official bundle: `human-base-meshes-bundle-v1.4.1.zip`
- Bundle URL: `https://mirror.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip`
- Bundle SHA-256: `811f43accbb31a88266d932f8f5563b2d13586fca0ba2693aad1f5fe582b3515`
- Source file in the bundle: `human_base_meshes_bundle.blend`
- Converter: `scripts/assets/build-refined-mannequin.py`
- Audited converter version: Blender 4.2.23 LTS

The source archive and Blender executable are research inputs. They are not
part of this repository or the runtime.

## Neutral derivative

The converter uses the realistic female and male primitive collections. It
verifies matching base topology, normalizes both bodies to a common height,
and averages matching vertex positions. The separate female breast object is
excluded. This produces one generic reference mannequin rather than a named or
project-specific character.

The output keeps sixteen independently articulated sections:

`pelvis`, `torso`, `neck`, `head`, left/right `upper_arm`, `forearm`, `hand`,
`upper_leg`, `lower_leg`, and `foot`.

Shoulder pieces join the torso. Facial primitives join the head. Fingers join
each hand and toes join each foot; they are visible shape detail, not separate
pose controls. Each section receives one Catmull-Clark subdivision level,
smooth normals, one neutral white material, and centered unit bounds.

## Reproduction

From the repository root, run Blender in background mode with an explicit
source and output:

```powershell
blender --background --python scripts/assets/build-refined-mannequin.py -- --source path/to/human_base_meshes_bundle.blend --output public/assets/refined-white-mannequin-v1.glb
```

Then update the manifest only if the output metrics change and run:

```powershell
pnpm vitest run tests/mannequin-asset.test.ts tests/mannequin-converter.test.ts
pnpm audit:public
```

## Committed artifact

- File: `public/assets/refined-white-mannequin-v1.glb`
- SHA-256: `1bd1bf8650a0e2b0d35e8544bca4d21a99069bcf2bd4b26974cf1b5ac1857b94`
- Byte length: `603548`
- Triangle count: `35904`
- Mesh nodes: `16`
- Materials: `1`
- Skins, armatures, animations, cameras, lights, images, textures: `0`

This asset is a renderer-owned graybox reference. It does not change SceneSpec,
the canonical pose controls, analytical bounds, contact, composition, or
software diagnostics.
