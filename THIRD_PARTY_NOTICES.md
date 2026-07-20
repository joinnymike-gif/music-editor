# Third-party notices

## University of Iowa Musical Instrument Samples (recorded instrument layers)

The recorded piano, acoustic guitar, violin, flute, and double-bass layers in
`public/samples/iowa-mis/` are derived from the University of Iowa Electronic
Music Studios' Musical Instrument Samples Database. The source site states that
its recordings may be downloaded and used in projects without restrictions.

- Source and attribution: University of Iowa Electronic Music Studios,
  <https://theremin.music.uiowa.edu/MIS.html>
- Source recordings used: Steinway piano (mf C3/C4/C5), Raimundo 118 guitar
  (mf, sul E, C3–B3), violin arco (mf, sul G, G3–B3), flute vibrato (mf,
  C5–B5), and Wurlitzer upright double bass pizzicato (mf, sul E, C2–B2).
- Packaging: the application ships trimmed, 44.1 kHz PCM WAV playback layers;
  the per-layer SHA-256 values are listed in `src/instruments/registry.ts`.

Every recorded layer has its own source, attribution, licence statement and
hash in the instrument registry. If a layer cannot be fetched, its SHA-256
does not match, or it cannot be decoded, the application blocks playback and
WAV export rather than substituting a synthesized voice.

## J. Learman Rhodes Mark I electric piano

The electric-piano layers are derived from the J. Learman 1977 Rhodes Mark I
Stage 73 collection, distributed by `danigb/samples`. The upstream repository
identifies this collection as CC0 1.0. The compact WAV layers and their hashes
are listed in `src/instruments/registry.ts`.

- Source: <https://github.com/danigb/samples/tree/main/audio/jlearman>
- Attribution: J. Learman / sfzinstruments
- License: CC0 1.0

## Tone.js 15.1.22

Copyright (c) 2014–2020 Yotam Mann. Distributed under the MIT License.

Tone.js provides transport timing and Web Audio integration. Its oscillator is
used only by the registry's explicitly labelled `square_lead` synthesiser; it
is never a procedural-instrument fallback for a recorded instrument. The
locked package artifact is identified by
SHA-256 `e290952fa43d9a7a780182a83c6fccf44d79cb7ae2cba102ef1f2b9d98124e22`
for `node_modules/tone/build/Tone.js`.

MIT License

Copyright (c) 2014-2020 Yotam Mann

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
