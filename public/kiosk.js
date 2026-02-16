// QR Scanner for Kiosk Mode using BarcodeDetector API or fallback
const video = document.getElementById('kiosk-video');
const resultDiv = document.getElementById('kiosk-result');
let scanning = true;
let lastScanned = '';
let lastScanTime = 0;

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
    });
    video.srcObject = stream;
  } catch (err) {
    resultDiv.style.display = 'block';
    resultDiv.className = 'error';
    resultDiv.textContent = 'Camera access denied. Please allow camera permissions.';
  }
}

// Use BarcodeDetector if available
let detector = null;
if ('BarcodeDetector' in window) {
  detector = new BarcodeDetector({ formats: ['qr_code'] });
}

async function scanFrame() {
  if (!scanning || !video.srcObject || video.readyState < 2) {
    requestAnimationFrame(scanFrame);
    return;
  }

  if (detector) {
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) {
        handleScan(barcodes[0].rawValue);
      }
    } catch (e) {}
  }

  requestAnimationFrame(scanFrame);
}

function handleScan(url) {
  // Debounce: don't scan same code within 5 seconds
  const now = Date.now();
  if (url === lastScanned && now - lastScanTime < 5000) return;
  lastScanned = url;
  lastScanTime = now;

  // Extract token from URL
  const match = url.match(/\/checkin\/([A-Za-z0-9_-]+)/);
  if (!match) return;

  scanning = false;

  // Navigate to checkin URL in an iframe-like fashion
  fetch(url)
    .then(res => res.text())
    .then(html => {
      // Parse the response for status
      if (html.includes('checkin-card success')) {
        showResult('success', html);
      } else if (html.includes('checkin-card already')) {
        showResult('already', html);
      } else {
        showResult('error', html);
      }
    })
    .catch(() => {
      showResult('error', null);
    });
}

function showResult(status, html) {
  resultDiv.style.display = 'block';
  resultDiv.className = status;

  if (status === 'success') {
    // Extract name from heading
    const nameMatch = html.match(/Welcome, (.+?)!/);
    const name = nameMatch ? nameMatch[1] : 'Guest';
    resultDiv.innerHTML = `&#9989; Welcome, ${name}!<br><small>Checked in successfully</small>`;
  } else if (status === 'already') {
    resultDiv.innerHTML = `&#9888;&#65039; Already checked in<br><small>This guest was already registered</small>`;
  } else {
    resultDiv.innerHTML = `&#10060; Invalid QR Code<br><small>Please see a volunteer</small>`;
  }

  // Resume scanning after 4 seconds
  setTimeout(() => {
    resultDiv.style.display = 'none';
    scanning = true;
  }, 4000);
}

// If no BarcodeDetector, show fallback message
if (!detector) {
  // Load jsQR as fallback
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
  script.onload = function() {
    startFallbackScanner();
  };
  script.onerror = function() {
    resultDiv.style.display = 'block';
    resultDiv.className = 'error';
    resultDiv.innerHTML = 'QR scanning not supported in this browser.<br><small>Try Chrome or Edge on Android/desktop</small>';
  };
  document.head.appendChild(script);
}

function startFallbackScanner() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function scanFallback() {
    if (!scanning || !video.srcObject || video.readyState < 2) {
      requestAnimationFrame(scanFallback);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (typeof jsQR !== 'undefined') {
      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (code && code.data) {
        handleScan(code.data);
      }
    }

    requestAnimationFrame(scanFallback);
  }

  scanFallback();
}

// Start
startCamera();
if (detector) {
  video.addEventListener('loadeddata', () => requestAnimationFrame(scanFrame));
}
