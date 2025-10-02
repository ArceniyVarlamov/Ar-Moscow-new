export async function compositeSnapshot({ video, canvas }, opts = {}) {
  if (!video && !canvas) throw new Error('no sources');

  await new Promise(requestAnimationFrame);

  const glCanvas = canvas;
  const width = glCanvas?.width || window.innerWidth;
  const height = glCanvas?.height || window.innerHeight;

  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const ctx = output.getContext('2d');

  if (video) {
    const vw = video.videoWidth || width;
    const vh = video.videoHeight || height;
    const scale = Math.max(width / vw, height / vh);
    const drawWidth = vw * scale;
    const drawHeight = vh * scale;
    const dx = (width - drawWidth) / 2;
    const dy = (height - drawHeight) / 2;
    ctx.drawImage(video, dx, dy, drawWidth, drawHeight);
  } else {
    // If no video, assume canvas contains full composition (e.g., Zappar scene)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
  }

  if (glCanvas) ctx.drawImage(glCanvas, 0, 0, width, height);

  // Optional vintage overlay (vignette + border)
  if (opts && opts.vintage) {
    try {
      // Vignette
      const grad = ctx.createRadialGradient(width/2, height/2, Math.min(width,height)*0.20, width/2, height/2, Math.max(width,height)*0.75);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Subtle warm tone
      ctx.fillStyle = 'rgba(255, 214, 170, 0.05)';
      ctx.fillRect(0, 0, width, height);

      // Border frame
      const margin = Math.round(Math.min(width, height) * 0.03);
      ctx.lineWidth = Math.max(2, Math.round(margin * 0.4));
      ctx.strokeStyle = 'rgba(30, 26, 22, 0.85)';
      ctx.strokeRect(margin, margin, width - margin*2, height - margin*2);
    } catch (_) {}
  }

  return output.toDataURL('image/png');
}
