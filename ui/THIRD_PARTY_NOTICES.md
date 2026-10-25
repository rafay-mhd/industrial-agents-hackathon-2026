# Third-party notices

The voice orb shader is adapted from [ElevenLabs UI Orb](https://github.com/elevenlabs/ui/blob/3a28ebab197f8cfa599934f52db12ad1396e54f4/apps/www/registry/elevenlabs-ui/ui/orb.tsx), discovered through [21st.dev](https://preview.21st.dev/%40ElevenLabs-crawled/components/orb). Changes: a royal blue / red / gold ramp, direct Three.js lifecycle, locally generated noise, audio-level refs and reduced-motion support. This is a visual component; the building agent remains our existing Claude agent.

MIT License

Copyright (c) 2025 Eleven Labs Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Design references: [Claude](https://github.com/voltagent/awesome-design-md/blob/main/design-md/claude/DESIGN.md) and [Apple](https://github.com/voltagent/awesome-design-md/blob/main/design-md/apple/DESIGN.md), used for warm editorial spacing, restrained surfaces, readable hierarchy and compact controls. No brand assets copied.

Pixel people are original SVG artwork created for this project. Lobster and DM Sans are bundled via Fontsource under their included SIL Open Font Licenses. Building data retains its original metadata, attribution and source licenses.

Exterior footprint unions and offsets use [ClipperLib](https://github.com/junmer/clipper-lib), under the [Boost Software License 1.0](https://www.boost.org/LICENSE_1_0.txt). Copyright Angus Johnson 2010–2017; JavaScript translation by Timo. The library includes Tom Wu’s JSBN code (Copyright 2005 Tom Wu), with its [license notice](https://www-cs-students.stanford.edu/~tjw/jsbn/LICENSE). Original notices are retained in the dependency source.

The guide’s pulsing aurora border uses [Paper Shaders](https://github.com/paper-design/shaders), also featured in [21st.dev’s Northern lights component](https://21st.dev/@paper-design/components/pulsing-border-northern-lights). Installed from the official `@paper-design/shaders-react` package. The Inside palette, layout and integration are original. Paper Shaders is Apache-2.0, Copyright 2026 Paper. Its full license and NOTICE are distributed in `public/licenses/paper-shaders-LICENSE.txt` and `public/licenses/paper-shaders-NOTICE.txt`. Powered by Paper Shaders: https://shaders.paper.design.

The page and map background use the user-supplied “Flow field” fragment shader exported from the 21st.dev Shader Builder. Its GLSL is preserved in `src/components/flow-field.frag`. The original WebGL1 triangle renderer and lighter ivory/champagne palette are implemented in `FlowField.tsx`.
