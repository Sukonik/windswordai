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

// Social / OG card 1200x630
const ogSword = await sharp(fileURLToPath(new URL("../brand-source/icon-pack/ornate_sapphire_winged_sword.png", import.meta.url))).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 6 }).resize({ height: 520, fit: "inside" }).toBuffer();
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

// ---------------------------------------------------------------------------
// Icon pack (docs/BRAND_ASSETS.md): line marks for headers, stone/sand app icons.
// ---------------------------------------------------------------------------
const pack = (name) => src(`icon-pack/${name}.png`);
const trimmedPack = async (name) => sharp(pack(name)).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 6 }).toBuffer();

// Header mark: bold line sword (white fill, black outline) so it survives 28-40px.
// Dark theme uses it as-is; light theme inverts via CSS.
for (const [file, out_] of [["ornate_winged_fantasy_sword", "windsword-line"], ["winged_fantasy_sword_emblem", "windsword-line-alt"], ["ornate_winged_silver_sword_icon", "windsword-gray"]]) {
  const t = await trimmedPack(file);
  await sharp(t).resize({ height: 160, fit: "inside" }).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(out(`brand/${out_}.webp`));
  const m = await sharp(out(`brand/${out_}.webp`)).metadata();
  console.log(out_, m.width, "x", m.height);
}
// Full-colour primary from the pack (Home hero, social card).
{
  const t = await trimmedPack("ornate_sapphire_winged_sword");
  await sharp(t).resize({ height: 1200, fit: "inside" }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(out("brand/windsword-sapphire.webp"));
  await sharp(t).resize({ height: 640, fit: "inside" }).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(out("brand/windsword-sapphire-640.webp"));
  // Header size (36-40px @2-3x)
  await sharp(t).resize({ height: 120, fit: "inside", kernel: "lanczos3" }).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(out("brand/windsword-sapphire-sm.webp"));
  const m = await sharp(out("brand/windsword-sapphire.webp")).metadata();
  console.log("sapphire", m.width, "x", m.height);
}

// App icon tiles: the supplied tiles have black corners, so crop just inside the rounded edge.
const CROP = 0.028;
async function tileBase(file) {
  const meta = await sharp(pack(file)).metadata();
  const c = Math.round(meta.width * CROP);
  return sharp(pack(file)).extract({ left: c, top: c, width: meta.width - 2 * c, height: meta.height - 2 * c }).toBuffer();
}
function roundedMask(size, radius) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
}
async function appIcons(file, dir) {
  const base = await tileBase(file);
  mkdirSync(out(`icons/${dir}`), { recursive: true });
  // "any": rounded, transparent corners
  for (const size of [192, 512]) {
    await sharp(base).resize(size, size).composite([{ input: roundedMask(size, Math.round(size * 0.2)), blend: "dest-in" }]).png({ compressionLevel: 9 }).toFile(out(`icons/${dir}/icon-${size}.png`));
  }
  // iOS rounds it itself: full-bleed square
  await sharp(base).resize(180, 180).png({ compressionLevel: 9 }).toFile(out(`icons/${dir}/apple-touch-icon.png`));
  // maskable: blurred stone to the edges, tile inside the 80% safe zone
  const bg = await sharp(base).resize(512, 512).blur(24).toBuffer();
  const fg = await sharp(base).resize(400, 400).composite([{ input: roundedMask(400, 80), blend: "dest-in" }]).png().toBuffer();
  await sharp(bg).composite([{ input: fg, gravity: "center" }]).png({ compressionLevel: 9 }).toFile(out(`icons/${dir}/icon-maskable-512.png`));
}
await appIcons("winged_sword_on_stone_crest", "stone");
{
  const { copyFileSync } = await import("node:fs");
  for (const f of ["icon-192.png", "icon-512.png", "apple-touch-icon.png", "icon-maskable-512.png"]) copyFileSync(out(`icons/stone/${f}`), out(`icons/${f}`));
}
await appIcons("angelwing_ruby_sword_emblem", "sand");
await appIcons("winged_sword_on_ancient_stone", "ancient-sand");

// Favicons: the dark stone tile reads on any browser chrome; a thin line crop turned to mush at 16-32px.
{
  const base = await tileBase("winged_sword_on_stone_crest");
  const icoPngs = [];
  for (const size of [16, 32, 48]) {
    const png = await sharp(base).resize(size, size, { kernel: "lanczos3" }).composite([{ input: roundedMask(size, Math.round(size * 0.2)), blend: "dest-in" }]).png().toBuffer();
    await sharp(png).toFile(out(`favicon-${size}.png`));
    icoPngs.push({ size, png });
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(icoPngs.length, 4);
  let offset = 6 + 16 * icoPngs.length;
  const dir = icoPngs.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size, 0); e.writeUInt8(size, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12); offset += png.length; return e;
  });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out("favicon.ico"), Buffer.concat([header, ...dir, ...icoPngs.map((i) => i.png)]));
}

// Wake pair: the silver and sapphire swords cropped to one shared box so they
// register exactly and can cross-fade (silver at rest, colour while chat is in use).
{
  const boxOf = async (name) => {
    const { info } = await sharp(pack(name)).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 6 }).toBuffer({ resolveWithObject: true });
    return { left: -info.trimOffsetLeft, top: -info.trimOffsetTop, width: info.width, height: info.height };
  };
  const a = await boxOf("ornate_winged_silver_sword_icon");
  const b = await boxOf("ornate_sapphire_winged_sword");
  const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width), bottom = Math.max(a.top + a.height, b.top + b.height);
  const box = { left, top, width: right - left, height: bottom - top };
  for (const [name, file] of [["wake-gray", "ornate_winged_silver_sword_icon"], ["wake-color", "ornate_sapphire_winged_sword"]]) {
    const cropped = await sharp(pack(file)).extract(box).toBuffer();
    await sharp(cropped).resize({ height: 420, fit: "inside", kernel: "lanczos3" }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(out(`brand/${name}.webp`));
    await sharp(cropped).resize({ height: 120, fit: "inside", kernel: "lanczos3" }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(out(`brand/${name}-sm.webp`));
  }
  const m = await sharp(out("brand/wake-gray.webp")).metadata();
  console.log("wake pair", m.width, "x", m.height, `(box ${box.width}x${box.height})`);
}

console.log("done");
