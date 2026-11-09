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
let currentEmpresa = null;
let currentReportData = [];
let currentEmpleadosData = [];
let currentEmpresasList = [];
let currentLat = null, currentLng = null, base64Photo = null;
let html5QrcodeScanner = null, videoStream = null;
let isSavingEmpleado = false;
let selectedIncidenciaTarget = null;

// Variables Biometría IA
let faceModelsLoaded = false;
let kioskEmpresa = JSON.parse(localStorage.getItem('kiosco_empresa') || 'null');
let labeledFaceDescriptors = [];
let faceMatcher = null;
let faceDetectionInterval = null;
let enrolDescriptor = null;
let enrolInterval = null;
let currentEnrolId = null;
let enrolModo = "CAMARA";

setInterval(() => {
  const clk = document.getElementById('live-clock');
  if(clk) clk.innerText = new Date().toLocaleTimeString('es-MX', { hour12: false });
}, 1000);

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

function imprimirElemento(elementId) {
  document.getElementById(elementId).classList.add('printable-active');
  window.print();
}

function cerrarModalImpresion(modalId, elementId) {
  document.getElementById(elementId).classList.remove('printable-active');
  document.getElementById(modalId).classList.add('hidden');
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
// NAVEGACIÓN
// ==========================================
function showView(viewId) {
  ['view-menu', 'view-admin', 'view-kiosk', 'view-dashboard', 'view-superadmin'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.add('hidden');
    el.classList.remove('flex');
  });
  
  const target = document.getElementById(viewId);
  target.classList.remove('hidden');
  if(viewId === 'view-dashboard' || viewId === 'view-superadmin') {
    target.classList.add('flex');
  }
  
  if(viewId === 'view-kiosk') { 
    initGPS(); updateOfflineUI(); aplicarModulosKiosco(); initKioskAI(); startCamera(); 
  } else { stopCamera(); }
}

function aplicarModulosKiosco() {
  const badge = document.getElementById('kiosk-sucursal-badge');
  const btnQr = document.getElementById('btn-kiosk-qr');
  const btnsComida = document.getElementById('kiosk-comida-btns');
  if (kioskEmpresa) {
    const esCampo = tieneModulo(kioskEmpresa, 'CAMPO');
    badge.innerText = esCampo 
      ? `📍 Modo Obra / Campo: ${kioskEmpresa.nombre}` 
      : `📍 ${kioskEmpresa.nombre}`;
    if (btnQr) btnQr.style.display = tieneModulo(kioskEmpresa, 'QR') ? 'flex' : 'none';
    if (btnsComida) btnsComida.style.display = tieneModulo(kioskEmpresa, 'LFT_PRENOMINA') ? 'grid' : 'none';
  } else {
    badge.innerText = `Kiosco sin vincular (Inicia sesión en RH una vez)`;
  }
}

function toggleLoader(s, t='Procesando...') { 
  const l = document.getElementById('loader'); 
  document.getElementById('loader-text').innerText = t; 
  if(s) { l.classList.remove('hidden'); l.classList.add('flex'); } 
  else { l.classList.add('hidden'); l.classList.remove('flex'); } 
}

function showToast(m, t='success') { 
  const c = document.getElementById('toast-container');
  const d = document.createElement('div'); 
  d.className = `toast ${t==='success'?'bg-green-600':'bg-red-600'} text-white px-4 py-3 rounded-lg font-bold flex items-center gap-2 mb-2 z-50 shadow-lg text-xs md:text-sm`; 
  d.innerHTML = `<i data-lucide="${t==='success'?'check-circle':'alert-circle'}"></i> ${m}`; 
  c.appendChild(d); lucide.createIcons(); 
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 300); }, 3500); 
}

// ==========================================
// CÁMARA KIOSCO E IA BIOMÉTRICA (ESTILO CIRCULAR + TARJETA SALUDO)
// ==========================================
async function startCamera() {
  const video = document.getElementById('live-video');
  const canvas = document.getElementById('face-canvas');
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = videoStream;
    video.onloadedmetadata = () => { video.play(); };
    
    video.onplay = () => {
      faceDetectionInterval = setInterval(async () => {
        if(!faceModelsLoaded || video.videoWidth === 0 || !tieneModulo(kioskEmpresa, 'BIOMETRIA_IA')) return;
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);
        
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptors();
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        
        if(faceMatcher && resizedDetections.length > 0) {
           const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));
           results.forEach((result) => {
              if(result.label !== 'unknown') {
                 const [pinDetectado, nombreDetectado] = result.label.split('|');
                 const pinInput = document.getElementById('pin-input');
                 if(pinInput.value !== pinDetectado) {
                     pinInput.value = pinDetectado;
                     const card = document.getElementById('kiosk-greeting-card');
                     const nameEl = document.getElementById('kiosk-greeting-name');
                     const avatarEl = document.getElementById('kiosk-greeting-avatar');
                     if(card && nameEl) {
                       const primerNombre = nombreDetectado.split(' ')[0].toUpperCase();
                       nameEl.innerText = `¡HOLA, ${primerNombre}!`;
                       if(avatarEl) avatarEl.innerText = primerNombre.charAt(0);
                       card.classList.remove('hidden');
                     }
                     hablarKiosco(`Hola ${nombreDetectado.split(' ')[0]}`);
                 }
              }
           });
        }
      }, 400);
    };
  } catch (err) { showToast("Permiso de cámara requerido", "error"); }
}

function stopCamera() {
  if(faceDetectionInterval) clearInterval(faceDetectionInterval);
  if (videoStream) { videoStream.getTracks().forEach(track => track.stop()); videoStream = null; }
}

async function initKioskAI() {
  const statusEl = document.getElementById('kiosk-ai-status');
  if(!kioskEmpresa) return;
  if(!tieneModulo(kioskEmpresa, 'BIOMETRIA_IA')) {
    if(statusEl) statusEl.innerText = "Selecciona Gafete QR o PIN Manual";
    return;
  }
  if(!navigator.onLine) {
    if(statusEl) { statusEl.innerText = "Modo Offline Activo (Usa tu PIN o QR)"; statusEl.className = "text-xs text-amber-400 font-semibold mb-3"; }
    return;
  }

  try {
     const res = await runServer('apiGetEmpleados', kioskEmpresa.empresaId);
     labeledFaceDescriptors = [];
     for(let e of res.data) {
        if(e.mapaFacial && e.estatus === 'ACTIVO') {
           const arr = new Float32Array(JSON.parse(e.mapaFacial));
           labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(`${e.pin}|${e.nombre}`, [arr])); 
        }
     }
     if(labeledFaceDescriptors.length > 0) {
        faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.55);
        if(statusEl) { statusEl.innerText = `IA Biométrica Activa • Mira al frente`; statusEl.className = 'text-xs text-emerald-400 font-semibold mb-3'; }
     } else {
        if(statusEl) { statusEl.innerText = "IA Lista (Enrola rostros en RH)"; }
     }
  } catch(e) {}
}

// ==========================================
// SESIÓN DE ADMINISTRADORES Y PESTAÑAS
// ==========================================
async function loginAdmin() {
  const pin = document.getElementById('admin-pin').value;
  if(!pin) return showToast('Ingresa PIN', 'error');
  
  toggleLoader(true, 'Autenticando...');
  try {
    const res = await runServer('apiAdminLogin', pin);
    if(res.status === 'success') {
      document.getElementById('admin-pin').value = '';
      if(res.role === 'SUPER_ADMIN') {
        loadEmpresas(); showView('view-superadmin');
      } else {
        currentEmpresa = res.data; 
        localStorage.setItem('kiosco_empresa', JSON.stringify(currentEmpresa)); 
        kioskEmpresa = currentEmpresa; 
        
        document.getElementById('empresa-name').innerText = `RH: ${currentEmpresa.nombre}`;
        document.getElementById('empresa-modulos-badges').innerText = `Módulos LFT 2027: ${currentEmpresa.modulos || 'COMPLETO'}`;
        const hoy = new Date().toISOString().split('T')[0]; 
        document.getElementById('date-start').value = hoy; 
        document.getElementById('date-end').value = hoy;
        showView('view-dashboard');
        loadEmpleados();
        loadTurnosYSucursales();
      }
    } else showToast(res.message, 'error');
  } catch(e) { showToast('Servidor inaccesible', 'error'); } 
  toggleLoader(false);
}

function logoutAdmin() { currentEmpresa = null; currentReportData = []; showView('view-menu'); }

function switchRHTab(tabId) {
  ['prenomina', 'empleados', 'config'].forEach(t => {
    document.getElementById('tab-' + t).classList.add('hidden');
    document.getElementById('tab-btn-' + t).classList.replace('border-blue-400', 'border-transparent');
    document.getElementById('tab-btn-' + t).classList.replace('text-white', 'text-gray-400');
  });
  
  document.getElementById('tab-' + tabId).classList.remove('hidden');
  document.getElementById('tab-btn-' + tabId).classList.replace('border-transparent', 'border-blue-400');
  document.getElementById('tab-btn-' + tabId).classList.replace('text-gray-400', 'text-white');
  
  if(tabId === 'empleados') loadEmpleados();
  if(tabId === 'config') loadTurnosYSucursales();
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

  if(data.length === 0) {
    tb.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-gray-500">Sin registros en este filtro.</td></tr>'; 
  } else {
    btn.classList.remove('hidden');
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

      const btnJustificar = (row.entrada === '--') 
        ? `<button onclick="abrirModalIncidencia('${row.empId}', '${row.empleado}', '${row.fecha}')" class="text-[11px] bg-gray-100 hover:bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded border ml-1">Justificar</button>` 
        : '';

      return `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2.5 font-bold">${row.empleado} <br><span class="text-[10px] text-gray-500 font-normal">PIN: ${row.pin || row.empId} ${row.rfc ? '| RFC: '+row.rfc : ''}</span></td>
        <td class="p-2.5"><span class="bg-gray-100 border px-2 py-0.5 rounded text-[11px] font-semibold">${row.sucursal || 'Matriz'}</span></td>
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
  selectedIncidenciaTarget = { empId, fecha };
  document.getElementById('inc-emp-info').innerText = `${nombre} — Fecha: ${fecha}`;
  document.getElementById('modal-incidencia').classList.remove('hidden');
}

async function guardarIncidencia() {
  if(!selectedIncidenciaTarget) return;
  const motivo = document.getElementById('inc-motivo').value;
  toggleLoader(true, 'Sellando bitácora STPS...');
  try {
    const res = await runServer('apiJustificarIncidencia', {
      empresaId: currentEmpresa.empresaId,
      empId: selectedIncidenciaTarget.empId,
      fecha: selectedIncidenciaTarget.fecha,
      motivo: motivo
    });
    if(res.status === 'success') {
      showToast(res.message);
      document.getElementById('modal-incidencia').classList.add('hidden');
      loadReports();
    } else showToast(res.message, 'error');
  } catch(e) { showToast('Error al justificar', 'error'); }
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
  if(!currentEmpresa) return;
  const s = document.getElementById('date-start').value, e = document.getElementById('date-end').value;
  if(!s || !e) return; 
  toggleLoader(true, 'Calculando Pre-Nómina LFT 2027...');
  try {
    const res = await runServer('apiGetReports', { empresaId: currentEmpresa.empresaId, fechaInicio: s, fechaFin: e });
    currentReportData = res.data || [];
    actualizarSelectoresSucursales(currentReportData);
    filterReport();
  } catch(er) { showToast('Error al generar reporte', 'error'); } 
  toggleLoader(false);
}

function exportToCSV() {
  if (currentReportData.length === 0) return;
  const headers = ["Empleado", "RFC", "CURP", "PIN", "Sucursal_Obra", "Fecha", "Entrada", "Inicio Comida", "Fin Comida", "Minutos Comida", "Salida", "Incidencia", "Horas Dobles", "Horas Triples", "Auditoria GPS", "Latitud", "Longitud"];
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
    row.estatusGeo,
    row.lat || '',
    row.lng || ''
  ].join(","));
  
  const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Prenomina_STPS_${currentEmpresa.nombre.replace(/\s+/g, '_')}_${document.getElementById('date-start').value}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ==========================================
// COLABORADORES: EDICIÓN, RFC/CURP, ACUERDO LFT 2027 Y GAFETES
// ==========================================
function actualizarSelectoresSucursales(listaItems) {
  const sucursales = [...new Set(listaItems.map(i => i.sucursal || 'Matriz'))].sort();
  const selReport = document.getElementById('filter-sucursal-report');
  const selEmp = document.getElementById('filter-sucursal-emp');
  const dataList = document.getElementById('lista-sucursales');
  
  if(selReport) selReport.innerHTML = '<option value="TODAS">Todas</option>' + sucursales.map(s => `<option value="${s}">${s}</option>`).join('');
  if(selEmp) selEmp.innerHTML = '<option value="TODAS">Todas</option>' + sucursales.map(s => `<option value="${s}">${s}</option>`).join('');
  if(dataList) dataList.innerHTML = sucursales.map(s => `<option value="${s}"></option>`).join('');
}

async function loadEmpleados() {
  if(!currentEmpresa) return;
  toggleLoader(true, 'Cargando catálogo...');
  try {
    const res = await runServer('apiGetEmpleados', currentEmpresa.empresaId);
    currentEmpleadosData = res.data || [];
    actualizarSelectoresSucursales(currentEmpleadosData);
    filterEmpleadosTable();
  } catch(e) {} 
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
      <td class="p-2.5 font-bold">${e.nombre} <br><span class="${e.estatus==='ACTIVO'?'text-green-600':'text-red-500'} text-[10px] font-extrabold">${e.estatus}</span></td>
      <td class="p-2.5 font-mono text-[11px] text-gray-600">
        <div>RFC: <strong>${e.rfc || 'Sin capturar'}</strong></div>
        <div>CURP: <strong>${e.curp || 'Sin capturar'}</strong></div>
      </td>
      <td class="p-2.5">
        <span class="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded text-[11px] font-semibold">${e.sucursal || 'Matriz'}</span>
        <span class="ml-1 font-bold text-gray-600">(${e.turno})</span>
      </td>
      <td class="p-2.5">
        <span class="text-blue-600 font-bold mr-1">${e.pin}</span>
        <button onclick="verGafeteQR('${e.id}')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded border text-[11px] font-bold"><i data-lucide="qr-code" class="w-3 h-3 inline"></i> QR</button>
      </td>
      <td class="p-2.5 text-center">${e.mapaFacial ? `<button onclick="openEnrolarModal('${e.id}', '${e.nombre}')" class="text-green-600 font-bold text-xs hover:underline"><i data-lucide="check-circle" class="w-3.5 h-3.5 inline"></i> Activo</button>` : `<button onclick="openEnrolarModal('${e.id}', '${e.nombre}')" class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs font-bold">Enrolar</button>`}</td>
      <td class="p-2.5 text-center">
        <button onclick="verCartaAcuerdoLFT('${e.id}')" class="bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 mx-auto"><i data-lucide="file-check" class="w-3 h-3"></i> Carta STPS</button>
      </td>
      <td class="p-2.5 text-right space-x-1">
        <button onclick="abrirModalEditarEmpleado('${e.id}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-bold text-xs">Editar</button>
        <button onclick="toggleEstatus('${e.id}', '${e.estatus==='ACTIVO'?'INACTIVO':'ACTIVO'}')" class="bg-gray-200 hover:bg-gray-300 px-2 py-0.5 rounded font-bold text-xs">${e.estatus==='ACTIVO'?'Baja':'Alta'}</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="p-6 text-center text-gray-500">Sin colaboradores registrados.</td></tr>';
  lucide.createIcons();
}

function abrirModalNuevoEmpleado() {
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
  const emp = currentEmpleadosData.find(x => String(x.id) === String(empId));
  if(!emp) return;
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
    turnoId: document.getElementById('new-emp-turno').value || 'T1'
  };
  if(!payload.nombre || !payload.pin) return showToast('Nombre y PIN son obligatorios', 'error');
  
  isSavingEmpleado = true;
  const action = editId ? 'apiUpdateEmpleado' : 'apiAddEmpleado';
  toggleLoader(true, editId ? 'Actualizando expediente...' : 'Guardando colaborador...');
  
  try {
    const res = await runServer(action, payload);
    await loadEmpleados();
    const yaExisteEnTabla = currentEmpleadosData.some(
      e => String(e.pin).trim() === payload.pin && e.nombre.toLowerCase() === payload.nombre.toLowerCase()
    );

    if(res.status === 'success' || yaExisteEnTabla) { 
      showToast('Expediente guardado correctamente', 'success'); 
      document.getElementById('modal-empleado').classList.add('hidden'); 
    } else {
      showToast(res.message, 'error');
    }
  } catch(e) { 
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
  if(!emp) return;
  document.getElementById('gafete-empresa').innerText = current
