const API_URL = "https://script.google.com/macros/s/AKfycbwc5kuAuMLBvhdFk-IWgs5s7Ly231_yDHONGR4psLMzveBPnBJqW1_z8mwveES7GaoQtg/exec";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => console.log("SW Registro falló:", err));
  });
}

lucide.createIcons();
let currentEmpresa = null;
let currentReportData = [];
let currentLat = null, currentLng = null, base64Photo = null;
let html5QrcodeScanner = null, videoStream = null;

async function runServer(actionName, payloadData) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: actionName, payload: payloadData })
    });
    return await response.json();
  } catch (error) {
    throw new Error("Sin red externa");
  }
}

function showView(viewId) {
  ['view-menu', 'view-admin', 'view-kiosk', 'view-dashboard', 'view-superadmin'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById(viewId).classList.remove('hidden');
  
  if(viewId === 'view-kiosk') { 
    initGPS(); 
    updateOfflineUI(); 
    startCamera(); 
  } else {
    stopCamera(); 
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
  d.className = `toast ${t==='success'?'bg-green-600':'bg-red-600'} text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 mb-2 z-50`; 
  d.innerHTML = `<i data-lucide="${t==='success'?'check-circle':'alert-circle'}"></i> ${m}`; 
  c.appendChild(d); 
  lucide.createIcons(); 
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 300); }, 4000); 
}

// CÁMARA (Compatible iOS / Android)
async function startCamera() {
  const video = document.getElementById('live-video');
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: "user" }, 
      audio: false 
    });
    video.srcObject = videoStream;
    video.onloadedmetadata = () => { video.play(); };
  } catch (err) {
    showToast("Permiso de cámara denegado", "error");
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
}

// ADMIN AUTH
async function loginAdmin() {
  const pin = document.getElementById('admin-pin').value;
  if(!pin) return showToast('Ingresa PIN', 'error');
  
  toggleLoader(true, 'Conectando con Google...');
  try {
    const res = await runServer('apiAdminLogin', pin);
    if(res.status === 'success') {
      document.getElementById('admin-pin').value = '';
      if(res.role === 'SUPER_ADMIN') {
        loadEmpresas(); showView('view-superadmin');
      } else {
        currentEmpresa = res.data; 
        document.getElementById('empresa-name').innerText = `RH: ${currentEmpresa.nombre}`;
        const hoy = new Date().toISOString().split('T')[0]; 
        document.getElementById('date-start').value = hoy; 
        document.getElementById('date-end').value = hoy;
        showView('view-dashboard');
      }
    } else showToast(res.message, 'error');
  } catch(e) { showToast('Servidor inaccesible', 'error'); } 
  toggleLoader(false);
}

function logoutAdmin() { currentEmpresa = null; currentReportData = []; showView('view-menu'); }

function switchRHTab(tabId) {
  document.getElementById('tab-prenomina').classList.add('hidden'); document.getElementById('tab-empleados').classList.add('hidden');
  document.getElementById('tab-btn-prenomina').classList.replace('border-blue-400', 'border-transparent'); document.getElementById('tab-btn-prenomina').classList.replace('text-white', 'text-gray-400');
  document.getElementById('tab-btn-empleados').classList.replace('border-blue-400', 'border-transparent'); document.getElementById('tab-btn-empleados').classList.replace('text-white', 'text-gray-400');
  
  document.getElementById('tab-' + tabId).classList.remove('hidden');
  document.getElementById('tab-btn-' + tabId).classList.replace('border-transparent', 'border-blue-400'); document.getElementById('tab-btn-' + tabId).classList.replace('text-gray-400', 'text-white');
  
  if(tabId === 'empleados') loadEmpleados();
}

// DASHBOARD PRE-NÓMINA (Con Thumbnails de Evidencia)
async function loadReports() {
  if(!currentEmpresa) return;
  const s = document.getElementById('date-start').value, e = document.getElementById('date-end').value;
  if(!s || !e) return; 
  
  toggleLoader(true, 'Aplicando Ley LFT...');
  try {
    const res = await runServer('apiGetReports', { empresaId: currentEmpresa.empresaId, fechaInicio: s, fechaFin: e });
    const tb = document.getElementById('table-body');
    const btn = document.getElementById('btn-export');
    
    if(res.data.length === 0) {
      currentReportData = []; 
      tb.innerHTML = '<tr><td colspan="7" class="p-4 text-center">Sin registros en este periodo.</td></tr>'; 
      btn.classList.add('hidden');
    } else {
      currentReportData = res.data; 
      btn.classList.remove('hidden');
      
      tb.innerHTML = res.data.map(row => {
        let recuadroFoto = '';
        if (row.foto && row.foto !== 'SIN_FOTO') {
          // Extraemos el ID del archivo
          const fileIdMatch = row.foto.match(/[-\w]{25,}/);
          
          // SOLUCIÓN: Usamos la API de Thumbnails de Google (sz=w150 hace la imagen ligera y rápida)
          const thumbUrl = fileIdMatch ? `https://drive.google.com/thumbnail?id=${fileIdMatch[0]}&sz=w150` : row.foto;
          
          recuadroFoto = `
            <a href="${row.foto}" target="_blank" class="inline-block">
              <img src="${thumbUrl}" 
                   onerror="this.onerror=null; this.outerHTML='<div class=\\'w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center mx-auto text-xs font-bold text-gray-600\\'>Foto</div>';"
                   class="w-10 h-10 object-cover rounded-full mx-auto border-2 border-blue-400 hover:scale-110 transition-transform shadow-sm" 
                   title="Clic para ampliar">
            </a>`;
        } else {
          recuadroFoto = `<div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center mx-auto text-gray-400" title="Sin Evidencia"><i data-lucide="user-x" class="w-5 h-5"></i></div>`;
        }

        return `
        <tr class="border-b hover:bg-gray-50 transition-colors">
          <td class="p-3 font-bold">${row.empleado}</td>
          <td class="p-3 text-sm">${row.fecha}</td>
          <td class="p-3 text-center">${recuadroFoto}</td>
          <td class="p-3 text-center">
            ${row.entrada === '--' ? 
              '<span class="bg-red-500 text-white px-2 py-1 rounded font-bold text-xs">FALTA</span>' : 
              `<span class="${row.retardo ? 'text-red-600' : 'text-green-600'} font-bold">${row.entrada}</span><br><span class="font-bold text-gray-600">${row.salida}</span>`
            }
          </td>
          <td class="p-3 text-center">${row.dobles > 0 ? `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded font-bold">${row.dobles} h</span>` : '-'}</td>
          <td class="p-3 text-center">${row.triples > 0 ? `<span class="bg-purple-100 text-purple-800 px-2 py-1 rounded font-bold">${row.triples} h</span>` : '-'}</td>
          <td class="p-3">${row.estatusGeo === 'ALERTA_GEO' ? '<span class="bg-red-100 text-red-800 px-2 rounded font-bold text-xs">GPS Fuera</span>' : ''}</td>
        </tr>
        `;
      }).join('');
      
      setTimeout(() => lucide.createIcons(), 50);
    }
  } catch(er) { showToast('Error al generar reporte', 'error'); } 
  toggleLoader(false);
}

function exportToCSV() {
  if (currentReportData.length === 0) return;
  const headers = ["Empleado", "Fecha", "Entrada", "Salida", "Horas Dobles", "Horas Triples", "Alerta GPS"];
  const rows = currentReportData.map(row => [`"${row.empleado}"`, row.fecha, row.entrada, row.salida, row.dobles, row.triples, row.estatusGeo].join(","));
  const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Prenomina_${currentEmpresa.nombre.replace(/\s+/g, '_')}_${document.getElementById('date-start').value}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// EMPLEADOS Y EMPRESAS
async function loadEmpleados() {
  toggleLoader(true);
  try {
    const res = await runServer('apiGetEmpleados', currentEmpresa.empresaId);
    document.getElementById('table-empleados').innerHTML = res.data.length ? res.data.map(e => `
      <tr class="border-b">
        <td class="p-3 font-bold">${e.nombre}</td>
        <td class="p-3 text-blue-600 font-bold">${e.pin}</td>
        <td class="p-3">${e.turno}</td><td class="p-3">${e.estatus}</td>
        <td class="p-3"><button onclick="toggleEstatus('${e.id}', '${e.estatus==='ACTIVO'?'INACTIVO':'ACTIVO'}')" class="bg-gray-200 px-2 py-1 rounded font-bold">${e.estatus==='ACTIVO'?'Baja':'Alta'}</button></td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="p-4 text-center">Sin empleados registrados.</td></tr>';
  } catch(e) {} 
  toggleLoader(false);
}

async function saveEmpleado() {
  const payload = { empresaId: currentEmpresa.empresaId, nombre: document.getElementById('new-emp-nombre').value, pin: document.getElementById('new-emp-pin').value, turnoId: document.getElementById('new-emp-turno').value };
  if(!payload.nombre || !payload.pin) return showToast('Completa los datos', 'error');
  toggleLoader(true); const res = await runServer('apiAddEmpleado', payload); toggleLoader(false);
  if(res.status === 'success') { showToast(res.message); document.getElementById('modal-empleado').classList.add('hidden'); loadEmpleados(); } else showToast(res.message, 'error');
}

async function toggleEstatus(id, newStatus) { toggleLoader(true); await runServer('apiToggleEmpleado', { empleadoId: id, newStatus }); toggleLoader(false); loadEmpleados(); }

async function loadEmpresas() {
  toggleLoader(true);
  try {
    const res = await runServer('apiGetEmpresas');
    document.getElementById('table-empresas').innerHTML = res.data.map(c => `
      <tr class="border-b"><td class="p-3 font-bold text-purple-600">${c.id}</td><td class="p-3 font-bold">${c.nombre}</td><td class="p-3">${c.pin}</td><td class="p-3 text-xs">${c.modulos}</td></tr>
    `).join('');
  } catch(e){} 
  toggleLoader(false);
}

async function saveEmpresa() {
  const payload = { nombre: document.getElementById('new-cia-nombre').value, lat: document.getElementById('new-cia-lat').value, lng: document.getElementById('new-cia-lng').value, radio: document.getElementById('new-cia-radio').value, pin: document.getElementById('new-cia-pin').value, modulos: document.getElementById('new-cia-modulos').value };
  if(!payload.nombre || !payload.pin) return showToast('Obligatorio', 'error');
  toggleLoader(true); const res = await runServer('apiAddEmpresa', payload); toggleLoader(false);
  if(res.status === 'success') { showToast(res.message); document.getElementById('modal-empresa').classList.add('hidden'); loadEmpresas(); } else showToast(res.message, 'error');
}

// KIOSCO OFFLINE
function initGPS() { if(navigator.geolocation) navigator.geolocation.watchPosition( p => { currentLat = p.coords.latitude; currentLng = p.coords.longitude; }, e => {}); }

function toggleQR() {
  const qrDiv = document.getElementById('qr-reader');
  if(qrDiv.classList.contains('hidden')) {
    qrDiv.classList.remove('hidden');
    html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    html5QrcodeScanner.render((decodedText) => {
      document.getElementById('pin-input').value = decodedText; showToast('Gafete Leído', 'success'); html5QrcodeScanner.clear(); qrDiv.classList.add('hidden');
    }, (error) => {});
  } else { if(html5QrcodeScanner) html5QrcodeScanner.clear(); qrDiv.classList.add('hidden'); }
}

async function registrar(tipo) {
  const pin = document.getElementById('pin-input').value;
  if(!pin) return showToast('Falta ingresar tu PIN', 'error');
  
  const video = document.getElementById('live-video');
  const canvas = document.getElementById('capture-canvas');
  if (!videoStream || video.videoWidth === 0) return showToast('Cámara inactiva', 'error');
  
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  
  const flash = document.getElementById('flash-overlay');
  if(flash) { flash.classList.replace('opacity-0', 'opacity-100'); setTimeout(() => flash.classList.replace('opacity-100', 'opacity-0'), 150); }
  
  base64Photo = canvas.toDataURL('image/jpeg', 0.7);
  
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
  showToast('Guardado Local (Sin red externa)', 'success');
  resetKiosk(); updateOfflineUI();
}

function updateOfflineUI() {
  let offlineData = JSON.parse(localStorage.getItem('offline_registros') || '[]');
  const banner = document.getElementById('offline-banner');
  if(offlineData.length > 0) {
    document.getElementById('offline-count').innerText = offlineData.length;
    banner.classList.remove('hidden'); banner.classList.add('flex');
  } else { banner.classList.add('hidden'); banner.classList.remove('flex'); }
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

window.onload = () => { updateOfflineUI(); runServer('apiInitDatabase', {}).catch(e => console.log("Modo offline activado desde inicio")); };
