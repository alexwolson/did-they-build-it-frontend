// Delta-time confetti burst. No dependencies, honors prefers-reduced-motion.
const COLORS = ['#0f766e', '#16a34a', '#f59e0b', '#3b82f6', '#ec4899'];

export function burst(x: number, y: number): void {
	if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
		return;
	}

	const canvas = document.createElement('canvas');
	const dpr = Math.min(devicePixelRatio || 1, 2);
	canvas.width = innerWidth * dpr;
	canvas.height = innerHeight * dpr;
	canvas.style.cssText =
		'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
	document.body.appendChild(canvas);
	const ctx = canvas.getContext('2d')!;
	ctx.scale(dpr, dpr);

	const parts = Array.from({ length: 60 }, () => {
		const angle = Math.random() * Math.PI * 2;
		const speed = 220 + Math.random() * 380; // px/s
		return {
			x,
			y,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed - 260,
			size: 5 + Math.random() * 5,
			color: COLORS[(Math.random() * COLORS.length) | 0],
			spin: (Math.random() - 0.5) * 18,
			rot: Math.random() * Math.PI
		};
	});

	const G = 1500; // px/s²
	const DURATION = 900; // ms
	const start = performance.now();
	let prev = start;

	function frame(now: number) {
		const dt = Math.min((now - prev) / 1000, 0.05); // seconds; clamp tab-switch spikes
		prev = now;
		const t = now - start;
		ctx.clearRect(0, 0, innerWidth, innerHeight);
		const alpha = 1 - t / DURATION;
		for (const p of parts) {
			p.vy += G * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.rot += p.spin * dt;
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.rotate(p.rot);
			ctx.globalAlpha = Math.max(alpha, 0);
			ctx.fillStyle = p.color;
			ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
			ctx.restore();
		}
		if (t < DURATION) requestAnimationFrame(frame);
		else canvas.remove();
	}
	requestAnimationFrame(frame);
}
