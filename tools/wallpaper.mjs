/**
 * Turns the wallpaper originals into the two files the site actually loads.
 *
 *   node tools/wallpaper.mjs      (needs sharp: npm i -D sharp)
 *
 * `assets/*.png` are the exports, untouched, wordmark and all. This writes
 * `assets/*.webp` beside them, and does two things on the way:
 *
 * **Size.** 1.9MB of PNG becomes about 100KB of WebP. The wallpaper is the
 * first thing the page paints, and a desktop that takes two megabytes to
 * appear is a desktop nobody waits for.
 *
 * **The wordmark.** The brand lock-up sits across the middle of both exports,
 * which is exactly where the desktop icons and their labels land, so the two
 * fight each other. It is lifted off the sky and put back higher up, clear of
 * the icon row, in two steps:
 *
 * 1. *A clean plate.* The band is replaced by a horizontal crossfade between
 *    the sky immediately left of it and the sky immediately right of it,
 *    feathered on every edge. Columns rather than rows, because a sky gradient
 *    runs vertically: a column taken from beside the box already has the right
 *    colour for every row, where a row stretched downwards drags the mountain
 *    tops up into the sky.
 *
 * 2. *A difference matte.* With a clean plate of what the sky looks like
 *    without the lock-up, the lock-up is simply wherever the original differs
 *    from the plate. That gives an alpha channel no colour-keying could:
 *    grey letters and an orange mark come out together, edges and all, and it
 *    is composited back at LOGO.top with its own colours untouched.
 *
 * To ship the exports exactly as they are, point the two `background-image`
 * rules in `desk.css` at the PNGs and delete this file.
 */
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const DIR = fileURLToPath(new URL("../assets/", import.meta.url));
// The ink sits at roughly x 160-910, y 400-550 in both files. The box has to
// clear it by more than FEATHER on every side, or the fade at the box edge
// lets the bottom of the letters show through.
const BOX = { left: 110, top: 358, width: 850, height: 232 };
const SAMPLE = 16; // rows of sky taken from just outside the box
const FEATHER = 34;

/**
 * Where the lock-up goes back.
 *
 * `top` is in the original's coordinates and has to clear the icon row once the
 * picture is drawn `cover` behind the desktop. On a 1440x852 desktop the icons
 * start at about y=427 of the source image, so a lock-up sitting at y=152 ends
 * around y=290: high in the sky, with the whole icon row below it. `scale`
 * shrinks it a little: this is a mark on a wallpaper now, not the headline of a
 * brand sheet.
 */
const LOGO = { top: 152, scale: 0.82 };

/**
 * The lock-up's own bounds, tighter than BOX.
 *
 * BOX has to be generous so its feathered edge clears the letters. The matte
 * must not be: every extra row is sky, and sky is where the clean plate and
 * the original honestly disagree: a wisp of cloud the crossfade could not
 * know about comes out as a rectangle of half-opaque haze around the words.
 */
const INK = { left: 152, top: 392, width: 764, height: 168 };
const MATTE = { floor: 50, range: 70 }; // ignore noise below `floor`, opaque by `floor + range`

/** A greyscale ramp: 0 at the left of the box, 255 at the right. */
function horizontalRamp(w, h) {
  const buf = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) buf[y * w + x] = Math.round((x / (w - 1)) * 255);
  }
  return buf;
}

/** Opaque in the middle, fading to nothing within FEATHER px of every edge. */
function featherMask(w, h, f) {
  const buf = Buffer.alloc(w * h);
  const ease = (d) => Math.round(255 * Math.min(1, d / f));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      buf[y * w + x] = Math.min(ease(x), ease(w - 1 - x), ease(y), ease(h - 1 - y));
    }
  }
  return buf;
}

/**
 * The lock-up's alpha, from how far the original strays from the clean plate.
 *
 * Anything within `floor` of the plate is sky that the crossfade reproduced,
 * and is transparent. Everything past it is ink, ramped to opaque over
 * `range`, which keeps the anti-aliased edge of a letter soft instead of
 * cutting it into a staircase.
 */
function differenceMatte(original, plate, w, h) {
  const buf = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    const diff = Math.max(
      Math.abs(original[o] - plate[o]),
      Math.abs(original[o + 1] - plate[o + 1]),
      Math.abs(original[o + 2] - plate[o + 2])
    );
    buf[i] = Math.round(255 * Math.min(1, Math.max(0, diff - MATTE.floor) / MATTE.range));
  }
  return buf;
}

/** A rectangle of a raw RGB buffer, as a raw RGB buffer. */
function cropRaw(buf, srcW, { left, top, width, height }) {
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    buf.copy(out, y * width * 3, ((top + y) * srcW + left) * 3, ((top + y) * srcW + left + width) * 3);
  }
  return out;
}

/** A slice of the picture, stretched to fill the whole box. */
async function stretch(file, region) {
  return sharp(file)
    .extract(region)
    .resize(BOX.width, BOX.height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
}

for (const name of ["Light_theme", "Dark_theme"]) {
  const src = `${DIR}${name}.png`;
  const { width: iw, height: ih } = await sharp(src).metadata();

  // Columns, not rows. A sky gradient runs vertically, so a column taken from
  // beside the box carries the right colour for every row; stretching it
  // sideways continues the picture, where stretching a row downwards dragged
  // the mountain tops up into the sky.
  const left = await stretch(src, { left: BOX.left - SAMPLE, top: BOX.top, width: SAMPLE, height: BOX.height });
  const right = await stretch(src, { left: BOX.left + BOX.width, top: BOX.top, width: SAMPLE, height: BOX.height });

  // crossfade: the right-hand sky laid over the left-hand sky, left to right
  const fade = await sharp(right, { raw: { width: BOX.width, height: BOX.height, channels: 3 } })
    .joinChannel(horizontalRamp(BOX.width, BOX.height), { raw: { width: BOX.width, height: BOX.height, channels: 1 } })
    .png()
    .toBuffer();

  const patch = await sharp(left, { raw: { width: BOX.width, height: BOX.height, channels: 3 } })
    .composite([{ input: fade, blend: "over" }])
    .blur(10) // the sky is smooth; this kills any banding from the stretch
    .removeAlpha()
    .raw()
    .toBuffer();

  const feathered = await sharp(patch, { raw: { width: BOX.width, height: BOX.height, channels: 3 } })
    .joinChannel(featherMask(BOX.width, BOX.height, FEATHER), {
      raw: { width: BOX.width, height: BOX.height, channels: 1 },
    })
    .png()
    .toBuffer();

  // The lock-up itself: original pixels, alpha from the difference matte, both
  // read from the tight INK rectangle rather than the whole patched box.
  const original = await sharp(src).extract(INK).removeAlpha().raw().toBuffer();
  const plate = cropRaw(patch, BOX.width, {
    left: INK.left - BOX.left,
    top: INK.top - BOX.top,
    width: INK.width,
    height: INK.height,
  });

  // Two pipelines, not one. sharp resizes before it joins a channel, so asking
  // a single pipeline to do both hands the matte to an image that is no longer
  // its size, and the letters come out sheared into ribbons.
  const matted = await sharp(original, { raw: { width: INK.width, height: INK.height, channels: 3 } })
    .joinChannel(differenceMatte(original, plate, INK.width, INK.height), {
      raw: { width: INK.width, height: INK.height, channels: 1 },
    })
    .png()
    .toBuffer();

  const lockup = await sharp(matted)
    .resize(Math.round(INK.width * LOGO.scale), Math.round(INK.height * LOGO.scale))
    .png()
    .toBuffer();

  const out = `${DIR}${name}.webp`;
  const info = await sharp(src)
    .composite([
      { input: feathered, left: BOX.left, top: BOX.top },
      {
        input: lockup,
        left: Math.round((iw - INK.width * LOGO.scale) / 2),
        top: LOGO.top,
      },
    ])
    .webp({ quality: 88, effort: 6 })
    .toFile(out);

  console.log(`${name}.webp  ${iw}x${ih}  ${(info.size / 1024).toFixed(0)}KB  (lock-up moved to y=${LOGO.top})`);
}
