# Credits

Palatinus's code, text and art are original; its figures are painted in code
(`src/art/`), from no outside drawings. The third-party work it
ships is listed here, each piece under a licence that allows it to be
bundled and redistributed. Nothing extracted from Ogre Battle 64 is ever part
of this repository or of a build (see the README).

## Fonts

| Font | Use | Licence | Source |
|---|---|---|---|
| Cinzel, by Natanael Gama | Titles and headings | SIL Open Font License 1.1 | npm `@fontsource/cinzel` |
| Alegreya Sans, by Juan Pablo del Peral (Huerta Tipográfica) | Interface text | SIL Open Font License 1.1 | npm `@fontsource/alegreya-sans` |

The fonts are bundled from npm at build time; their licence texts travel with
the packages in `node_modules/@fontsource/*/LICENSE`.

## 3D models, textures and skies

| Work | Use | Licence | Source |
|---|---|---|---|
| KayKit Medieval Hexagon Pack 1.0, by Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com)) | The campaign map's castles, watchtowers and town buildings in each side's colours; its pines, boulders, clouds and flags | CC0 1.0 (public domain) | [KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0) |

The models used are packed into `src/assets/models/world.glb` by
`npm run pack:models` (`tools/pack-models.ts`, which lists them), with the
pack's licence beside it. Nothing else in the map is drawn from outside work:
its ground, water and sky are generated in code.
