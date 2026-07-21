// Generates the PWA install icons: a flat teal square with a white checkmark
// (the verification action; on-identity, no emoji). Run once; commit the PNGs.
//   node scripts/generate-icons.mjs
import sharp from 'sharp';

const TEAL = '#0fa98e';
const WHITE = '#ffffff';

// Build an SVG string for a `size`×`size` icon.
// rounded: rounded-corner square (for the "any" icons); false = full-bleed
//   (maskable + apple-touch, where the platform applies its own mask/rounding).
// checkScale: checkmark box as a fraction of the canvas.
function iconSvg({ size, rounded, checkScale }) {
	const r = rounded ? size * 0.22 : 0;
	const s = size * checkScale;
	const cx = size / 2;
	const cy = size / 2;
	const x = cx - s / 2;
	const y = cy - s / 2;
	// Checkmark: down-stroke to the elbow, up-stroke to the tip.
	const p1 = [x + s * 0.14, y + s * 0.54];
	const p2 = [x + s * 0.4, y + s * 0.8];
	const p3 = [x + s * 0.86, y + s * 0.22];
	const stroke = size * 0.09;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
	<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${TEAL}"/>
	<path d="M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} L ${p3[0]} ${p3[1]}" fill="none" stroke="${WHITE}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

async function write(out, { renderSize, rounded, checkScale }) {
	const svg = iconSvg({ size: 512, rounded, checkScale });
	await sharp(Buffer.from(svg)).resize(renderSize, renderSize).png().toFile(out);
	console.log('wrote', out);
}

await write('static/icon-192.png', { renderSize: 192, rounded: true, checkScale: 0.55 });
await write('static/icon-512.png', { renderSize: 512, rounded: true, checkScale: 0.55 });
// Maskable: full-bleed teal, check inside Android's 80% safe zone.
await write('static/icon-512-maskable.png', { renderSize: 512, rounded: false, checkScale: 0.45 });
// apple-touch: full-bleed square; iOS applies its own corner radius.
await write('static/apple-touch-icon.png', { renderSize: 180, rounded: false, checkScale: 0.55 });
