// ==========================================
// CONFIGURACIÓN Y VARIABLES GLOBALES
// ==========================================
const API_URL = "https://script.google.com/macros/s/AKfycbwc5kuAuMLBvhdFk-IWgs5s7Ly231_yDHONGR4psLMzveBPnBJqW1_z8mwveES7GaoQtg/exec";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => console.log("SW Registro falló:", err));
  });
}

lucide.createIcons();
let currentEmpresa = null;
let currentReportData = [];
let currentEmpleadosData = [];
let currentLat = null, currentLng = null, base64Photo = null;
let html5QrcodeScanner = null, videoStream = null;
let isSavingEmpleado = false; // Candado en cliente contra doble envío
let editingEmpresaId = null;

// Variables de Inteligencia Artificial (Biometría)
let faceModelsLoaded = false;
let kioskEmpresa = JSON.parse(localStorage.getItem('kiosco_empresa') || 'null');
let labeledFaceDescriptors = [];
let faceMatcher = null;
let faceDetectionInterval = null;
let enrolDescriptor = null;
let enrolInterval = null;
let currentEnrolId = null;
let enrolModo = "CAMARA";

// Helper para verificar si la empresa tiene activo un módulo
function tieneModulo(empresaObj, mod) {
  if (!empresaObj || !empresaObj.modulos) return true;
  return String(empresaObj.modulos).toUpperCase().split(',').map(s => s.trim()).includes(mod);
}

// ==========================================
// ARRANQUE Y DESCARGA DE REDES NEURONALES
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
  } catch (err) {
    console.error("Modelos IA pendientes:", err);
  }
};

// ==========================================
// MOTOR DE COMUNICACIÓN
// ==========================================
async function runServer(actionName, payloadData) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: actionName, payload: payloadData })
  });
  return await response.json();
}

// ==========================================
// NAVEGACIÓN (FIX DE FLEXBOX PARA SCROLL VERTICAL)
// ==========================================
function showView(viewId) {
  ['view-menu', 'view-admin', 'view-kiosk', 'view-dashboard', 'view-superadmin'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.add('hidden');
    el.classList.remove('flex');
  });
  
  const target = document.getElementById(viewId);
  target.classList.remove('hidden');
  // VITAL: Si es dashboard o superadmin, activamos display:flex para que funcione el scroll interno
  if(viewId === 'view-dashboard' || viewId === 'view-superadmin') {
    target.classList.add('flex');
  }
  
  if(viewId === 'view-kiosk') { 
    initGPS(); 
    updateOfflineUI(); 
    aplicarModulosKiosco();
    initKioskAI(); 
    startCamera(); 
  } else { 
    stopCamera(); 
  }
}

function aplicarModulosKiosco() {
  const badge = document.getElementById('kiosk-sucursal-badge');
  const btnQr = document.getElementById('btn-kiosk-qr');
  if (kioskEmpresa) {
    badge.innerText = `Empresa vinculada: ${kioskEmpresa.nombre}`;
    if (btnQr) btnQr.style.display = tieneModulo(kioskEmpresa, 'QR') ? 'flex' : 'none';
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
  d.className = `toast ${t==='success'?'bg-green-600':'bg-red-600'} text-white px-5 py-3 rounded-lg font-bold flex items-center gap-2 mb-2 z-50 shadow-lg text-sm`; 
  d.innerHTML = `<i data-lucide="${t==='success'?'check-circle':'alert-circle'}"></i> ${m}`; 
  c.appendChild(d); lucide.createIcons(); 
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 300); }, 3500); 
}

// ==========================================
// CÁMARA KIOSCO Y DETECCIÓN FACIAL
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
        faceapi.draw.drawDetections(canvas, resizedDetections);
        
        if(faceMatcher && resizedDetections.length > 0) {
           const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));
           results.forEach((result, i) => {
              if(result.label !== 'unknown') {
                 const pinInput = document.getElementById('pin-input');
                 if(pinInput.value !== result.label) {
                     pinInput.value = result.label;
                     showToast(`¡Rostro identificado! Presiona Entrada o Salida.`, 'success');
                 }
                 const drawBox = new faceapi.draw.DrawBox(resizedDetections[i].detection.box, { label: "Identificado" });
                 drawBox.draw(canvas);
              }
           });
        }
      }, 400);
    };
  } catch (err) { showToast("Permiso de cámara denegado", "error"); }
}

function stopCamera() {
  if(faceDetectionInterval) clearInterval(faceDetectionInterval);
  if (videoStream) { videoStream.getTracks().forEach(track => track.stop()); videoStream = null; }
}

async function initKioskAI() {
  const statusEl = document.getElementById('kiosk-ai-status');
  if(!kioskEmpresa) {
    if(statusEl) statusEl.innerText = "Ingresa a RH primero para vincular este Kiosco.";
    return;
  }
  if(!tieneModulo(kioskEmpresa, 'BIOMETRIA_IA')) {
    if(statusEl) { statusEl.innerText = "Modo PIN / QR Activo"; statusEl.className = "text-xs text-gray-500 font-semibold mb-3"; }
    return;
  }
  if(!navigator.onLine) {
    if(statusEl) { statusEl.innerText = "Modo Offline Activo (Usa tu PIN)"; statusEl.className = "text-xs text-yellow-600 font-semibold mb-3"; }
    return;
  }

  try {
     const res = await runServer('apiGetEmpleados', kioskEmpresa.empresaId);
     labeledFaceDescriptors = [];
     for(let e of res.data) {
        if(e.mapaFacial && e.estatus === 'ACTIVO') {
           const arr = new Float32Array(JSON.parse(e.mapaFacial));
           labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(String(e.pin), [arr])); 
        }
     }
     if(labeledFaceDescriptors.length > 0) {
        faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.55);
        if(statusEl) { statusEl.innerText = `IA Biométrica Activa (${labeledFaceDescriptors.length} rostros)`; statusEl.className = 'text-xs text-green-600 font-semibold mb-3'; }
     } else {
        if(statusEl) { statusEl.innerText = "IA Lista (Sin rostros enrolados aún)"; statusEl.className = 'text-xs text-blue-600 font-semibold mb-3'; }
     }
  } catch(e) {
    if(statusEl) { statusEl.innerText = "Modo PIN Manual Activo"; }
  }
}

// ==========================================
// SESIÓN DE ADMINISTRADORES
// ==========================================
async function loginAdmin() {
  const pin = document.getElementById('admin-pin').value;
  if(!pin) return showToast('Ingresa PIN', 'error');
  
  toggleLoader(true, 'Conectando...');
  try {
    const res = await runServer('apiAdminLogin', pin);
    if(res.status === 'success') {
      document.getElementById('admin-pin').value = '';
      if(res.role === 'SUPER_ADMIN') {
        loadEmpresas(); 
        showView('view-superadmin');
      } else {
        currentEmpresa = res.data; 
        localStorage.setItem('kiosco_empresa', JSON.stringify(currentEmpresa)); 
        kioskEmpresa = currentEmpresa; 
        
        document.getElementById('empresa-name').innerText = `RH: ${currentEmpresa.nombre}`;
        document.getElementById('empresa-modulos-badges').innerText = `Módulos activos: ${currentEmpresa.modulos || 'TODOS'}`;
        const hoy = new Date().toISOString().split('T')[0]; 
        document.getElementById('date-start').value = hoy; 
        document.getElementById('date-end').value = hoy;
        showView('view-dashboard');
        loadEmpleados(); // Precarga sucursales y empleados
      }
    } else showToast(res.message, 'error');
  } catch(e) { showToast('Servidor inaccesible', 'error'); } 
  toggleLoader(false);
}

function logoutAdmin() { currentEmpresa = null; currentReportData = []; showView('view-menu'); }

function switchRHTab(tabId) {
  document.getElementById('tab-prenomina').classList.add('hidden'); 
  document.getElementById('tab-empleados').classList.add('hidden');
  document.getElementById('tab-btn-prenomina').classList.replace('border-blue-400', 'border-transparent'); 
  document.getElementById('tab-btn-prenomina').classList.replace('text-white', 'text-gray-400');
  document.getElementById('tab-btn-empleados').classList.replace('border-blue-400', 'border-transparent'); 
  document.getElementById('tab-btn-empleados').classList.replace('text-white', 'text-gray-400');
  
  document.getElementById('tab-' + tabId).classList.remove('hidden');
  document.getElementById('tab-btn-' + tabId).classList.replace('border-transparent', 'border-blue-400'); 
  document.getElementById('tab-btn-' + tabId).classList.replace('text-gray-400', 'text-white');
  if(tabId === 'empleados') loadEmpleados();
}

// ==========================================
// DASHBOARD RH: PRE-NÓMINA, SUCURSALES Y FOTOS
// ==========================================
function actualizarSelectoresSucursales(listaItems) {
  const sucursales = [...new Set(listaItems.map(i => i.sucursal || 'Matriz'))].sort();
  
  const selReport = document.getElementById('filter-sucursal-report');
  const selEmp = document.getElementById('filter-sucursal-emp');
  const dataList = document.getElementById('lista-sucursales');
  
  if(selReport) {
    const valActual = selReport.value;
    selReport.innerHTML = '<option value="TODAS">Todas las sucursales</option>' + sucursales.map(s => `<option value="${s}">${s}</option>`).join('');
    if(sucursales.includes(valActual)) selReport.value = valActual;
  }
  if(selEmp) {
    const valEmp = selEmp.value;
    selEmp.innerHTML = '<option value="TODAS">Todas</option>' + sucursales.map(s => `<option value="${s}">${s}</option>`).join('');
    if(sucursales.includes(valEmp)) selEmp.value = valEmp;
  }
  if(dataList) {
    dataList.innerHTML = sucursales.map(s => `<option value="${s}"></option>`).join('');
  }
}

function renderReportTable(data) {
  const tb = document.getElementById('table-body');
  const btn = document.getElementById('btn-export');
  const mostrarLFT = tieneModulo(currentEmpresa, 'LFT_PRENOMINA');
  
  if(data.length === 0) {
    tb.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-gray-500">Sin registros para los filtros seleccionados.</td></tr>'; 
  } else {
    btn.classList.remove('hidden');
    tb.innerHTML = data.map(row => {
      let recuadroFoto = '';
      if (row.foto && row.foto !== 'SIN_FOTO') {
        const fileIdMatch = row.foto.match(/[-\w]{25,}/);
        const thumbUrl = fileIdMatch ? `https://drive.google.com/thumbnail?id=${fileIdMatch[0]}&sz=w1000` : row.foto;
        recuadroFoto = `<a href="${row.foto}" target="_blank" class="inline-block"><img src="${thumbUrl}" onerror="this.outerHTML='<div class=\\'w-9 h-9 rounded-full bg-gray-300 flex items-center justify-center mx-auto text-[10px] font-bold text-gray-600\\'>Foto</div>';" class="w-9 h-9 object-cover rounded-full mx-auto border-2 border-blue-400 shadow-sm"></a>`;
      } else {
        recuadroFoto = `<div class="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center mx-auto text-gray-400"><i data-lucide="user-x" class="w-4 h-4"></i></div>`;
      }
      return `
      <tr class="border-b hover:bg-gray-50 transition-colors">
        <td class="p-2.5 font-bold">${row.empleado} <br><span class="text-[11px] text-gray-500 font-normal">PIN: ${row.pin || row.empId}</span></td>
        <td class="p-2.5"><span class="bg-gray-100 border text-gray-700 px-2 py-0.5 rounded text-xs font-semibold">${row.sucursal || 'Matriz'}</span></td>
        <td class="p-2.5">${row.fecha}</td>
        <td class="p-2.5 text-center">${recuadroFoto}</td>
        <td class="p-2.5 text-center">${row.entrada === '--' ? '<span class="bg-red-500 text-white px-2 py-0.5 rounded font-bold text-xs">FALTA</span>' : `<span class="${row.retardo ? 'text-red-600' : 'text-green-600'} font-bold">${row.entrada}</span><br><span class="font-bold text-gray-600">${row.salida}</span>`}</td>
        <td class="p-2.5 text-center">${mostrarLFT && row.dobles > 0 ? `<span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold">${row.dobles} h</span>` : '-'}</td>
        <td class="p-2.5 text-center">${mostrarLFT && row.triples > 0 ? `<span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold">${row.triples} h</span>` : '-'}</td>
        <td class="p-2.5">${row.estatusGeo === 'ALERTA_GEO' ? '<span class="bg-red-100 text-red-800 px-2 py-0.5 rounded font-bold text-xs">GPS Fuera</span>' : '<span class="text-green-600 text-xs font-semibold">OK</span>'}</td>
      </tr>`;
    }).join('');
    setTimeout(() => lucide.createIcons(), 50);
  }
}

function filterReport() {
  const query = (document.getElementById('search-report').value || '').toLowerCase();
  const suc = document.getElementById('filter-sucursal-report').value;
  
  const filtered = currentReportData.filter(r => {
    const matchText = r.empleado.toLowerCase().includes(query) || String(r.empId).toLowerCase().includes(query) || String(r.pin || '').toLowerCase().includes(query);
    const matchSuc = (suc === 'TODAS') || ((r.sucursal || 'Matriz') === suc);
    return matchText && matchSuc;
  });
  renderReportTable(filtered);
}

async function loadReports() {
  if(!currentEmpresa) return;
  const s = document.getElementById('date-start').value, e = document.getElementById('date-end').value;
  if(!s || !e) return; 
  
  toggleLoader(true, 'Calculando Pre-Nómina...');
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
  const headers = ["Empleado", "PIN", "Sucursal", "Fecha", "Entrada", "Salida", "Horas Dobles", "Horas Triples", "Alerta GPS"];
  const query = (document.getElementById('search-report').value || '').toLowerCase();
  const suc = document.getElementById('filter-sucursal-report').value;
  
  const toExport = currentReportData.filter(r => {
    const matchText = r.empleado.toLowerCase().includes(query) || String(r.empId).toLowerCase().includes(query) || String(r.pin || '').toLowerCase().includes(query);
    const matchSuc = (suc === 'TODAS') || ((r.sucursal || 'Matriz') === suc);
    return matchText && matchSuc;
  });
  
  const rows = toExport.map(row => [`"${row.empleado}"`, row.pin || '', `"${row.sucursal || 'Matriz'}"`, row.fecha, row.entrada, row.salida, row.dobles, row.triples, row.estatusGeo].join(","));
  const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Prenomina_${currentEmpresa.nombre.replace(/\s+/g, '_')}_${document.getElementById('date-start').value}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ==========================================
// DASHBOARD RH: EMPLEADOS, SUCURSALES Y BIOMETRÍA
// ==========================================
async function loadEmpleados() {
  if(!currentEmpresa) return;
  toggleLoader(true, 'Cargando plantilla...');
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
  const filtered = currentEmpleadosData.filter(e => suc === 'TODAS' || (e.sucursal || 'Matriz') === suc);
  
  document.getElementById('table-empleados').innerHTML = filtered.length ? filtered.map(e => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2.5 font-bold">${e.nombre}</td>
      <td class="p-2.5"><span class="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded text-xs font-semibold">${e.sucursal || 'Matriz'}</span></td>
      <td class="p-2.5 text-blue-600 font-bold">${e.pin}</td>
      <td class="p-2.5">${e.turno}</td>
      <td class="p-2.5 text-center">${e.mapaFacial ? `<button onclick="openEnrolarModal('${e.id}', '${e.nombre}')" class="text-green-600 font-bold text-xs hover:underline"><i data-lucide="check-circle" class="w-4 h-4 inline"></i> Enrolado (Actualizar)</button>` : `<button onclick="openEnrolarModal('${e.id}', '${e.nombre}')" class="bg-purple-100 text-purple-700 px-2.5 py-1 rounded text-xs font-bold hover:bg-purple-200">Enrolar Rostro</button>`}</td>
      <td class="p-2.5"><span class="${e.estatus==='ACTIVO'?'text-green-600':'text-red-500'} font-bold text-xs">${e.estatus}</span></td>
      <td class="p-2.5 text-right"><button onclick="toggleEstatus('${e.id}', '${e.estatus==='ACTIVO'?'INACTIVO':'ACTIVO'}')" class="bg-gray-200 hover:bg-gray-300 px-2.5 py-1 rounded font-bold text-xs">${e.estatus==='ACTIVO'?'Dar Baja':'Reactivar'}</button></td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="p-6 text-center text-gray-500">Sin empleados registrados en esta sucursal.</td></tr>';
  lucide.createIcons();
}

function abrirModalNuevoEmpleado() {
  document.getElementById('new-emp-nombre').value = '';
  document.getElementById('new-emp-pin').value = '';
  document.getElementById('new-emp-turno').value = 'T1';
  document.getElementById('new-emp-sucursal').value = '';
  document.getElementById('modal-empleado').classList.remove('hidden');
}

// GUARDADO CON CANDADO ESTRICTO ANTI-DUPLICADOS
async function saveEmpleado() {
  if (isSavingEmpleado) return; // Bloquea cualquier clic extra
  
  const payload = { 
    empresaId: currentEmpresa.empresaId, 
    nombre: document.getElementById('new-emp-nombre').value.trim(), 
    sucursal: document.getElementById('new-emp-sucursal').value.trim() || 'Matriz',
    pin: document.getElementById('new-emp-pin').value.trim(), 
    turnoId: document.getElementById('new-emp-turno').value.trim() || 'T1'
  };
  
  if(!payload.nombre || !payload.pin) return showToast('Nombre y PIN son obligatorios', 'error');
  
  isSavingEmpleado = true;
  const btn = document.getElementById('btn-save-emp');
  if(btn) btn.disabled = true;
  
  toggleLoader(true, 'Registrando empleado único...');
  try {
    const res = await runServer('apiAddEmpleado', payload);
    if(res.status === 'success') { 
      showToast(res.message); 
      document.getElementById('modal-empleado').classList.add('hidden'); 
      await loadEmpleados(); 
    } else {
      showToast(res.message, 'error');
    }
  } catch(e) {
    showToast('Error de red al guardar', 'error');
  } finally {
    isSavingEmpleado = false;
    if(btn) btn.disabled = false;
    toggleLoader(false);
  }
}

async function toggleEstatus(id, newStatus) { 
  toggleLoader(true); 
  await runServer('apiToggleEmpleado', { empleadoId: id, newStatus }); 
  toggleLoader(false); 
  loadEmpleados(); 
}

// ==========================================
// ENROLAMIENTO BIOMÉTRICO (CÁMARA Y ARCHIVO)
// ==========================================
async function openEnrolarModal(empId, nombre) {
  currentEnrolId = empId;
  enrolModo = "CAMARA";
  enrolDescriptor = null;
  
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
      enrolInterval = setInterval(async () => {
        if(enrolModo !== "CAMARA" || !faceModelsLoaded || video.videoWidth === 0) return;
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);
        
        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        
        if(detection) {
           const resizedDetections = faceapi.resizeResults(detection, displaySize);
           faceapi.draw.drawDetections(canvas, resizedDetections);
           document.getElementById('enrolar-status').innerText = "Rostro Detectado. ¡Listo para guardar!";
           document.getElementById('enrolar-status').className = 'text-xs font-bold text-green-500 mb-4';
           enrolDescriptor = detection.descriptor;
           document.getElementById('btn-guardar-rostro').disabled = false;
           document.getElementById('btn-guardar-rostro').classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
           document.getElementById('enrolar-status').innerText = "Buscando rostro...";
           document.getElementById('enrolar-status').className = 'text-xs font-bold text-blue-600 mb-4';
           enrolDescriptor = null;
           document.getElementById('btn-guardar-rostro').disabled = true;
           document.getElementById('btn-guardar-rostro').classList.add('opacity-50', 'cursor-not-allowed');
        }
      }, 300);
    };
  } catch(e) { document.getElementById('enrolar-status').innerText = "Cámara inaccesible. Sube una foto desde archivo."; }
}

async function procesarFotoArchivo(event) {
  const file = event.target.files[0];
  if(!file) return;
  
  enrolModo = "ARCHIVO";
  clearInterval(enrolInterval);
  const video = document.getElementById('enrolar-video');
  if(video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
  video.classList.add('hidden');
  
  const preview = document.getElementById('enrolar-img-preview');
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('hidden');
  
  const canvas = document.getElementById('enrolar-canvas');
  canvas.getContext('2d').clearRect(0,0, canvas.width, canvas.height);
  
  toggleLoader(true, 'Analizando rostro en fotografía...');
  try {
     const img = await faceapi.bufferToImage(file);
     const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
     
     if (detection) {
        const displaySize = { width: preview.clientWidth || 250, height: preview.clientHeight || 250 };
        faceapi.matchDimensions(canvas, displaySize);
        const resizedDetections = faceapi.resizeResults(detection, displaySize);
        faceapi.draw.drawDetections(canvas, resizedDetections);
        
        enrolDescriptor = detection.descriptor;
        document.getElementById('enrolar-status').innerText = "¡Rostro válido detectado en la foto!";
        document.getElementById('enrolar-status').className = "text-xs font-bold text-green-600 mb-4";
        document.getElementById('btn-guardar-rostro').disabled = false;
        document.getElementById('btn-guardar-rostro').classList.remove('opacity-50', 'cursor-not-allowed');
     } else {
        enrolDescriptor = null;
        document.getElementById('enrolar-status').innerText = "No se detectó rostro claro. Intenta con otra foto.";
        document.getElementById('enrolar-status').className = "text-xs font-bold text-red-500 mb-4";
        document.getElementById('btn-guardar-rostro').disabled = true;
        document.getElementById('btn-guardar-rostro').classList.add('opacity-50', 'cursor-not-allowed');
     }
  } catch(err) { showToast("Error al procesar la imagen", "error"); }
  toggleLoader(false);
}

function closeEnrolarModal() {
   document.getElementById('modal-enrolar').classList.add('hidden');
   clearInterval(enrolInterval);
   const video = document.getElementById('enrolar-video');
   if(video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
}

async function capturarYGuardarRostro() {
   if(!enrolDescriptor) return;
   toggleLoader(true, 'Guardando Mapa Biométrico...');
   const payload = { empleadoId: currentEnrolId, descriptorJson: JSON.stringify(Array.from(enrolDescriptor)) };
   try {
      const res = await runServer('apiEnrolarRostro', payload);
      if(res.status === 'success') { showToast(res.message); closeEnrolarModal(); loadEmpleados(); } 
      else showToast(res.message, 'error');
   } catch(e) { showToast('Fallo al guardar', 'error'); }
   toggleLoader(false);
}

// ==========================================
// SUPER ADMIN: EMPRESAS Y CHECKBOXES DE MÓDULOS
// ==========================================
async function loadEmpresas() {
  toggleLoader(true);
  try {
    const res = await runServer('apiGetEmpresas');
    document.getElementById('table-empresas').innerHTML = res.data.map(c => {
      const mods = String(c.modulos || '').split(',').filter(Boolean);
      const badges = mods.map(m => `<span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-[11px] font-bold mr-1">${m}</span>`).join('');
      return `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-3 font-bold text-purple-600">${c.id}</td>
        <td class="p-3 font-bold">${c.nombre}</td>
        <td class="p-3 font-mono font-bold">${c.pin}</td>
        <td class="p-3">
          <div class="flex items-center justify-between gap-2">
            <div>${badges || '<span class="text-gray-400 text-xs">Básico</span>'}</div>
            <button onclick="abrirEditarModulos('${c.id}', '${c.nombre}', '${c.modulos}')" class="bg-gray-800 text-white px-2.5 py-1 rounded text-xs font-bold hover:bg-gray-700">Configurar</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch(e){} 
  toggleLoader(false);
}

function abrirModalEmpresa() {
  document.getElementById('new-cia-nombre').value = '';
  document.getElementById('new-cia-pin').value = '';
  document.getElementById('modal-empresa').classList.remove('hidden');
}

async function saveEmpresa() {
  const seleccionados = Array.from(document.querySelectorAll('.chk-modulo:checked')).map(cb => cb.value).join(',');
  const payload = { 
    nombre: document.getElementById('new-cia-nombre').value.trim(), 
    lat: document.getElementById('new-cia-lat').value.trim(), 
    lng: document.getElementById('new-cia-lng').value.trim(), 
    radio: document.getElementById('new-cia-radio').value.trim(), 
    pin: document.getElementById('new-cia-pin').value.trim(), 
    modulos: seleccionados || 'FOTO,GPS'
  };
  if(!payload.nombre || !payload.pin) return showToast('Nombre y PIN son obligatorios', 'error');
  
  toggleLoader(true, 'Creando instancia de empresa...'); 
  const res = await runServer('apiAddEmpresa', payload); 
  toggleLoader(false);
  if(res.status === 'success') { 
    showToast(res.message); 
    document.getElementById('modal-empresa').classList.add('hidden'); 
    loadEmpresas(); 
  } else showToast(res.message, 'error');
}

function abrirEditarModulos(id, nombre, modulosActuales) {
  editingEmpresaId = id;
  document.getElementById('edit-mod-empresa-nombre').innerText = nombre;
  const activos = String(modulosActuales || '').toUpperCase().split(',').map(s => s.trim());
  document.querySelectorAll('.chk-edit-mod').forEach(cb => {
    cb.checked = activos.includes(cb.value);
  });
  document.getElementById('modal-editar-modulos').classList.remove('hidden');
}

async function guardarEdicionModulos() {
  const seleccionados = Array.from(document.querySelectorAll('.chk-edit-mod:checked')).map(cb => cb.value).join(',');
  toggleLoader(true, 'Actualizando módulos del cliente...');
  try {
    const res = await runServer('apiUpdateEmpresaModulos', { empresaId: editingEmpresaId, modulos: seleccionados });
    if(res.status === 'success') {
      showToast(res.message);
      document.getElementById('modal-editar-modulos').classList.add('hidden');
      loadEmpresas();
    } else showToast(res.message, 'error');
  } catch(e) { showToast('Error al actualizar', 'error'); }
  toggleLoader(false);
}

// ==========================================
// OPERACIÓN KIOSCO Y MODO OFFLINE
// ==========================================
function initGPS() { if(navigator.geolocation) navigator.geolocation.watchPosition( p => { currentLat = p.coords.latitude; currentLng = p.coords.longitude; }, e => {}); }

function toggleQR() {
  const qrDiv = document.getElementById('qr-reader');
  if(qrDiv.classList.contains('hidden')) {
    qrDiv.classList.remove('hidden');
    html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 220, height: 220} }, false);
    html5QrcodeScanner.render((decodedText) => {
      document.getElementById('pin-input').value = decodedText; showToast('Gafete Leído', 'success'); html5QrcodeScanner.clear(); qrDiv.classList.add('hidden');
    }, () => {});
  } else { if(html5QrcodeScanner) html5QrcodeScanner.clear(); qrDiv.classList.add('hidden'); }
}

async function registrar(tipo) {
  const pin = document.getElementById('pin-input').value;
  if(!pin) return showToast('Falta ingresar tu PIN', 'error');
  
  const video = document.getElementById('live-video');
  const canvas = document.getElementById('capture-canvas');
  
  if (tieneModulo(kioskEmpresa, 'FOTO')) {
    if (!videoStream || video.videoWidth === 0) return showToast('Cámara inactiva', 'error');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const flash = document.getElementById('flash-overlay');
    if(flash) { flash.classList.replace('opacity-0', 'opacity-100'); setTimeout(() => flash.classList.replace('opacity-100', 'opacity-0'), 150); }
    base64Photo = canvas.toDataURL('image/jpeg', 0.7);
  } else {
    base64Photo = null;
  }
  
  const fechaActual = new Date();
  const payload = { pin: pin, tipo: tipo, lat: currentLat, lng: currentLng, fotoBase64: base64Photo, isOffline: !navigator.onLine, offlineDate: fechaActual.toLocaleDateString('en-CA'), offlineTime: fechaActual.toLocaleTimeString('en-GB') };

  if(!navigator.onLine) return guardarLocalmente(payload);

  toggleLoader(true, 'Enviando asistencia...');
  try {
    const res = await runServer('apiProcessCheckIn', payload);
    if(res.status === 'success') { showToast(res.message); resetKiosk(); } else showToast(res.message, 'error');
  } catch (e) { guardarLocalmente(payload); } 
  toggleLoader(false);
}

function guardarLocalmente(payload) {
  let offlineData = JSON.parse(localStorage.getItem('offline_registros') || '[]');
  offlineData.push(payload); localStorage.setItem('offline_registros', JSON.stringify(offlineData));
  showToast('Guardado Local (Modo Offline)', 'success'); resetKiosk(); updateOfflineUI();
}

function updateOfflineUI() {
  let offlineData = JSON.parse(localStorage.getItem('offline_registros') || '[]');
  const banner = document.getElementById('offline-banner');
  if(offlineData.length > 0) { document.getElementById('offline-count').innerText = offlineData.length; banner.classList.remove('hidden'); banner.classList.add('flex'); } 
  else { banner.classList.add('hidden'); banner.classList.remove('flex'); }
}

async function syncOffline() {
  if(!navigator.onLine) return showToast('Sin conexión WiFi/Datos', 'error');
  let offlineData = JSON.parse(localStorage.getItem('offline_registros') || '[]');
  if(offlineData.length === 0) return;
  toggleLoader(true, `Vaciando ${offlineData.length} registros...`);
  try {
    const res = await runServer('apiSyncOffline', offlineData);
    if(res.status === 'success') { localStorage.removeItem('offline_registros'); showToast(res.message); updateOfflineUI(); } else showToast(res.message, 'error');
  } catch(e) { showToast('Fallo Servidor de Google', 'error'); } 
  toggleLoader(false);
}

function resetKiosk() {
  document.getElementById('pin-input').value = ''; base64Photo = null;
  if(html5QrcodeScanner) { html5QrcodeScanner.clear(); document.getElementById('qr-reader').classList.add('hidden'); }
}
