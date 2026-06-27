// ─── GPM Scene Builder — Iframe Viewer ─────────────────────────────────────
// Runs inside viewer.html as an external script (not inline) to comply with
// Manifest V3's extension-page CSP which forbids inline <script> blocks.

console.log('[GPM Viewer] viewer.js loaded. typeof THREE =', typeof THREE);

let scene, camera, renderer, sphere, texture;
let yaw = 0, pitch = 0;
let isDragging = false;
let dragStartX = 0, dragStartY = 0, yawAtStart = 0, pitchAtStart = 0;
let raf = null;
let currentLens = '50mm';

const host = document.getElementById('canvas-host');

// Lens → vertical FOV (full-frame approximation; viewer feel only — the prompt is what Grok sees)
function lensToFov(lensId) {
  switch (lensId) {
    case '12mm': return 100;  // ultra-wide, dramatic perspective (v12.7.4)
    case '24mm': return 73;
    case '35mm': return 54;
    case '50mm': return 39;
    case '85mm': return 24;
    default:     return 39;
  }
}

function init() {
  const w = host.clientWidth || 320;
  const h = host.clientHeight || 200;
  console.log('[GPM Viewer] init dimensions:', w, 'x', h);

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(lensToFov(currentLens), w / h, 0.1, 1100);
  camera.position.set(0, 0, 0.01);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true, // required for toDataURL() capture to work reliably
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h);
  host.appendChild(renderer.domElement);

  // Inverted sphere — panorama wraps around camera
  const geo = new THREE.SphereGeometry(500, 60, 40);
  geo.scale(-1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  sphere = new THREE.Mesh(geo, mat);
  scene.add(sphere);

  // Drag-to-look (mouse + touch)
  const onDown = (e) => {
    isDragging = true;
    const pt = e.touches ? e.touches[0] : e;
    dragStartX = pt.clientX;
    dragStartY = pt.clientY;
    yawAtStart = yaw;
    pitchAtStart = pitch;
    host.classList.add('dragging');
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!isDragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - dragStartX;
    const dy = pt.clientY - dragStartY;
    yaw   = yawAtStart   - dx * 0.005;
    pitch = pitchAtStart + dy * 0.005;
    const lim = Math.PI / 2 - 0.05;
    if (pitch >  lim) pitch =  lim;
    if (pitch < -lim) pitch = -lim;
    parent.postMessage({ type: 'gpm-scene-aim', yaw, pitch }, '*');
    e.preventDefault();
  };
  const onUp = () => {
    isDragging = false;
    host.classList.remove('dragging');
  };

  host.addEventListener('mousedown',  onDown);
  window.addEventListener('mousemove',  onMove);
  window.addEventListener('mouseup',    onUp);
  host.addEventListener('touchstart', onDown, { passive: false });
  host.addEventListener('touchmove',  onMove, { passive: false });
  host.addEventListener('touchend',   onUp);

  // Resize
  window.addEventListener('resize', resize);
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  animate();
  parent.postMessage({ type: 'gpm-scene-ready' }, '*');
  console.log('[GPM Viewer] init complete, posted gpm-scene-ready');
}

function resize() {
  if (!renderer) return;
  const w = host.clientWidth  || 320;
  const h = host.clientHeight || 200;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  raf = requestAnimationFrame(animate);
  if (!camera || !renderer) return;
  const x = Math.cos(pitch) * Math.sin(yaw);
  const y = Math.sin(pitch);
  const z = Math.cos(pitch) * Math.cos(yaw);
  camera.lookAt(x, y, z);
  camera.fov = lensToFov(currentLens);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

function loadPanorama(dataUrl) {
  console.log('[GPM Viewer] loadPanorama called, dataUrl length:', dataUrl ? dataUrl.length : 'null');
  if (!sphere) {
    console.warn('[GPM Viewer] sphere not ready');
    return;
  }
  const loader = new THREE.TextureLoader();
  loader.load(
    dataUrl,
    (tex) => {
      console.log('[GPM Viewer] texture loaded, image:', tex.image ? `${tex.image.width}×${tex.image.height}` : 'unknown');
      if (texture) texture.dispose();
      texture = tex;
      sphere.material.map = tex;
      sphere.material.color.setHex(0xffffff);
      sphere.material.needsUpdate = true;
      parent.postMessage({ type: 'gpm-scene-loaded' }, '*');
    },
    undefined,
    (err) => {
      console.error('[GPM Viewer] texture load failed:', err);
      parent.postMessage({ type: 'gpm-scene-error', message: 'Texture load failed' }, '*');
    }
  );
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (typeof msg.type !== 'string' || !msg.type.startsWith('gpm-scene-')) return;
  console.log('[GPM Viewer] msg from parent:', msg.type);
  if (msg.type === 'gpm-scene-load' && msg.dataUrl) {
    loadPanorama(msg.dataUrl);
  } else if (msg.type === 'gpm-scene-set-lens') {
    currentLens = msg.lens || '50mm';
  } else if (msg.type === 'gpm-scene-reset-aim') {
    yaw = 0;
    pitch = 0;
    parent.postMessage({ type: 'gpm-scene-aim', yaw, pitch }, '*');
  } else if (msg.type === 'gpm-scene-set-aim') {
    if (typeof msg.yaw === 'number') yaw = msg.yaw;
    if (typeof msg.pitch === 'number') pitch = msg.pitch;
  } else if (msg.type === 'gpm-scene-capture') {
    captureFramedView(msg.requestId, msg.width || 1280, msg.height || 720);
  }
});

// ── Off-screen high-res capture ─────────────────────────────────────────────
// Re-renders the current view at the requested resolution (default 1280×720,
// true 16:9), grabs the canvas pixels as a JPEG dataURL, then restores the
// renderer to its original on-screen size. The user's aim/lens/texture are
// preserved — we're just temporarily rendering bigger.
function captureFramedView(requestId, captureW, captureH) {
  if (!renderer || !camera || !sphere) {
    parent.postMessage({ type: 'gpm-scene-captured', requestId, error: 'Viewer not ready' }, '*');
    return;
  }
  if (!sphere.material.map) {
    parent.postMessage({ type: 'gpm-scene-captured', requestId, error: 'No panorama loaded' }, '*');
    return;
  }
  // Save current size + DPR scaling so we can restore exactly
  const origSize = renderer.getSize(new THREE.Vector2());
  const origDpr  = renderer.getPixelRatio();
  const origAspect = camera.aspect;

  try {
    // Render at native pixel resolution — DPR=1 so width/height are literal pixels
    renderer.setPixelRatio(1);
    renderer.setSize(captureW, captureH, false);
    camera.aspect = captureW / captureH;
    camera.updateProjectionMatrix();

    // One synchronous render at the new size
    renderer.render(scene, camera);

    // Grab pixels — JPEG quality 0.9 keeps file size sane (~200KB at 1280×720)
    const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.9);

    parent.postMessage({ type: 'gpm-scene-captured', requestId, dataUrl }, '*');
    console.log('[GPM Viewer] captured frame', captureW + 'x' + captureH, 'bytes:', dataUrl.length);
  } catch (err) {
    console.error('[GPM Viewer] capture failed:', err);
    parent.postMessage({ type: 'gpm-scene-captured', requestId, error: err.message || 'capture failed' }, '*');
  } finally {
    // Restore on-screen renderer size + DPR
    renderer.setPixelRatio(origDpr);
    renderer.setSize(origSize.x, origSize.y, false);
    camera.aspect = origAspect;
    camera.updateProjectionMatrix();
  }
}

if (typeof THREE === 'undefined') {
  console.error('[GPM Viewer] Three.js failed to load');
  parent.postMessage({ type: 'gpm-scene-error', message: 'Three.js failed to load in iframe' }, '*');
} else {
  console.log('[GPM Viewer] THREE r' + THREE.REVISION + ' loaded');
  try {
    init();
  } catch (err) {
    console.error('[GPM Viewer] init error:', err);
    parent.postMessage({ type: 'gpm-scene-error', message: 'init failed: ' + (err.message || err) }, '*');
  }
}
