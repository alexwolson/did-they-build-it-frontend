// Downscale a camera photo to ≤ maxDim px JPEG before upload (fast on LTE).
export async function downscale(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * scale);
	const h = Math.round(bitmap.height * scale);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
	);
}
