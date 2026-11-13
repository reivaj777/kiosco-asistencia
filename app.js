// ==========================================
// CONFIGURACIÓN Y VARIABLES GLOBALES
// ==========================================
const API_URL = "https://script.google.com/macros/s/AKfycbwc5kuAuMLBvhdFk-IWgs5s7Ly231_yDHONGR4psLMzveBPnBJqW1_z8mwveES7GaoQtg/exec";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => console.log("SW:", err));
  });
}

lucide.createIcons();
let currentUser = null;
let currentEmpresa = null;
let currentReportData = [];
let currentEmpleadosData = [];
let currentEmpresasList = [];
let currentUsuariosList = [];
let currentLat = null, currentLng = null, base64Photo = null;
let videoStream = null;
let isSavingEmpleado = false;
let selectedIncidenciaTarget = null;
let pendingConsent = null;
let currentConsentText = "";

// Biometría IA y Escáner QR en el mismo Visor Circular
let faceModelsLoaded = false;
let kioskEmpresa = JSON.parse(localStorage.getItem('kiosco_empresa') || 'null');
let empleadosPinMap = JSON.parse(localStorage.getItem('kiosco_pin_map') || '{}');
let labeledFaceDescriptors = [];
let faceMatcher = null;
let faceDetectionInterval = null;
let faceIntervalMs = 400;
let qrScanInterval = null;
let isQrModeActive = false;
let enrolDescriptor = null;
let enrolInterval = null;
let currentEnrolId = null;
let enrolModo = "CAMARA";

// Layouts de Nómina
let currentLayoutsData = {};
let currentLayoutSistema = null;
let currentExportSistema = null;
let currentMuestraLayoutData = null;

// Reloj en vivo para el Kiosco
setInterval(() => {
  const clk = document.getElementById('live-clock');
  if (clk) clk.innerText = new Date().toLocaleTimeString('es-MX', { hour12: false });
}, 1000);

// Síntesis de Voz (Audio Feedback)
function hablarKiosco(texto) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(texto);
    utter.lang = 'es-MX';
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  }
}

function tieneModulo(empresaObj, mod) {
  if (!empresaObj || !empresaObj.modulos) return true;
  return String(empresaObj.modulos).toUpperCase().split(',').map(s => s.trim()).includes(mod);
}

function puede(accion) {
  if (!currentUser) return false;
  if (currentUser.rol === 'SUPER_ADMIN') return true;
  if (!currentUser.permisos || !currentUser.permisos.length) return true;
  return currentUser.permisos.includes('*') || currentUser.permisos.includes(accion);
}

function imprimirElemento(elementId) {
  document.getElementById(elementId).classList.add('printable-active');
  window.print();
}

function cerrarModalImpresion(modalId, elementId) {
  document.getElementById(elementId).classList.remove('printable-active');
  document.getElementById(modalId).classList.add('hidden');
}

function mostrarSaludoKiosco(nombreCompleto) {
  const card = document.getElementById('kiosk-greeting-card');
  const nameEl = document.getElementById('kiosk-greeting-name');
  const avatarEl = document.getElementById('kiosk-greeting-avatar');
  const ring = document.getElementById('biometric-ring');
  
  if (card && nameEl) {
    const primerNombre = String(nombreCompleto || 'VERIFICADO').trim().split(' ')[0].toUpperCase();
    nameEl.innerText = `¡HOLA, ${primerNombre}!`;
    if (avatarEl) avatarEl.innerText = primerNombre.charAt(0) || '✓';
    card.classList.remove('hidden');
  }
  if (ring) {
    ring.classList.remove('border-amber-400', 'border-emerald-400/80');
    ring.classList.add('border-emerald-400');
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Activa o desactiva el modo Pantalla Completa nativo en Android / Tablet
function toggleFullScreenKiosk() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}

// ==========================================
// ARRANQUE Y REDES NEURONALES
// ==========================================
window.onload = async () => { 
  updateOfflineUI(); 
  runServer('apiInitDatabase', {}).catch(() => {}); 
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights'),
      faceapi.nets.faceLandmark68Net.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights'),
      faceapi.nets.faceRecognitionNet.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights')
    ]);
    faceModelsLoaded = true;
  } catch (err) { console.error("IA:", err); }
};

async function runServer(actionName, payloadData) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: actionName, payload: payloadData })
  });
  return await response.json();
}

// ==========================================
// NAVEGACIÓN FULLSCREEN Y MÓDULOS DE KIOSCO
// ==========================================
function showView(viewId) {
  ['view-menu', 'view-admin', 'view-kiosk', 'view-dashboard', 'view-superadmin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
  });
  
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.remove('hidden');
    // CRÍTICO: Activar flex en Kiosco, Dashboard y SuperAdmin para ocupar el 100% de la Tablet
    if (viewId === 'view-kiosk' || viewId === 'view-dashboard' || viewId === 'view-superadmin') {
      target.classList.add('flex');
    }
  }
  
  if (viewId === 'view-kiosk') { 
    initGPS(); 
    updateOfflineUI(); 
    aplicarModulosKiosco(); 
    initKioskAI(); 
    startCamera(); 
    lucide.createIcons();
  } else { 
    stopCamera(); 
  }
}

function aplicarModulosKiosco() {
  const badge = document.getElementById('kiosk-sucursal-badge');
  const btnQr = document.getElementById('btn-kiosk-qr');
  const btnsComida = document.getElementById('kiosk-comida-btns');
  const btnBio = document.getElementById('kiosk-ai-status');
  
  if (!kioskEmpresa) {
    badge.innerText = `Kiosco sin vincular (Inicia sesión en RH una vez)`;
    return;
  }
  
  const esCampo = tieneModulo(kioskEmpresa, 'CAMPO');
  badge.innerText = esCampo 
    ? `📍 Modo Obra / Campo: ${kioskEmpresa.nombre}` 
    : `📍 Sucursal Activa: ${kioskEmpresa.nombre}`;
    
  if (btnQr) btnQr.style.display = tieneModulo(kioskEmpresa, 'QR') ? 'flex' : 'none';
  if (btnsComida) btnsComida.style.display = tieneModulo(kioskEmpresa, 'LFT_PRENOMINA') ? 'grid' : 'none';
  
  const cap = (kioskEmpresa.capacidadHardware || 'ALTA').toUpperCase();
  faceIntervalMs = cap === 'BASICA' ? 1200 : (cap === 'MEDIA' ? 800 : 400);
  if (cap === 'BASICA' && btnBio) {
    btnBio.innerText = "Modo ahorro de hardware: Usa Gafete QR o PIN";
    btnBio.className = "text-base md:text-lg text-amber-400 font-bold tracking-wide";
  }
}

function toggleLoader(s, t = 'Procesando...') { 
  const l = document.getElementById('loader'); 
  document.getElementById('loader-text').innerText = t; 
  if (s) { l.classList.remove('hidden'); l.classList.add('flex'); } 
  else { l.classList.add('hidden'); l.classList.remove('flex'); } 
}

function showToast(m, t = 'success') { 
  const c = document.getElementById('toast-container');
  const d = document.createElement('div'); 
  d.className = `toast ${t === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white px-4 py-3 rounded-lg font-bold flex items-center gap-2 mb-2 z-50 shadow-lg text-xs md:text-sm`; 
  d.innerHTML = `<i data-lucide="${t === 'success' ? 'check-circle' : 'alert-circle'}"></i> ${m}`; 
  c.appendChild(d); 
  lucide.createIcons(); 
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 300); }, 3500); 
}

// ==========================================
// CÁMARA CIRCULAR KIOSCO (IA FACIAL + LECTOR QR UNIFICADO)
// ==========================================
async function startCamera() {
  const video = document.getElementById('live-video');
  const canvas = document.getElementById('face-canvas');
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = videoStream;
    video.onloadedmetadata = () => { video.play(); };
    
    video.onplay = () => {
      if (faceDetectionInterval) clearInterval(faceDetectionInterval);
      faceDetectionInterval = setInterval(async () => {
        if (isQrModeActive || !faceModelsLoaded || video.videoWidth === 0 || !tieneModulo(kioskEmpresa, 'BIOMETRIA_IA')) return;
        if (kioskEmpresa && (kioskEmpresa.capacidadHardware || 'ALTA').toUpperCase() === 'BASICA') return;
        
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);
        
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptors();
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        
        if (faceMatcher && resizedDetections.length > 0) {
           const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));
           results.forEach((result) => {
              if (result.label !== 'unknown') {
                 const [pinDetectado, nombreDetectado] = result.label.split('|');
                 const pinInput = document.getElementById('pin-input');
                 if (pinInput.value !== pinDetectado) {
                     pinInput.value = pinDetectado;
                     mostrarSaludoKiosco(nombreDetectado);
                     hablarKiosco(`Hola ${nombreDetectado.split(' ')[0]}`);
                 }
              }
           });
        }
      }, faceIntervalMs);
    };
  } catch (err) { showToast("Permiso de cámara requerido", "error"); }
}

function stopCamera() {
  detenerEscaneoQR();
  if (faceDetectionInterval) clearInterval(faceDetectionInterval);
  if (videoStream) { videoStream.getTracks().forEach(track => track.stop()); videoStream = null; }
}

async function initKioskAI() {
  const statusEl = document.getElementById('kiosk-ai-status');
  if (!kioskEmpresa) return;
  if (!tieneModulo(kioskEmpresa, 'BIOMETRIA_IA') || (kioskEmpresa.capacidadHardware || 'ALTA').toUpperCase() === 'BASICA') {
    if (statusEl) statusEl.innerText = "Toca Escanear Gafete QR o Ingresar PIN";
    return;
  }
  if (!navigator.onLine) {
    if (statusEl) { statusEl.innerText = "Modo Offline Activo (Usa tu Gafete QR o PIN)"; statusEl.className = "text-base md:text-lg text-amber-400 font-bold tracking-wide"; }
    return;
  }

  try {
     const res = await runServer('apiGetEmpleados', kioskEmpresa.empresaId);
     labeledFaceDescriptors = [];
     empleadosPinMap = {};
     for (let e of (res.data || [])) {
        if (e.estatus === 'ACTIVO') {
           empleadosPinMap[String(e.pin).trim()] = e.nombre;
           if (e.mapaFacial) {
              const arr = new Float32Array(JSON.parse(e.mapaFacial));
              labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(`${e.pin}|${e.nombre}`, [arr])); 
           }
        }
     }
     localStorage.setItem('kiosco_pin_map', JSON.stringify(empleadosPinMap));

     if (labeledFaceDescriptors.length > 0) {
        faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.55);
        if (statusEl) { statusEl.innerText = `Acerca tu rostro dentro del círculo (${labeledFaceDescriptors.length} activos)`; statusEl.className = 'text-base md:text-lg text-emerald-400 font-bold tracking-wide'; }
     } else {
        if (statusEl) { statusEl.innerText = "IA Lista (Enrola rostros en el panel RH)"; }
     }
  } catch (e) {}
}

function toggleQR() {
  const ring = document.getElementById('biometric-ring');
  const statusEl = document.getElementById('kiosk-ai-status');
  const btnQr = document.getElementById('btn-kiosk-qr');
  const video = document.getElementById('live-video');

  if (isQrModeActive) {
    detenerEscaneoQR();
    if (statusEl) {
      statusEl.innerText = "Acerca tu rostro dentro del círculo";
      statusEl.className = "text-base md:text-lg text-emerald-400 font-bold tracking-wide";
    }
    return;
  }

  isQrModeActive = true;
  if (video) video.classList.remove('scale-x-[-1]');
  if (ring) {
    ring.classList.remove('border-emerald-400/80', 'border-emerald-400');
    ring.classList.add('border-amber-400');
  }
  if (statusEl) {
    statusEl.innerText = "📷 Modo QR Activo: Acerca tu gafete al círculo";
    statusEl.className = "text-base md:text-lg text-amber-400 font-bold tracking-wide animate-pulse";
  }
  if (btnQr) {
    btnQr.classList.add('bg-amber-500', 'text-slate-950');
    btnQr.classList.remove('bg-slate-800', 'text-slate-100');
  }

  const qrCanvas = document.createElement('canvas');
  const qrCtx = qrCanvas.getContext('2d');

  qrScanInterval = setInterval(() => {
    if (!isQrModeActive || !video || video.videoWidth === 0) return;

    qrCanvas.width = video.videoWidth;
    qrCanvas.height = video.videoHeight;
    qrCtx.drawImage(video, 0, 0, qrCanvas.width, qrCanvas.height);

    const imageData = qrCtx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
    if (typeof jsQR === 'function') {
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert"
      });

      if (code && code.data) {
        const pinLeido = String(code.data).trim();
        document.getElementById('pin-input').value = pinLeido;

        const nombreConocido = empleadosPinMap[pinLeido] || 'GAFETE VERIFICADO';
        mostrarSaludoKiosco(nombreConocido);
        showToast('Gafete QR leído correctamente', 'success');
        hablarKiosco(empleadosPinMap[pinLeido] ? `Hola ${nombreConocido.split(' ')[0]}` : 'Gafete verificado');

        detenerEscaneoQR();
        if (statusEl) {
          statusEl.innerText = "Gafete verificado. Presiona Entrada o Salida.";
          statusEl.className = "text-base md:text-lg text-emerald-400 font-bold tracking-wide";
        }
      }
    }
  }, 150);
}

function detenerEscaneoQR() {
  isQrModeActive = false;
  if (qrScanInterval) {
    clearInterval(qrScanInterval);
    qrScanInterval = null;
  }
  const video = document.getElementById('live-video');
  const ring = document.getElementById('biometric-ring');
  const btnQr = document.getElementById('btn-kiosk-qr');
  if (video) video.classList.add('scale-x-[-1]');
  if (ring) {
    ring.classList.remove('border-amber-400');
    ring.classList.add('border-emerald-400/80');
  }
  if (btnQr) {
    btnQr.classList.remove('bg-amber-500', 'text-slate-950');
    btnQr.classList.add('bg-slate-800', 'text-slate-100');
  }
}

// ==========================================
// SESIÓN DE ADMINISTRADORES, SUPERVISORES Y PERMISOS
// ==========================================
async function loginAdmin() {
  const pin = document.getElementById('admin-pin').value;
  if (!pin) return showToast('Ingresa PIN', 'error');
  
  toggleLoader(true, 'Autenticando...');
  try {
    const res = await runServer('apiAdminLogin', pin);
    if (res.status === 'success') {
      document.getElementById('admin-pin').value = '';
      if (res.role === 'SUPER_ADMIN') {
        currentUser = {
          id: (res.usuario && res.usuario.id) || 'MASTER',
          nombre: (res.usuario && res.usuario.nombre) || 'SUPER ADMIN',
          rol: 'SUPER_ADMIN',
          permisos: ['*']
        };
        loadEmpresas(); 
        showView('view-superadmin');
      } else {
        currentEmpresa = res.data; 
        localStorage.setItem('kiosco_empresa', JSON.stringify(currentEmpresa)); 
        kioskEmpresa = currentEmpresa; 
        currentUser = {
          id: (res.usuario && res.usuario.id) || 'ADMIN',
          nombre: (res.usuario && res.usuario.nombre) || 'RH',
          rol: res.role || 'ADMIN',
          permisos: res.permisos || ['*']
        };
        
        document.getElementById('empresa-name').innerText = `RH: ${currentEmpresa.nombre} (${currentUser.rol})`;
        document.getElementById('empresa-modulos-badges').innerText = `Módulos LFT 2027: ${currentEmpresa.modulos || 'COMPLETO'}`;
        const hoy = new Date().toISOString().split('T')[0]; 
        document.getElementById('date-start').value = hoy; 
        document.getElementById('date-end').value = hoy;
        
        aplicarPermisosUI();
        showView('view-dashboard');
        switchRHTab('prenomina');
        if (puede('gestionar_empleados')) loadEmpleados();
        if (puede('gestionar_turnos') || puede('config_legal')) loadTurnosYSucursales();
      }
    } else showToast(res.message, 'error');
  } catch (e) { showToast('Servidor inaccesible', 'error'); } 
  toggleLoader(false);
}

function aplicarPermisosUI() {
  const btnNuevoEmp = document.getElementById('btn-nuevo-emp');
  if (btnNuevoEmp) btnNuevoEmp.style.display = puede('gestionar_empleados') ? 'inline-flex' : 'none';
  
  const tabEmp = document.getElementById('tab-btn-empleados');
  if (tabEmp) tabEmp.style.display = puede('gestionar_empleados') ? 'inline-block' : 'none';

  const tabUsuarios = document.getElementById('tab-btn-usuarios');
  if (tabUsuarios) tabUsuarios.style.display = puede('gestionar_supervisores') ? 'inline-block' : 'none';
  
  const tabLayouts = document.getElementById('tab-btn-layouts');
  if (tabLayouts) tabLayouts.style.display = (puede('gestionar_turnos') || puede('config_legal') || puede('exportar_nomina')) ? 'inline-block' : 'none';
  
  const tabConfig = document.getElementById('tab-btn-config');
  if (tabConfig) tabConfig.style.display = (puede('gestionar_turnos') || puede('config_legal') || puede('gestionar_sucursales')) ? 'inline-block' : 'none';
  
  const btnNomina = document.getElementById('btn-export-nomina');
  if (btnNomina) btnNomina.style.display = puede('exportar_nomina') ? 'inline-flex' : 'none';
  
  const btnAspel = document.getElementById('btn-export-aspel');
  if (btnAspel) btnAspel.style.display = puede('exportar_nomina') ? 'inline-flex' : 'none';
  
  const btnAudit = document.getElementById('btn-ver-audit');
  if (btnAudit) btnAudit.style.display = puede('ver_audit_log') ? 'inline-flex' : 'none';
  
  window._puedeJustificar = puede('justificar_incidencias');
}

function logoutAdmin() { 
  currentEmpresa = null; 
  currentReportData = []; 
  currentUser = null;
  currentUsuariosList = [];
  currentLayoutsData = {};
  currentMuestraLayoutData = null;
  showView('view-menu'); 
}

function switchRHTab(tabId) {
  ['prenomina', 'empleados', 'usuarios', 'layouts', 'config'].forEach(t => {
    const panel = document.getElementById('tab-' + t);
    const btn = document.getElementById('tab-btn-' + t);
    if (panel) panel.classList.add('hidden');
    if (btn) {
      btn.classList.replace('border-blue-400', 'border-transparent');
      btn.classList.replace('text-white', 'text-gray-400');
    }
  });
  
  const targetPanel = document.getElementById('tab-' + tabId);
  const targetBtn = document.getElementById('tab-btn-' + tabId);
  if (targetPanel) targetPanel.classList.remove('hidden');
  if (targetBtn) {
    targetBtn.classList.replace('border-transparent', 'border-blue-400');
    targetBtn.classList.replace('text-gray-400', 'text-white');
  }
  
  if (tabId === 'empleados' && puede('gestionar_empleados')) loadEmpleados();
  if (tabId === 'usuarios' && puede('gestionar_supervisores')) loadUsuarios();
  if (tabId === 'layouts') loadLayouts();
  if (tabId === 'config') loadTurnosYSucursales();
}

// ==========================================
// PRE-NÓMINA, 4 MOMENTOS LFT, MAPA GPS E INCIDENCIAS
// ==========================================
function actualizarKPIs(data) {
  let asist = 0, ret = 0, faltas = 0, extras = 0;
  data.forEach(r => {
    if (r.entrada !== '--') {
      asist++;
      if (r.retardo) ret++;
      extras += (parseFloat(r.dobles) || 0) + (parseFloat(r.triples) || 0);
    } else if (!r.incidencia) {
      faltas++;
    }
  });
  document.getElementById('kpi-asistencias').innerText = asist;
  document.getElementById('kpi-retardos').innerText = ret;
  document.getElementById('kpi-faltas').innerText = faltas;
  document.getElementById('kpi-extras').innerText = extras.toFixed(1) + ' h';
}

function renderReportTable(data) {
  const tb = document.getElementById('table-body');
  const btn = document.getElementById('btn-export');
  const mostrarLFT = tieneModulo(currentEmpresa, 'LFT_PRENOMINA');
  
  actualizarKPIs(data);

  if (data.length === 0) {
    tb.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-gray-500">Sin registros en este filtro.</td></tr>'; 
  } else {
    if (puede('exportar_nomina')) btn.classList.remove('hidden');
    tb.innerHTML = data.map(row => {
      let recuadroFoto = '';
      if (row.foto && row.foto !== 'SIN_FOTO') {
        const fileIdMatch = row.foto.match(/[-\w]{25,}/);
        const thumbUrl = fileIdMatch ? `https://drive.google.com/thumbnail?id=${fileIdMatch[0]}&sz=w1000` : row.foto;
        recuadroFoto = `<a href="${row.foto}" target="_blank" class="inline-block"><img src="${thumbUrl}" onerror="this.outerHTML='<div class=\\'w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center mx-auto text-[10px] font-bold\\'>Foto</div>';" class="w-8 h-8 object-cover rounded-full mx-auto border border-blue-400"></a>`;
      } else {
        recuadroFoto = `<div class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mx-auto text-gray-400"><i data-lucide="user" class="w-4 h-4"></i></div>`;
      }

      let badgeHorario = '';
      if (row.incidencia) {
        badgeHorario = `<span class="bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded font-bold text-[11px]">${row.incidencia}</span>`;
      } else if (row.entrada === '--') {
        badgeHorario = `<span class="bg-red-500 text-white px-2 py-0.5 rounded font-bold text-[11px]">FALTA</span>`;
      } else {
        badgeHorario = `<span class="${row.retardo ? 'text-red-600' : 'text-green-600'} font-bold">${row.entrada}</span> a <span class="font-bold text-gray-700">${row.salida}</span>`;
      }

      const infoComida = (row.inicioComida && row.inicioComida !== '--') 
        ? `<span class="text-[11px] text-gray-600 font-mono">${row.inicioComida} - ${row.finComida}<br><strong class="text-teal-700">(${row.minsComida || 0} min)</strong></span>`
        : '<span class="text-gray-300">-</span>';

      const infoExtras = (mostrarLFT && (row.dobles > 0 || row.triples > 0))
        ? `${row.dobles > 0 ? `<span class="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold mr-1">2x: ${row.dobles}h</span>` : ''}${row.triples > 0 ? `<span class="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-bold">3x: ${row.triples}h</span>` : ''}`
        : '-';

      const linkMapa = (row.lat && row.lng)
        ? `<a href="https://www.google.com/maps?q=${row.lat},${row.lng}" target="_blank" class="text-[10px] text-blue-600 hover:underline font-bold ml-1" title="Ver ubicación exacta en Google Maps">📍 Mapa (${row.distancia || 0}m)</a>`
        : '';

      const btnJustificar = (row.entrada === '--' && window._puedeJustificar !== false) 
        ? `<button onclick="abrirModalIncidencia('${row.empId}', '${escapeHtml(row.empleado)}', '${row.fecha}')" class="text-[11px] bg-gray-100 hover:bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded border ml-1">Justificar</button>` 
        : '';

      return `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2.5 font-bold">${escapeHtml(row.empleado)} <br><span class="text-[10px] text-gray-500 font-normal">PIN: ${row.pin || row.empId} ${row.rfc ? '| RFC: '+row.rfc : ''}</span></td>
        <td class="p-2.5"><span class="bg-gray-100 border px-2 py-0.5 rounded text-[11px] font-semibold">${escapeHtml(row.sucursal || 'Matriz')}</span></td>
        <td class="p-2.5">${row.fecha}</td>
        <td class="p-2.5 text-center">${recuadroFoto}</td>
        <td class="p-2.5 text-center">${badgeHorario}</td>
        <td class="p-2.5 text-center">${infoComida}</td>
        <td class="p-2.5 text-center">${infoExtras}</td>
        <td class="p-2.5">${row.estatusGeo === 'ALERTA_GEO' ? '<span class="bg-red-100 text-red-800 px-2 py-0.5 rounded font-bold text-[10px]">Fuera de Obra</span>' : (row.entrada !== '--' ? '<span class="text-green-600 font-bold text-[10px]">En Geocerca</span>' : '')}${linkMapa}${btnJustificar}</td>
      </tr>`;
    }).join('');
    setTimeout(() => lucide.createIcons(), 50);
  }
}

function abrirModalIncidencia(empId, nombre, fecha) {
  if (!puede('justificar_incidencias')) return showToast('Sin permiso para justificar', 'error');
  selectedIncidenciaTarget = { empId, fecha };
  document.getElementById('inc-emp-info').innerText = `${nombre} — Fecha: ${fecha}`;
  document.getElementById('modal-incidencia').classList.remove('hidden');
}

async function guardarIncidencia() {
  if (!selectedIncidenciaTarget) return;
  const motivo = document.getElementById('inc-motivo').value;
  toggleLoader(true, 'Sellando bitácora STPS...');
  try {
    const res = await runServer('apiJustificarIncidencia', {
      empresaId: currentEmpresa.empresaId,
      empId: selectedIncidenciaTarget.empId,
      fecha: selectedIncidenciaTarget.fecha,
      motivo: motivo,
      usuarioId: currentUser ? currentUser.id : 'RH'
    });
    if (res.status === 'success') {
      showToast(res.message);
      document.getElementById('modal-incidencia').classList.add('hidden');
      loadReports();
    } else showToast(res.message, 'error');
  } catch (e) { showToast('Error al justificar', 'error'); }
  toggleLoader(false);
}

function filterReport() {
  const query = (document.getElementById('search-report').value || '').toLowerCase();
  const suc = document.getElementById('filter-sucursal-report').value;
  const filtered = currentReportData.filter(r => {
    const matchText = r.empleado.toLowerCase().includes(query) || 
                      String(r.pin || '').toLowerCase().includes(query) || 
                      String(r.rfc || '').toLowerCase().includes(query) || 
                      String(r.curp || '').toLowerCase().includes(query);
    const matchSuc = (suc === 'TODAS') || ((r.sucursal || 'Matriz') === suc);
    return matchText && matchSuc;
  });
  renderReportTable(filtered);
}

async function loadReports() {
  if (!currentEmpresa) return;
  const s = document.getElementById('date-start').value, e = document.getElementById('date-end').value;
  if (!s || !e) return; 
  toggleLoader(true, 'Calculando Pre-Nómina LFT 2027...');
  try {
    const res = await runServer('apiGetReports', { empresaId: currentEmpresa.empresaId, fechaInicio: s, fechaFin: e });
    currentReportData = res.data || [];
    actualizarSelectoresSucursales(currentReportData);
    filterReport();
  } catch (er) { showToast('Error al generar reporte', 'error'); } 
  toggleLoader(false);
}

function exportToCSV() {
  if (currentReportData.length === 0) return;
  const headers = ["Empleado", "RFC", "CURP", "PIN", "Sucursal", "Fecha", "Entrada", "Inicio Comida", "Fin Comida", "Minutos Comida", "Salida", "Incidencia", "Horas Dobles", "Horas Triples", "Auditoría GPS"];
  const query = (document.getElementById('search-report').value || '').toLowerCase();
  const suc = document.getElementById('filter-sucursal-report').value;
  
  const toExport = currentReportData.filter(r => {
    const matchText = r.empleado.toLowerCase().includes(query) || String(r.pin || '').toLowerCase().includes(query) || String(r.rfc || '').toLowerCase().includes(query);
    const matchSuc = (suc === 'TODAS') || ((r.sucursal || 'Matriz') === suc);
    return matchText && matchSuc;
  });
  
  const rows = toExport.map(row => [
    `"${row.empleado}"`, 
    row.rfc || '', 
    row.curp || '', 
    row.pin || '', 
    `"${row.sucursal || 'Matriz'}"`, 
    row.fecha, 
    row.entrada, 
    row.inicioComida || '--',
    row.finComida || '--',
    row.minsComida || 0,
    row.salida, 
    row.incidencia || 'ASISTENCIA_NORMAL', 
    row.dobles, 
    row.triples, 
    row.estatusGeo
  ].join(","));
  
  const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Prenomina_STPS_${currentEmpresa.nombre.replace(/\s+/g, '_')}_${document.getElementById('date-start').value}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

async function exportarLayoutNomina(formato) {
  if (!puede('exportar_nomina')) return showToast('Sin permiso para exportar', 'error');
  const s = document.getElementById('date-start').value, e = document.getElementById('date-end').value;
  if (!s || !e) return showToast('Selecciona fechas', 'error');
  toggleLoader(true, `Generando layout ${formato}...`);
  try {
    const res = await runServer('apiExportNominaLayout', {
      empresaId: currentEmpresa.empresaId,
      fechaInicio: s,
      fechaFin: e,
      formato: formato
    });
    if (res.status === 'success') {
      const blob = new Blob([res.contenido], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = res.archivo;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      showToast(`Layout ${formato} descargado`);
    } else showToast(res.message, 'error');
  } catch (e) { showToast('Error al generar layout', 'error'); }
  toggleLoader(false);
}

// ==========================================
// COLABORADORES: EDICIÓN, RFC/CURP, ACUERDO LFT 2027 Y GAFETES
// ==========================================
function actualizarSelectoresSucursales(listaItems) {
  const sucursales = [...new Set(listaItems.map(i => i.sucursal || 'Matriz'))].sort();
  const selReport = document.getElementById('filter-sucursal-report');
  const selEmp = document.getElementById('filter-sucursal-emp');
  const dataList = document.getElementById('lista-sucursales');
  
  if (selReport) selReport.innerHTML = '<option value="TODAS">Todas</option>' + sucursales.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (selEmp) selEmp.innerHTML = '<option value="TODAS">Todas</option>' + sucursales.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (dataList) dataList.innerHTML = sucursales.map(s => `<option value="${escapeHtml(s)}"></option>`).join('');
}

async function loadEmpleados() {
  if (!currentEmpresa) return;
  toggleLoader(true, 'Cargando catálogo...');
  try {
    const res = await runServer('apiGetEmpleados', currentEmpresa.empresaId);
    currentEmpleadosData = res.data || [];
    
    empleadosPinMap = {};
    currentEmpleadosData.forEach(e => {
      if (e.estatus === 'ACTIVO') empleadosPinMap[String(e.pin).trim()] = e.nombre;
    });
    localStorage.setItem('kiosco_pin_map', JSON.stringify(empleadosPinMap));

    actualizarSelectoresSucursales(currentEmpleadosData);
    filterEmpleadosTable();
  } catch (e) {} 
  toggleLoader(false);
}

function filterEmpleadosTable() {
  const suc = document.getElementById('filter-sucursal-emp').value;
  const q = (document.getElementById('search-emp-catalog') ? document.getElementById('search-emp-catalog').value : '').toLowerCase();
  
  const filtered = currentEmpleadosData.filter(e => {
    const matchSuc = suc === 'TODAS' || (e.sucursal || 'Matriz') === suc;
    const matchQ = !q || e.nombre.toLowerCase().includes(q) || String(e.rfc || '').toLowerCase().includes(q) || String(e.curp || '').toLowerCase().includes(q) || String(e.pin || '').includes(q);
    return matchSuc && matchQ;
  });
  
  document.getElementById('table-empleados').innerHTML = filtered.length ? filtered.map(e => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2.5 font-bold">${escapeHtml(e.nombre)} <br><span class="${e.estatus === 'ACTIVO' ? 'text-green-600' : 'text-red-500'} text-[10px] font-extrabold">${e.estatus}</span></td>
      <td class="p-2.5 font-mono text-[11px] text-gray-600">
        <div>RFC: <strong>${escapeHtml(e.rfc || 'Sin capturar')}</strong></div>
        <div>CURP: <strong>${escapeHtml(e.curp || 'Sin capturar')}</strong></div>
      </td>
      <td class="p-2.5">
        <span class="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded text-[11px] font-semibold">${escapeHtml(e.sucursal || 'Matriz')}</span>
        <span class="ml-1 font-bold text-gray-600">(${escapeHtml(e.turno)})</span>
      </td>
      <td class="p-2.5">
        <span class="text-blue-600 font-bold mr-1">${escapeHtml(e.pin)}</span>
        <button onclick="verGafeteQR('${e.id}')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded border text-[11px] font-bold"><i data-lucide="qr-code" class="w-3 h-3 inline"></i> QR</button>
      </td>
      <td class="p-2.5 text-center">${e.mapaFacial ? `<button onclick="openEnrolarModal('${e.id}', '${escapeHtml(e.nombre)}')" class="text-green-600 font-bold text-xs hover:underline"><i data-lucide="check-circle" class="w-3.5 h-3.5 inline"></i> Activo</button>` : `<button onclick="openEnrolarModal('${e.id}', '${escapeHtml(e.nombre)}')" class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs font-bold">Enrolar</button>`}</td>
      <td class="p-2.5 text-center">
        <button onclick="verCartaAcuerdoLFT('${e.id}')" class="bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 mx-auto"><i data-lucide="file-check" class="w-3 h-3"></i> Carta STPS</button>
      </td>
      <td class="p-2.5 text-right space-x-1">
        <button onclick="abrirModalEditarEmpleado('${e.id}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-bold text-xs">Editar</button>
        <button onclick="toggleEstatus('${e.id}', '${e.estatus === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO'}')" class="bg-gray-200 hover:bg-gray-300 px-2 py-0.5 rounded font-bold text-xs">${e.estatus === 'ACTIVO' ? 'Baja' : 'Alta'}</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="p-6 text-center text-gray-500">Sin colaboradores registrados.</td></tr>';
  lucide.createIcons();
}

function abrirModalNuevoEmpleado() {
  if (!puede('gestionar_empleados')) return showToast('Sin permiso', 'error');
  document.getElementById('modal-emp-titulo').innerText = 'Alta de Nuevo Colaborador';
  document.getElementById('edit-emp-id').value = '';
  document.getElementById('new-emp-nombre').value = '';
  document.getElementById('new-emp-rfc').value = '';
  document.getElementById('new-emp-curp').value = '';
  document.getElementById('new-emp-pin').value = '';
  document.getElementById('new-emp-sucursal').value = '';
  document.getElementById('modal-empleado').classList.remove('hidden');
}

function abrirModalEditarEmpleado(empId) {
  if (!puede('gestionar_empleados')) return showToast('Sin permiso', 'error');
  const emp = currentEmpleadosData.find(x => String(x.id) === String(empId));
  if (!emp) return;
  document.getElementById('modal-emp-titulo').innerText = 'Editar Expediente del Colaborador';
  document.getElementById('edit-emp-id').value = emp.id;
  document.getElementById('new-emp-nombre').value = emp.nombre || '';
  document.getElementById('new-emp-rfc').value = emp.rfc || '';
  document.getElementById('new-emp-curp').value = emp.curp || '';
  document.getElementById('new-emp-pin').value = emp.pin || '';
  document.getElementById('new-emp-sucursal').value = emp.sucursal || 'Matriz';
  document.getElementById('new-emp-turno').value = emp.turno || 'T1';
  document.getElementById('modal-empleado').classList.remove('hidden');
}

async function saveEmpleado() {
  if (!puede('gestionar_empleados')) return showToast('Sin permiso', 'error');
  if (isSavingEmpleado) return;
  const editId = document.getElementById('edit-emp-id').value;
  const payload = { 
    id: editId,
    empresaId: currentEmpresa.empresaId, 
    nombre: document.getElementById('new-emp-nombre').value.trim(), 
    rfc: document.getElementById('new-emp-rfc').value.trim().toUpperCase(),
    curp: document.getElementById('new-emp-curp').value.trim().toUpperCase(),
    sucursal: document.getElementById('new-emp-sucursal').value.trim() || 'Matriz',
    pin: document.getElementById('new-emp-pin').value.trim(), 
    turnoId: document.getElementById('new-emp-turno').value || 'T1',
    usuarioId: currentUser ? currentUser.id : 'RH'
  };
  if (!payload.nombre || !payload.pin) return showToast('Nombre y PIN son obligatorios', 'error');
  
  isSavingEmpleado = true;
  const action = editId ? 'apiUpdateEmpleado' : 'apiAddEmpleado';
  toggleLoader(true, editId ? 'Actualizando expediente...' : 'Guardando colaborador...');
  
  try {
    const res = await runServer(action, payload);
    await loadEmpleados();
    const yaExisteEnTabla = currentEmpleadosData.some(
      e => String(e.pin).trim() === payload.pin && e.nombre.toLowerCase() === payload.nombre.toLowerCase()
    );

    if (res.status === 'success' || yaExisteEnTabla) { 
      showToast('Colaborador guardado correctamente', 'success'); 
      document.getElementById('modal-empleado').classList.add('hidden'); 
    } else {
      showToast(res.message, 'error');
    }
  } catch (e) { 
    await loadEmpleados();
    document.getElementById('modal-empleado').classList.add('hidden');
    showToast('Sincronizado con la base de datos', 'success');
  } finally { 
    isSavingEmpleado = false; 
    toggleLoader(false); 
  }
}

function verGafeteQR(empId) {
  const emp = currentEmpleadosData.find(x => String(x.id) === String(empId));
  if (!emp) return;
  document.getElementById('gafete-empresa').innerText = currentEmpresa.nombre;
  document.getElementById('gafete-nombre').innerText = emp.nombre;
  document.getElementById('gafete-sucursal').innerText = `Sucursal: ${emp.sucursal || 'Matriz'}`;
  document.getElementById('gafete-rfc').innerText = emp.rfc ? `RFC: ${emp.rfc}` : '';
  document.getElementById('gafete-pin').innerText = `PIN: ${emp.pin}`;
  document.getElementById('gafete-qr-img').src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(emp.pin)}`;
  document.getElementById('modal-gafete').classList.remove('hidden');
  lucide.createIcons();
}

function verCartaAcuerdoLFT(empId) {
  const emp = currentEmpleadosData.find(x => String(x.id) === String(empId));
  if (!emp) return;
  document.getElementById('acuerdo-fecha').innerText = new Date().toLocaleDateString('es-MX');
  document.getElementById('acuerdo-empresa').innerText = currentEmpresa.nombre;
  document.getElementById('acuerdo-nombre').innerText = emp.nombre;
  document.getElementById('acuerdo-pin').innerText = emp.pin;
  document.getElementById('acuerdo-rfc').innerText = emp.rfc || '_____________________';
  document.getElementById('acuerdo-curp').innerText = emp.curp || '_____________________';
  document.getElementById('acuerdo-sucursal').innerText = emp.sucursal || 'Matriz';
  document.getElementById('acuerdo-turno').innerText = emp.turno || 'T1';
  document.getElementById('acuerdo-firma-emp').innerText = emp.nombre;
  document.getElementById('acuerdo-firma-cia').innerText = currentEmpresa.nombre;
  document.getElementById('modal-acuerdo-lft').classList.remove('hidden');
  lucide.createIcons();
}

async function toggleEstatus(id, newStatus) { 
  if (!puede('gestionar_empleados')) return showToast('Sin permiso', 'error');
  toggleLoader(true); 
  await runServer('apiToggleEmpleado', { empresaId: currentEmpresa.empresaId, empleadoId: id, newStatus, usuarioId: currentUser ? currentUser.id : 'RH' }); 
  toggleLoader(false); 
  loadEmpleados(); 
}

// ==========================================
// SUPERVISORES DE OBRA Y PERMISOS GRANULARES
// ==========================================
async function loadUsuarios() {
  if (!currentEmpresa || !puede('gestionar_supervisores')) return;
  toggleLoader(true, 'Cargando supervisores...');
  try {
    const res = await runServer('apiGetUsuarios', { empresaId: currentEmpresa.empresaId });
    currentUsuariosList = res.data || [];
    document.getElementById('table-usuarios').innerHTML = currentUsuariosList.length ? currentUsuariosList.map(u => `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-3 font-bold">${escapeHtml(u.nombre)}<br><span class="text-[10px] font-extrabold ${u.estatus === 'ACTIVO' ? 'text-green-600' : 'text-red-500'}">${u.estatus}</span></td>
        <td class="p-3"><span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-[11px] font-bold">${u.rol}</span></td>
        <td class="p-3 text-[11px] text-gray-600">${(u.permisos || []).join(', ')}</td>
        <td class="p-3 text-right space-x-1">
          <button onclick="abrirModalEditarPermisos('${u.id}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded font-bold text-xs">Permisos</button>
          <button onclick="toggleUsuarioStatus('${u.id}', '${u.estatus === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO'}')" class="bg-gray-200 hover:bg-gray-300 px-2.5 py-1 rounded font-bold text-xs">${u.estatus === 'ACTIVO' ? 'Suspender' : 'Activar'}</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="4" class="p-6 text-center text-gray-500">Sin supervisores registrados.</td></tr>';
    lucide.createIcons();
  } catch (e) {}
  toggleLoader(false);
}

function abrirModalNuevoUsuario() {
  if (!puede('gestionar_supervisores')) return showToast('Sin permiso', 'error');
  document.getElementById('modal-usr-titulo').innerText = 'Alta de Supervisor de Obra / Sucursal';
  document.getElementById('new-usr-nombre').value = '';
  document.getElementById('new-usr-pin').value = '';
  document.getElementById('new-usr-pin').disabled = false;
  document.getElementById('usr-edit-id').value = '';
  document.getElementById('usr-rol').value = 'SUPERVISOR';
  document.querySelectorAll('.chk-perm-usr').forEach(cb => {
    cb.checked = (cb.value === 'ver_reportes' || cb.value === 'justificar_incidencias');
  });
  document.getElementById('modal-usuario').classList.remove('hidden');
}

function abrirModalEditarPermisos(usrId) {
  const u = currentUsuariosList.find(x => String(x.id) === String(usrId));
  if (!u) return;
  document.getElementById('modal-usr-titulo').innerText = `Editar Permisos: ${u.nombre}`;
  document.getElementById('new-usr-nombre').value = u.nombre;
  document.getElementById('new-usr-pin').value = '';
  document.getElementById('new-usr-pin').disabled = true;
  document.getElementById('usr-rol').value = u.rol;
  document.getElementById('usr-edit-id').value = u.id;
  document.querySelectorAll('.chk-perm-usr').forEach(cb => {
    cb.checked = (u.permisos || []).includes(cb.value);
  });
  document.getElementById('modal-usuario').classList.remove('hidden');
}

async function saveUsuario() {
  if (!puede('gestionar_supervisores')) return showToast('Sin permiso', 'error');
  const editId = document.getElementById('usr-edit-id').value;
  const permisos = Array.from(document.querySelectorAll('.chk-perm-usr:checked')).map(cb => cb.value);
  
  if (editId) {
    toggleLoader(true, 'Actualizando permisos...');
    const res = await runServer('apiUpdateUsuarioPermisos', {
      empresaId: currentEmpresa.empresaId,
      usuarioId: editId,
      permisos,
      actualizadoPor: currentUser ? currentUser.id : 'RH'
    });
    toggleLoader(false);
    if (res.status === 'success') {
      showToast(res.message);
      document.getElementById('modal-usuario').classList.add('hidden');
      loadUsuarios();
    } else showToast(res.message, 'error');
    return;
  }

  const payload = {
    empresaId: currentEmpresa.empresaId,
    nombre: document.getElementById('new-usr-nombre').value.trim(),
    pin: document.getElementById('new-usr-pin').value.trim(),
    rol: document.getElementById('usr-rol').value,
    permisos: permisos,
    creadoPor: currentUser ? currentUser.id : 'RH'
  };
  if (!payload.nombre || !payload.pin) return showToast('Nombre y PIN obligatorios', 'error');
  toggleLoader(true, 'Creando supervisor...');
  const res = await runServer('apiAddUsuario', payload);
  toggleLoader(false);
  if (res.status === 'success') {
    showToast(res.message);
    document.getElementById('modal-usuario').classList.add('hidden');
    loadUsuarios();
  } else showToast(res.message, 'error');
}

async function toggleUsuarioStatus(usrId, newStatus) {
  if (!puede('gestionar_supervisores')) return showToast('Sin permiso', 'error');
  toggleLoader(true);
  await runServer('apiToggleUsuarioStatus', {
    empresaId: currentEmpresa.empresaId,
    usuarioId: usrId,
    newStatus,
    actualizadoPor: currentUser ? currentUser.id : 'RH'
  });
  toggleLoader(false);
  loadUsuarios();
}

// ==========================================
// TURNOS, GEOCERCAS MULTI-SUCURSAL Y CONFIG LEGAL 2026-2030
// ==========================================
async function loadTurnosYSucursales() {
  if (!currentEmpresa) return;
  try {
    const [resT, resS, resLegal] = await Promise.all([
      runServer('apiGetTurnos', currentEmpresa.empresaId),
      runServer('apiGetSucursales', currentEmpresa.empresaId),
      runServer('apiGetConfigLegal', { empresaId: currentEmpresa.empresaId })
    ]);
    
    const turnos = resT.data || [];
    document.getElementById('table-turnos').innerHTML = turnos.map(t => `
      <tr class="border-b"><td class="p-2 font-bold text-blue-600">${escapeHtml(t.id)}</td><td class="p-2">${escapeHtml(t.nombre)}</td><td class="p-2 font-mono">${t.entrada} - ${t.salida}</td><td class="p-2">${t.tolerancia}m</td></tr>
    `).join('') || '<tr><td colspan="4" class="p-2 text-center text-gray-400">Sin turnos</td></tr>';

    const selTurno = document.getElementById('new-emp-turno');
    if (selTurno && turnos.length) {
      selTurno.innerHTML = turnos.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.id)} - ${escapeHtml(t.nombre)} (${t.entrada}-${t.salida})</option>`).join('');
    }

    const sucs = resS.data || [];
    document.getElementById('table-sucursales').innerHTML = sucs.map(s => `
      <tr class="border-b"><td class="p-2 font-bold text-green-700">${escapeHtml(s.nombre)}</td><td class="p-2 font-mono text-[10px]">${s.lat}, ${s.lng}</td><td class="p-2">${s.radio}m</td></tr>
    `).join('') || '<tr><td colspan="3" class="p-2 text-center text-gray-400">Usa la Geocerca Matriz por defecto</td></tr>';

    const legal = resLegal.data || [];
    const tbLegal = document.getElementById('table-config-legal');
    if (tbLegal) {
      tbLegal.innerHTML = legal.map(l => `
        <tr class="border-b"><td class="p-2 font-bold text-purple-700">${l.anio}</td><td class="p-2 font-bold">${l.horasMax} h/sem</td><td class="p-2">${l.doblesMaxDia} h/día</td><td class="p-2">${l.tripleDesde} h/sem</td><td class="p-2 text-gray-500">${escapeHtml(l.notas || '')}</td></tr>
      `).join('') || '<tr><td colspan="5" class="p-2 text-center text-gray-400">Sin configuración legal</td></tr>';
    }
  } catch (e) {}
}

async function guardarTurno() {
  if (!puede('gestionar_turnos')) return showToast('Sin permiso', 'error');
  const payload = {
    empresaId: currentEmpresa.empresaId,
    id: document.getElementById('cfg-turno-id').value.trim(),
    nombre: document.getElementById('cfg-turno-nombre').value.trim(),
    entrada: document.getElementById('cfg-turno-ent').value,
    salida: document.getElementById('cfg-turno-sal').value,
    tolerancia: document.getElementById('cfg-turno-tol').value,
    usuarioId: currentUser ? currentUser.id : 'RH'
  };
  if (!payload.id || !payload.nombre) return showToast('Completa código y nombre del turno', 'error');
  toggleLoader(true, 'Guardando turno...');
  const res = await runServer('apiAddTurno', payload);
  toggleLoader(false);
  if (res.status === 'success') { showToast(res.message); loadTurnosYSucursales(); } else showToast(res.message, 'error');
}

function capturarGpsActualSucursal() {
  if (!navigator.geolocation) return showToast('GPS no soportado', 'error');
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById('cfg-suc-lat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('cfg-suc-lng').value = pos.coords.longitude.toFixed(6);
    showToast('Coordenadas actuales capturadas');
  }, () => showToast('Activa el permiso de ubicación', 'error'));
}

async function guardarSucursal() {
  if (!puede('gestionar_sucursales')) return showToast('Sin permiso', 'error');
  const payload = {
    empresaId: currentEmpresa.empresaId,
    nombre: document.getElementById('cfg-suc-nombre').value.trim(),
    lat: document.getElementById('cfg-suc-lat').value.trim(),
    lng: document.getElementById('cfg-suc-lng').value.trim(),
    radio: document.getElementById('cfg-suc-radio').value.trim() || 150,
    usuarioId: currentUser ? currentUser.id : 'RH'
  };
  if (!payload.nombre || !payload.lat || !payload.lng) return showToast('Completa nombre y coordenadas', 'error');
  toggleLoader(true, 'Guardando geocerca...');
  const res = await runServer('apiAddSucursal', payload);
  toggleLoader(false);
  if (res.status === 'success') { showToast(res.message); loadTurnosYSucursales(); } else showToast(res.message, 'error');
}

async function guardarConfigLegal() {
  if (!puede('config_legal')) return showToast('Sin permiso', 'error');
  const payload = {
    empresaId: currentEmpresa.empresaId,
    anio: parseInt(document.getElementById('cfg-legal-anio').value),
    horasMax: parseFloat(document.getElementById('cfg-legal-horas').value),
    doblesMaxDia: parseFloat(document.getElementById('cfg-legal-dobles').value),
    tripleDesde: parseFloat(document.getElementById('cfg-legal-triple').value),
    notas: document.getElementById('cfg-legal-notas').value.trim(),
    usuarioId: currentUser ? currentUser.id : 'RH'
  };
  if (!payload.anio || !payload.horasMax) return showToast('Año y horas son obligatorios', 'error');
  toggleLoader(true, 'Guardando parámetro legal...');
  const res = await runServer('apiSaveConfigLegal', payload);
  toggleLoader(false);
  if (res.status === 'success') { showToast(res.message); loadTurnosYSucursales(); } else showToast(res.message, 'error');
}

// ==========================================
// ENROLAMIENTO BIOMÉTRICO (CÁMARA Y ARCHIVO)
// ==========================================
async function openEnrolarModal(empId, nombre) {
  if (!puede('enrolar_rostros')) return showToast('Sin permiso para enrolar', 'error');
  currentEnrolId = empId; enrolModo = "CAMARA"; enrolDescriptor = null;
  document.getElementById('enrolar-nombre').innerText = nombre;
  document.getElementById('modal-enrolar').classList.remove('hidden');
  document.getElementById('enrolar-img-preview').classList.add('hidden');
  document.getElementById('enrolar-file').value = "";
  const video = document.getElementById('enrolar-video');
  video.classList.remove('hidden');
  document.getElementById('btn-guardar-rostro').disabled = true;
  document.getElementById('btn-guardar-rostro').classList.add('opacity-50', 'cursor-not-allowed');
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = stream;
    video.onloadedmetadata = () => { video.play(); };
    video.onplay = () => {
      const canvas = document.getElementById('enrolar-canvas');
      if (enrolInterval) clearInterval(enrolInterval);
      enrolInterval = setInterval(async () => {
        if (enrolModo !== "CAMARA" || !faceModelsLoaded || video.videoWidth === 0) return;
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);
        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        if (detection) {
           faceapi.draw.drawDetections(canvas, faceapi.resizeResults(detection, displaySize));
           document.getElementById('enrolar-status').innerText = "Rostro Detectado. ¡Listo!";
           document.getElementById('enrolar-status').className = 'text-xs font-bold text-green-500 mb-3';
           enrolDescriptor = detection.descriptor;
           document.getElementById('btn-guardar-rostro').disabled = false;
           document.getElementById('btn-guardar-rostro').classList.remove('opacity-50', 'cursor-not-allowed');
        }
      }, 300);
    };
  } catch (e) { document.getElementById('enrolar-status').innerText = "Cámara inaccesible. Sube una foto."; }
}

async function procesarFotoArchivo(event) {
  const file = event.target.files[0];
  if (!file) return;
  enrolModo = "ARCHIVO"; clearInterval(enrolInterval);
  const video = document.getElementById('enrolar-video');
  if (video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
  video.classList.add('hidden');
  
  const preview = document.getElementById('enrolar-img-preview');
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('hidden');
  
  toggleLoader(true, 'Extrayendo biometría de la foto...');
  try {
     const img = await faceapi.bufferToImage(file);
     const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
     if (detection) {
        enrolDescriptor = detection.descriptor;
        document.getElementById('enrolar-status').innerText = "¡Rostro válido detectado en la foto!";
        document.getElementById('enrolar-status').className = "text-xs font-bold text-green-600 mb-3";
        document.getElementById('btn-guardar-rostro').disabled = false;
        document.getElementById('btn-guardar-rostro').classList.remove('opacity-50', 'cursor-not-allowed');
     } else {
        document.getElementById('enrolar-status').innerText = "No se detectó rostro claro. Prueba otra foto.";
        document.getElementById('enrolar-status').className = "text-xs font-bold text-red-500 mb-3";
     }
  } catch (err) { showToast("Error al leer imagen", "error"); }
  toggleLoader(false);
}

function closeEnrolarModal() {
   document.getElementById('modal-enrolar').classList.add('hidden');
   clearInterval(enrolInterval);
   const video = document.getElementById('enrolar-video');
   if (video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
}

async function capturarYGuardarRostro() {
   if (!enrolDescriptor) return;
   toggleLoader(true, 'Guardando Mapa Biométrico...');
   const payload = { 
     empresaId: currentEmpresa.empresaId, 
     empleadoId: currentEnrolId, 
     descriptorJson: JSON.stringify(Array.from(enrolDescriptor)),
     usuarioId: currentUser ? currentUser.id : 'RH'
   };
   try {
      const res = await runServer('apiEnrolarRostro', payload);
      if (res.status === 'success') { showToast(res.message); closeEnrolarModal(); loadEmpleados(); } 
      else showToast(res.message, 'error');
   } catch (e) { showToast('Fallo al guardar', 'error'); }
   toggleLoader(false);
}

// ==========================================
// BITÁCORA DE AUDITORÍA INMUTABLE SHA-256
// ==========================================
async function abrirAuditLog() {
  if (!puede('ver_audit_log') && (!currentUser || currentUser.rol !== 'SUPER_ADMIN')) {
    return showToast('Sin permiso para ver auditoría', 'error');
  }
  toggleLoader(true, 'Cargando bitácora SHA-256...');
  try {
    const empresaId = currentEmpresa ? currentEmpresa.empresaId : null;
    const res = await runServer('apiGetAuditLog', { empresaId, limite: 200 });
    const data = res.data || [];
    document.getElementById('table-audit').innerHTML = data.map(a => `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2 font-mono text-[11px] text-gray-600">${String(a.timestamp || '').substring(0, 19).replace('T', ' ')}</td>
        <td class="p-2 font-bold text-blue-700">${escapeHtml(a.accion)}</td>
        <td class="p-2 font-semibold">${escapeHtml(a.usuarioId || 'SISTEMA')}</td>
        <td class="p-2 text-[11px] text-gray-600 max-w-xs truncate" title="${escapeHtml(a.detalles)}">${escapeHtml(a.detalles)}</td>
        <td class="p-2 font-mono text-[10px] text-emerald-700">${String(a.hashActual || '').substring(0, 14)}...</td>
      </tr>
    `).join('') || '<tr><td colspan="5" class="p-4 text-center text-gray-400">Sin registros en la bitácora.</td></tr>';
    document.getElementById('modal-audit').classList.remove('hidden');
  } catch (e) { showToast('Error al cargar bitácora', 'error'); }
  toggleLoader(false);
}

async function verificarIntegridadAudit() {
  const empresaId = currentEmpresa ? currentEmpresa.empresaId : null;
  toggleLoader(true, 'Verificando cadena criptográfica SHA-256...');
  try {
    const res = await runServer('apiVerificarAudit', { empresaId });
    if (res.integridad) {
      showToast(`✅ Cadena íntegra sin alteraciones (${res.total} bloques verificados)`, 'success');
    } else {
      showToast(`❌ ${res.mensaje}`, 'error');
    }
  } catch (e) { showToast('Error al verificar cadena', 'error'); }
  toggleLoader(false);
}

// ==========================================
// CONSTRUCTOR VISUAL DE LAYOUTS DE NÓMINA
// ==========================================
const CAMPOS_ORIGEN_DISPONIBLES = [
  { value: "", label: "— Usar valor fijo —" },
  { value: "pin", label: "PIN del empleado" },
  { value: "fecha", label: "Fecha (YYYY-MM-DD)" },
  { value: "dia", label: "Día del mes (1-31)" },
  { value: "incidencia", label: "Incidencia (nombre)" },
  { value: "incidencia_codigo", label: "Incidencia (código CONTPAQi/Aspel)" },
  { value: "retardo", label: "Retardo (1 / 0)" },
  { value: "falta", label: "Falta (1 / 0)" },
  { value: "dobles", label: "Horas extra dobles" },
  { value: "triples", label: "Horas extra triples" },
  { value: "mins_comida", label: "Minutos de comida" },
  { value: "entrada", label: "Hora entrada" },
  { value: "salida", label: "Hora salida" },
  { value: "sucursal", label: "Sucursal / Obra" },
  { value: "rfc", label: "RFC" },
  { value: "curp", label: "CURP" },
  { value: "nombre", label: "Nombre completo" },
  { value: "uno", label: "Valor constante 1" }
];

async function loadLayouts() {
  if (!currentEmpresa) return;
  toggleLoader(true, 'Cargando layouts de nómina...');
  try {
    const res = await runServer('apiListarLayouts', { empresaId: currentEmpresa.empresaId });
    currentLayoutsData = res.data || {};
    renderLayoutsGrid();
  } catch (e) { showToast('Error al cargar layouts', 'error'); }
  toggleLoader(false);
}

function renderLayoutsGrid() {
  const grid = document.getElementById('grid-layouts');
  const sistemas = Object.keys(currentLayoutsData);
  if (!sistemas.length) {
    grid.innerHTML = '<div class="col-span-2 bg-white p-6 rounded-xl border text-center text-gray-500 text-xs">No hay layouts configurados. Presiona "+ Nuevo Layout Personalizado".</div>';
    return;
  }
  grid.innerHTML = sistemas.map(sistema => {
    const mapeo = currentLayoutsData[sistema] || [];
    const preview = mapeo.slice(0, 5).map(m => `<span class="bg-gray-100 border px-2 py-0.5 rounded text-[10px] font-mono mr-1 mb-1 inline-block">${escapeHtml(m.destino)} ← ${escapeHtml(m.origen || m.fijo)}</span>`).join('');
    const mas = mapeo.length > 5 ? `<span class="text-[10px] text-gray-400 font-bold">+${mapeo.length - 5} más</span>` : '';
    return `
      <div class="bg-white p-4 rounded-xl shadow border flex flex-col justify-between">
        <div>
          <div class="flex justify-between items-center mb-2">
            <h4 class="font-extrabold text-sm text-blue-800">${escapeHtml(sistema)}</h4>
            <span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold">${mapeo.length} columnas</span>
          </div>
          <div class="mb-3">${preview || '<span class="text-gray-400 text-xs">Sin columnas</span>'} ${mas}</div>
        </div>
        <div class="flex flex-wrap gap-1.5 pt-2 border-t text-xs">
          <button onclick="abrirModalLayout('${escapeHtml(sistema)}')" class="bg-gray-100 hover:bg-gray-200 text-gray-800 px-2.5 py-1 rounded font-bold">Editar</button>
          <button onclick="abrirProbarLayout('${escapeHtml(sistema)}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1 rounded font-bold">Probar Muestra</button>
          <button onclick="abrirExportLayout('${escapeHtml(sistema)}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded font-bold">Exportar</button>
          <button onclick="eliminarLayoutCompleto('${escapeHtml(sistema)}')" class="ml-auto text-red-600 hover:underline px-2 py-1 font-bold">Eliminar</button>
        </div>
      </div>
    `;
  }).join('');
  setTimeout(() => lucide.createIcons(), 50);
}

function abrirModalLayoutNuevo() {
  currentLayoutSistema = null;
  document.getElementById('layout-modal-titulo').innerText = 'Nuevo Layout de Nómina';
  document.getElementById('layout-sistema').value = '';
  document.getElementById('layout-sistema').disabled = false;
  document.getElementById('layout-descripcion').value = '';
  document.getElementById('table-mapeo-body').innerHTML = '';
  agregarFilaMapeo({ destino: 'Código Empleado', origen: 'pin', fijo: '', orden: 1 });
  agregarFilaMapeo({ destino: 'Fecha', origen: 'fecha', fijo: '', orden: 2 });
  agregarFilaMapeo({ destino: 'Incidencia', origen: 'incidencia_codigo', fijo: '', orden: 3 });
  document.getElementById('modal-layout').classList.remove('hidden');
}

function abrirModalLayout(sistema) {
  currentLayoutSistema = sistema;
  document.getElementById('layout-modal-titulo').innerText = `Editar Layout: ${sistema}`;
  document.getElementById('layout-sistema').value = sistema;
  document.getElementById('layout-sistema').disabled = true;
  document.getElementById('layout-descripcion').value = '';
  const body = document.getElementById('table-mapeo-body');
  body.innerHTML = '';
  const mapeo = currentLayoutsData[sistema] || [];
  mapeo.forEach(m => agregarFilaMapeo(m));
  if (!mapeo.length) agregarFilaMapeo({});
  document.getElementById('modal-layout').classList.remove('hidden');
}

function agregarFilaMapeo(data = {}) {
  const body = document.getElementById('table-mapeo-body');
  const num = body.children.length + 1;
  const options = CAMPOS_ORIGEN_DISPONIBLES.map(o => 
    `<option value="${o.value}" ${data.origen === o.value ? 'selected' : ''}>${o.label}</option>`
  ).join('');
  const tr = document.createElement('tr');
  tr.className = 'border-b';
  tr.innerHTML = `
    <td class="p-2 font-bold text-gray-500">${num}</td>
    <td class="p-2"><input type="text" class="mapeo-destino w-full border p-1.5 rounded text-xs font-semibold" value="${escapeHtml(data.destino || '')}" placeholder="Ej. ClaveTrabajador"></td>
    <td class="p-2"><select class="mapeo-origen w-full border p-1.5 rounded text-xs bg-white">${options}</select></td>
    <td class="p-2"><input type="text" class="mapeo-fijo w-full border p-1.5 rounded text-xs" value="${escapeHtml(data.fijo || '')}" placeholder="Opcional"></td>
    <td class="p-2 text-center"><button onclick="this.closest('tr').remove(); reenumerarMapeo();" class="text-red-500 font-bold hover:underline">✕</button></td>
  `;
  body.appendChild(tr);
}

function reenumerarMapeo() {
  const rows = document.querySelectorAll('#table-mapeo-body tr');
  rows.forEach((r, i) => { r.cells[0].innerText = i + 1; });
}

function verificarLayoutActual() {
  const rows = document.querySelectorAll('#table-mapeo-body tr');
  if (!rows.length) return showToast('Agrega al menos una columna', 'error');
  let errores = [];
  rows.forEach((r, idx) => {
    const destino = r.querySelector('.mapeo-destino').value.trim();
    const origen = r.querySelector('.mapeo-origen').value;
    const fijo = r.querySelector('.mapeo-fijo').value.trim();
    if (!destino) errores.push(`Fila ${idx + 1}: falta nombre de columna.`);
    if (!origen && !fijo) errores.push(`Fila ${idx + 1}: elige origen o valor fijo.`);
  });
  if (errores.length) showToast(`❌ ${errores[0]}`, 'error');
  else showToast(`✅ Layout válido (${rows.length} columnas)`, 'success');
}

async function guardarLayoutActual() {
  const sistema = document.getElementById('layout-sistema').value.trim().toUpperCase();
  if (!sistema) return showToast('El nombre del sistema es obligatorio', 'error');
  const rows = document.querySelectorAll('#table-mapeo-body tr');
  const mapeo = [];
  let error = null;
  rows.forEach((r, idx) => {
    const destino = r.querySelector('.mapeo-destino').value.trim();
    const origen = r.querySelector('.mapeo-origen').value;
    const fijo = r.querySelector('.mapeo-fijo').value.trim();
    if (!destino) return;
    if (!origen && !fijo) { error = `Fila ${idx + 1}: define un origen o valor fijo.`; return; }
    mapeo.push({ destino, origen, fijo, orden: mapeo.length + 1 });
  });
  if (error) return showToast(error, 'error');
  if (!mapeo.length) return showToast('Agrega al menos una columna', 'error');
  
  toggleLoader(true, 'Guardando layout...');
  try {
    const res = await runServer('apiGuardarLayout', {
      empresaId: currentEmpresa.empresaId,
      sistema,
      mapeo,
      usuarioId: currentUser ? currentUser.id : 'RH'
    });
    if (res.status === 'success') {
      showToast(res.message);
      document.getElementById('modal-layout').classList.add('hidden');
      loadLayouts();
    } else showToast(res.message, 'error');
  } catch (e) { showToast('Error al guardar layout', 'error'); }
  toggleLoader(false);
}

async function eliminarLayoutCompleto(sistema) {
  if (!confirm(`¿Eliminar el layout "${sistema}"?`)) return;
  toggleLoader(true, 'Eliminando...');
  try {
    const res = await runServer('apiEliminarLayout', {
      empresaId: currentEmpresa.empresaId,
      sistema,
      usuarioId: currentUser ? currentUser.id : 'RH'
    });
    if (res.status === 'success') { showToast(res.message); loadLayouts(); }
    else showToast(res.message, 'error');
  } catch (e) { showToast('Error al eliminar', 'error'); }
  toggleLoader(false);
}

function abrirExportLayout(sistema) {
  currentExportSistema = sistema;
  document.getElementById('export-layout-sistema').innerText = `Sistema: ${sistema}`;
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('export-layout-inicio').value = hoy;
  document.getElementById('export-layout-fin').value = hoy;
  document.getElementById('modal-export-layout').classList.remove('hidden');
}

async function ejecutarExportLayout() {
  if (!currentExportSistema) return;
  const fi = document.getElementById('export-layout-inicio').value;
  const ff = document.getElementById('export-layout-fin').value;
  if (!fi || !ff) return showToast('Selecciona ambas fechas', 'error');
  toggleLoader(true, `Exportando ${currentExportSistema}...`);
  try {
    const res = await runServer('apiExportLayoutPersonalizado', {
      empresaId: currentEmpresa.empresaId,
      fechaInicio: fi,
      fechaFin: ff,
      sistema: currentExportSistema,
      usuarioId: currentUser ? currentUser.id : 'RH'
    });
    if (res.status === 'success') {
      const blob = new Blob([res.contenido], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = res.archivo;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      showToast(`Layout ${currentExportSistema} descargado`);
      document.getElementById('modal-export-layout').classList.add('hidden');
    } else showToast(res.message, 'error');
  } catch (e) { showToast('Error al exportar', 'error'); }
  toggleLoader(false);
}

async function abrirProbarLayout(sistema) {
  toggleLoader(true, `Generando muestra de ${sistema}...`);
  try {
    const res = await runServer('apiProbarLayout', { empresaId: currentEmpresa.empresaId, sistema });
    if (res.status !== 'success') {
      toggleLoader(false);
      return showToast(res.message, 'error');
    }
    currentMuestraLayoutData = { sistema, contenido: res.contenido, archivo: res.archivo };
    const lineas = String(res.contenido).replace(/^\uFEFF/, '').split('\n');
    const headers = lineas[0].split(',');
    const filas = lineas.slice(1).filter(l => l.trim() !== '').map(l => l.split(','));
    
    document.getElementById('probar-layout-sistema').innerText = `Sistema: ${sistema} · ${filas.length} filas de prueba`;
    document.getElementById('probar-layout-header').innerHTML = headers.map(h => `<th class="p-2 border-b font-bold">${escapeHtml(h)}</th>`).join('');
    document.getElementById('probar-layout-body').innerHTML = filas.map(fila => 
      `<tr class="border-b">${fila.map(cel => `<td class="p-2 font-mono">${escapeHtml(cel)}</td>`).join('')}</tr>`
    ).join('');
    document.getElementById('modal-probar-layout').classList.remove('hidden');
  } catch (e) { showToast('Error al probar layout', 'error'); }
  toggleLoader(false);
}

function descargarMuestraLayout() {
  if (!currentMuestraLayoutData) return;
  const blob = new Blob([currentMuestraLayoutData.contenido], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = currentMuestraLayoutData.archivo;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ==========================================
// SUPER ADMIN PRO + DATABASE SHARDING
// ==========================================
async function loadEmpresas() {
  toggleLoader(true, 'Cargando clientes y Shards...');
  try {
    const res = await runServer('apiGetEmpresas', {});
    currentEmpresasList = res.data || [];
    document.getElementById('table-empresas').innerHTML = currentEmpresasList.map(c => {
      const mods = String(c.modulos || '').split(',').filter(Boolean);
      const badges = mods.map(m => `<span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-[10px] font-bold mr-1">${escapeHtml(m)}</span>`).join('');
      const rangoPrecio = c.empleadosActivos <= 30 ? 'Rango 1-30' : 'Rango 31-100+';
      
      const shardBadge = (c.shardId && c.shardId.length > 15)
        ? `<a href="https://docs.google.com/spreadsheets/d/${c.shardId}" target="_blank" class="inline-block mt-1 bg-teal-100 text-teal-800 border border-teal-300 px-2 py-0.5 rounded text-[10px] font-bold hover:underline">🗄️ BD Propia Aislada ↗</a>`
        : `<button onclick="migrarShardEmpresa('${c.id}', '${escapeHtml(c.nombre)}')" class="mt-1 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-400 px-2 py-0.5 rounded text-[10px] font-bold">⚡ Aislar BD (Crear Archivo Propio)</button>`;

      const hwBadge = `<span class="inline-block mt-1 ml-1 bg-gray-100 text-gray-700 border px-1.5 py-0.5 rounded text-[10px] font-semibold">⚙️ HW: ${c.capacidadHardware || 'ALTA'}</span>`;

      return `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-3">
          <div class="font-bold text-purple-700">${escapeHtml(c.id)}</div>
          <span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${c.estatus === 'SUSPENDIDA' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">${c.estatus || 'ACTIVA'}</span>
        </td>
        <td class="p-3 font-bold">${escapeHtml(c.nombre)}<br>${shardBadge}${hwBadge}</td>
        <td class="p-3 text-center">
          <span class="font-extrabold text-sm text-blue-600">${c.empleadosActivos}</span> activos<br>
          <span class="text-[10px] text-gray-500 font-semibold">${rangoPrecio}</span>
        </td>
        <td class="p-3">${badges}</td>
        <td class="p-3 text-right space-x-1">
          <button onclick="abrirEditarEmpresaCompleta('${c.id}')" class="bg-gray-800 hover:bg-gray-700 text-white px-2.5 py-1 rounded text-xs font-bold">Editar / Módulos</button>
          <button onclick="toggleStatusEmpresa('${c.id}', '${c.estatus === 'SUSPENDIDA' ? 'ACTIVA' : 'SUSPENDIDA'}')" class="${c.estatus === 'SUSPENDIDA' ? 'bg-green-600 text-white' : 'bg-red-100 text-red-700'} px-2.5 py-1 rounded text-xs font-bold">${c.estatus === 'SUSPENDIDA' ? 'Reactivar' : 'Suspender'}</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {} 
  toggleLoader(false);
}

async function migrarShardEmpresa(empresaId, nombre) {
  toggleLoader(true, `Creando Google Sheet independiente para ${nombre}...`);
  try {
    const res = await runServer('apiMigrateEmpresaShard', { empresaId });
    if (res.status === 'success') {
      showToast(res.message, 'success');
      loadEmpresas();
    } else showToast(res.message, 'error');
  } catch (e) { showToast('Error al crear BD aislada', 'error'); }
  toggleLoader(false);
}

function abrirModalEmpresa() {
  document.getElementById('modal-cia-titulo').innerText = 'Alta de Nueva Empresa Cliente';
  document.getElementById('edit-cia-id').value = '';
  document.getElementById('new-cia-nombre').value = '';
  document.getElementById('new-cia-lat').value = '';
  document.getElementById('new-cia-lng').value = '';
  document.getElementById('new-cia-radio').value = '100';
  document.getElementById('new-cia-pin').value = '';
  document.getElementById('new-cia-hardware').value = 'ALTA';
  document.querySelectorAll('.chk-modulo').forEach(cb => cb.checked = cb.value !== 'CAMPO');
  document.getElementById('modal-empresa').classList.remove('hidden');
}

function abrirEditarEmpresaCompleta(id) {
  const cia = currentEmpresasList.find(x => String(x.id) === String(id));
  if (!cia) return;
  document.getElementById('modal-cia-titulo').innerText = `Editar Cliente: ${cia.nombre}`;
  document.getElementById('edit-cia-id').value = cia.id;
  document.getElementById('new-cia-nombre').value = cia.nombre || '';
  document.getElementById('new-cia-lat').value = cia.lat || '';
  document.getElementById('new-cia-lng').value = cia.lng || '';
  document.getElementById('new-cia-radio').value = cia.radio || '100';
  document.getElementById('new-cia-pin').value = '';
  document.getElementById('new-cia-hardware').value = cia.capacidadHardware || 'ALTA';
  const activos = String(cia.modulos || '').toUpperCase().split(',').map(s => s.trim());
  document.querySelectorAll('.chk-modulo').forEach(cb => { cb.checked = activos.includes(cb.value); });
  document.getElementById('modal-empresa').classList.remove('hidden');
}

async function saveEmpresa() {
  const editId = document.getElementById('edit-cia-id').value;
  const seleccionados = Array.from(document.querySelectorAll('.chk-modulo:checked')).map(cb => cb.value).join(',');
  const payload = { 
    id: editId,
    nombre: document.getElementById('new-cia-nombre').value.trim(), 
    lat: document.getElementById('new-cia-lat').value.trim(), 
    lng: document.getElementById('new-cia-lng').value.trim(), 
    radio: document.getElementById('new-cia-radio').value.trim(), 
    pin: document.getElementById('new-cia-pin').value.trim(), 
    modulos: seleccionados || 'FOTO,GPS',
    capacidadHardware: document.getElementById('new-cia-hardware').value
  };
  if (!payload.nombre || (!editId && !payload.pin)) return showToast('Nombre y PIN obligatorios', 'error');
  
  const action = editId ? 'apiUpdateEmpresa' : 'apiAddEmpresa';
  toggleLoader(true, editId ? 'Actualizando cliente...' : 'Creando empresa y Base de Datos...'); 
  const res = await runServer(action, payload); 
  toggleLoader(false);
  if (res.status === 'success') { showToast(res.message); document.getElementById('modal-empresa').classList.add('hidden'); loadEmpresas(); } 
  else showToast(res.message, 'error');
}

async function toggleStatusEmpresa(empresaId, newStatus) {
  toggleLoader(true, `Cambiando estatus a ${newStatus}...`);
  await runServer('apiToggleEmpresaStatus', { empresaId, newStatus });
  toggleLoader(false);
  loadEmpresas();
}

// ==========================================
// REGISTRO KIOSCO (CON 4 MOMENTOS, CONSENTIMIENTO Y OFFLINE)
// ==========================================
function initGPS() { if (navigator.geolocation) navigator.geolocation.watchPosition(p => { currentLat = p.coords.latitude; currentLng = p.coords.longitude; }, () => {}); }

async function registrar(tipo) {
  const pin = document.getElementById('pin-input').value;
  if (!pin) {
    const manualBox = document.getElementById('pin-manual-box');
    if (manualBox) manualBox.classList.remove('hidden');
    return showToast('Acerca tu rostro, escanea QR o ingresa tu PIN', 'error');
  }
  
  if (tieneModulo(kioskEmpresa, 'CAMPO') && (currentLat === null || currentLng === null)) {
    initGPS();
  }

  const video = document.getElementById('live-video');
  const canvas = document.getElementById('capture-canvas');
  
  if (tieneModulo(kioskEmpresa, 'FOTO')) {
    if (!videoStream || video.videoWidth === 0) return showToast('Cámara inactiva', 'error');
    const scale = Math.min(1, 480 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const flash = document.getElementById('flash-overlay');
    if (flash) { flash.classList.replace('opacity-0', 'opacity-100'); setTimeout(() => flash.classList.replace('opacity-100', 'opacity-0'), 150); }
    base64Photo = canvas.toDataURL('image/jpeg', 0.55);
  } else { base64Photo = null; }
  
  const fechaActual = new Date();
  const payload = { 
    empresaId: kioskEmpresa ? kioskEmpresa.empresaId : null,
    pin: pin, 
    tipo: tipo, 
    lat: currentLat, 
    lng: currentLng, 
    fotoBase64: base64Photo, 
    isOffline: !navigator.onLine, 
    offlineDate: fechaActual.toLocaleDateString('en-CA'), 
    offlineTime: fechaActual.toLocaleTimeString('en-GB') 
  };

  if (!navigator.onLine) return guardarLocalmente(payload);

  toggleLoader(true, 'Registrando movimiento...');
  try {
    const res = await runServer('apiProcessCheckIn', payload);
    if (res.status === 'success') { 
      mostrarSaludoKiosco(res.empleadoNombre || 'COLABORADOR');
      showToast(res.message); 
      hablarKiosco(`${tipo.replace('_', ' ')} registrada. Gracias, ${res.empleadoNombre || ''}`);
      setTimeout(() => resetKiosk(), 1800);
    } else if (res.requiresConsent) {
      pendingConsent = { empleadoId: res.empleadoId, empleadoNombre: res.empleadoNombre, pin, payload };
      mostrarModalConsentimiento(res.empleadoNombre);
    } else {
      showToast(res.message, 'error');
      hablarKiosco(res.message);
    }
  } catch (e) { guardarLocalmente(payload); } 
  toggleLoader(false);
}

async function mostrarModalConsentimiento(nombreEmpleado) {
  try {
    const res = await runServer('apiGetAvisoPrivacidad', { empresaId: kioskEmpresa.empresaId });
    currentConsentText = res.texto || 'Aviso de privacidad institucional LFT 2027.';
    document.getElementById('consent-texto').innerText = currentConsentText;
    document.getElementById('consent-empleado').innerText = `Colaborador: ${nombreEmpleado || ''}`;
    document.getElementById('modal-consent').classList.remove('hidden');
  } catch (e) { showToast('Error al cargar aviso', 'error'); }
}

async function aceptarConsentimiento() {
  if (!pendingConsent) return;
  toggleLoader(true, 'Sellando acuerdo digital...');
  try {
    const res = await runServer('apiRegisterConsent', {
      empresaId: kioskEmpresa.empresaId,
      empleadoId: pendingConsent.empleadoId,
      pin: pendingConsent.pin,
      metodo: 'KIOSCO_DIGITAL'
    });
    if (res.status === 'success') {
      document.getElementById('modal-consent').classList.add('hidden');
      const retryPayload = pendingConsent.payload;
      pendingConsent = null;
      const retry = await runServer('apiProcessCheckIn', retryPayload);
      if (retry.status === 'success') {
        mostrarSaludoKiosco(retry.empleadoNombre);
        showToast(retry.message);
        hablarKiosco(`Consentimiento y asistencia registrados`);
        setTimeout(() => resetKiosk(), 1800);
      } else showToast(retry.message, 'error');
    } else showToast(res.message, 'error');
  } catch (e) { showToast('Error al aceptar', 'error'); }
  toggleLoader(false);
}

function rechazarConsentimiento() {
  pendingConsent = null;
  document.getElementById('modal-consent').classList.add('hidden');
  showToast('Es necesario aceptar el acuerdo para registrar asistencia', 'error');
  resetKiosk();
}

function guardarLocalmente(payload) {
  let offlineData = JSON.parse(localStorage.getItem('offline_registros') || '[]');
  offlineData.push(payload); localStorage.setItem('offline_registros', JSON.stringify(offlineData));
  const nombreLocal = empleadosPinMap[String(payload.pin).trim()] || '';
  if (nombreLocal) mostrarSaludoKiosco(nombreLocal);
  showToast('Guardado en Memoria Offline', 'success');
  hablarKiosco(`Movimiento guardado sin conexión`);
  setTimeout(() => resetKiosk(), 1500);
  updateOfflineUI();
}

function updateOfflineUI() {
  let offlineData = JSON.parse(localStorage.getItem('offline_registros') || '[]');
  const banner = document.getElementById('offline-banner');
  if (offlineData.length > 0) { document.getElementById('offline-count').innerText = offlineData.length; banner.classList.remove('hidden'); banner.classList.add('flex'); } 
  else { banner.classList.add('hidden'); banner.classList.remove('flex'); }
}

async function syncOffline() {
  if (!navigator.onLine) return showToast('Sin conexión a internet', 'error');
  let offlineData = JSON.parse(localStorage.getItem('offline_registros') || '[]');
  if (offlineData.length === 0) return;
  toggleLoader(true, `Sincronizando ${offlineData.length} registros...`);
  try {
    const res = await runServer('apiSyncOffline', offlineData);
    if (res.status === 'success') { localStorage.removeItem('offline_registros'); showToast(res.message); updateOfflineUI(); } 
    else showToast(res.message, 'error');
  } catch (e) { showToast('Fallo de conexión', 'error'); } 
  toggleLoader(false);
}

function resetKiosk() {
  document.getElementById('pin-input').value = ''; 
  base64Photo = null;
  detenerEscaneoQR();
  const card = document.getElementById('kiosk-greeting-card');
  if (card) card.classList.add('hidden');
  const manualBox = document.getElementById('pin-manual-box');
  if (manualBox) manualBox.classList.add('hidden');
  const statusEl = document.getElementById('kiosk-ai-status');
  if (statusEl && tieneModulo(kioskEmpresa, 'BIOMETRIA_IA')) {
    statusEl.innerText = "Acerca tu rostro dentro del círculo";
    statusEl.className = "text-base md:text-lg text-emerald-400 font-bold tracking-wide";
  }
}
