// Derives web assets from the user-approved artwork in brand-source/.
// The art is only cropped, resized, recoloured to alpha and composited onto
// icon backgrounds. It is never redrawn or traced.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (name) => fileURLToPath(new URL(`../brand-source/${name}`, import.meta.url));
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
mkdirSync(out("brand"), { recursive: true });
mkdirSync(out("icons"), { recursive: true });

// Ink-on-white line art -> black ink on transparent, cropped to the sword.
// Used with CSS mask-image so the mark follows the theme colour.
async function inkToAlpha(file, name, size) {
  const { data, info } = await sharp(src(file)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < data.length; i++) {
    const a = Math.max(0, Math.min(255, Math.round(((235 - data[i]) / 235) * 255 * 1.15)));
    rgba[i * 4 + 3] = a;
  }
  const base = sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } });
  const trimmed = await base.png().toBuffer();
  const box = await sharp(trimmed).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).toBuffer({ resolveWithObject: true });
  const pad = 8;
  await sharp(box.data)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ height: size, fit: "inside" })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toFile(out(`brand/${name}.webp`));
  const meta = await sharp(out(`brand/${name}.webp`)).metadata();
  console.log(name, meta.width, "x", meta.height);
}

// Small-size derivative for the topbar: same drawing, alpha curve lifted so the
// hairlines survive downscaling (no geometry change).
async function compact(file, name, height) {
  const { data, info } = await sharp(src(file)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < data.length; i++) rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(((235 - data[i]) / 235) * 255 * 1.15)));
  const trimmed = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const box = await sharp(trimmed).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).toBuffer();
  const small = await sharp(box).resize({ height, fit: "inside", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < small.data.length; i += 4) small.data[i] = Math.round(255 * Math.pow(small.data[i] / 255, 0.55));
  await sharp(small.data, { raw: small.info }).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(out(`brand/${name}.webp`));
}
await compact("WindSwordAI logo, tilted, clean (1).png", "windsword-clean-sm", 160);

await inkToAlpha("WindSwordAI logo, tilted, shaded.png", "windsword-shaded", 800);
await inkToAlpha("WindSwordAI logo, tilted, clean (1).png", "windsword-clean", 800);

// Full-colour blue-steel art: already transparent. Trim and derive sizes.
const bs = await sharp(src("01_windsword_base_enhanced_transparent.png")).trim({ threshold: 4 }).toBuffer();
const bsMeta = await sharp(bs).metadata();
console.log("bluesteel trimmed", bsMeta.width, "x", bsMeta.height);
await sharp(bs).resize({ height: 1200, fit: "inside" }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(out("brand/windsword-bluesteel.webp"));
await sharp(bs).resize({ height: 640, fit: "inside" }).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(out("brand/windsword-bluesteel-640.webp"));

// Charcoal-stone tile for app icons (home-screen, favicon, OG).
function stoneSvg(size, radius) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="g" cx="32%" cy="22%" r="95%">
      <stop offset="0" stop-color="#3b4047"/><stop offset=".55" stop-color="#23262b"/><stop offset="1" stop-color="#121417"/>
    </radialGradient>
    <filter id="n" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="7" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 -.18"/>
    </filter>
    <filter id="v" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".012 .02" numOctaves="4" seed="3" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .9 -.28"/>
    </filter>
    <clipPath id="c"><rect width="${size}" height="${size}" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="${size}" height="${size}" fill="url(#g)"/>
    <rect width="${size}" height="${size}" filter="url(#v)" opacity=".5"/>
    <rect width="${size}" height="${size}" filter="url(#n)" opacity=".11"/>
    <rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="${radius}" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="${Math.max(1, size / 256)}"/>
  </g>
</svg>`);
}

async function tile(file, size, { radius, swordScale }) {
  const h = Math.round(size * swordScale);
  const sword = await sharp(bs).resize({ height: h, width: h, fit: "inside" }).toBuffer();
  const glow = await sharp(sword).blur(Math.max(1, size / 40)).modulate({ brightness: 1.6 }).linear(0.5, 0).toBuffer();
  await sharp(stoneSvg(size, radius))
    .composite([{ input: glow, gravity: "center" }, { input: sword, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(out(file));
}

await tile("icons/icon-512.png", 512, { radius: 112, swordScale: 0.8 });
await tile("icons/icon-192.png", 192, { radius: 42, swordScale: 0.8 });
// iOS applies its own mask, so ship a full-bleed square.
await tile("icons/apple-touch-icon.png", 180, { radius: 0, swordScale: 0.78 });
// Maskable: keep the sword inside the 80% safe zone, full-bleed background.
await tile("icons/icon-maskable-512.png", 512, { radius: 0, swordScale: 0.62 });
await tile("favicon-32.png", 32, { radius: 7, swordScale: 0.92 });

// Social / OG card 1200x630
const ogSword = await sharp(bs).resize({ height: 520, fit: "inside" }).toBuffer();
const ogBg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><radialGradient id="g" cx="72%" cy="40%" r="80%"><stop offset="0" stop-color="#1f3a63"/><stop offset=".5" stop-color="#15181d"/><stop offset="1" stop-color="#0c0e11"/></radialGradient></defs><rect width="1200" height="630" fill="url(#g)"/><text x="80" y="300" font-family="Helvetica, Arial, sans-serif" font-size="84" font-weight="700" fill="#f3f6fb">WindSwordAI</text><text x="84" y="360" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#9db4d6">Secure, local-first legal AI workspace</text></svg>`);
await sharp(ogBg).composite([{ input: ogSword, left: 700, top: 55 }]).png().toFile(out("brand/og-card.png"));

// Same-canvas effect layers (aura / wind / beam / red gem). Not trimmed so they
// register exactly over the base art when stacked.
const layers = {
  "base": "01_windsword_base_enhanced_transparent.png",
  "aura": "02_windsword_glowing_blue_aura.png",
  "wind": "03_windsword_wind_energy.png",
  "beam": "04_windsword_blade_light_beam.png",
  "gem": "05_windsword_red_gem_aura.png",
};
for (const [key, file] of Object.entries(layers)) {
  await sharp(src(file)).resize(960).webp({ quality: 86, alphaQuality: 95, effort: 6 }).toFile(out(`brand/layer-${key}.webp`));
  await sharp(src(file)).resize(560).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(out(`brand/layer-${key}-560.webp`));
}

// Multi-size .ico (PNG-in-ICO)
const icoSizes = [16, 32, 48];
const pngs = [];
for (const s of icoSizes) {
  const h = Math.round(s * 0.92);
  const sw = await sharp(bs).resize({ height: h, width: h, fit: "inside" }).toBuffer();
  pngs.push(await sharp(stoneSvg(s, Math.round(s * 0.22))).composite([{ input: sw, gravity: "center" }]).png().toBuffer());
}
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const dir = pngs.map((p, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(icoSizes[i], 0); e.writeUInt8(icoSizes[i], 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(p.length, 8); e.writeUInt32LE(offset, 12); offset += p.length; return e;
});
const { writeFileSync } = await import("node:fs");
writeFileSync(out("favicon.ico"), Buffer.concat([header, ...dir, ...pngs]));
console.log("done");
