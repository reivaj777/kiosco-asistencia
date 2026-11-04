// TU URL MAESTRA DE APPS SCRIPT
const API_URL = "https://script.google.com/macros/s/AKfycbwc5kuAuMLBvhdFk-IWgs5s7Ly231_yDHONGR4psLMzveBPnBJqW1_z8mwveES7GaoQtg/exec";

// Inicializar Service Worker para PWA (Modo Offline Nativo)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => console.log("SW Registro falló:", err));
  });
}

lucide.createIcons();
let currentEmpresa = null, currentReportData = [];
let currentLat = null, currentLng = null, base64Photo = null;
let html5QrcodeScanner = null;

// MOTOR FETCH DE ALTO RENDIMIENTO (CORS Bypass)
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

// UI UTILS
function showView(viewId) {
  ['view-menu', 'view-admin', 'view-kiosk', 'view-dashboard', 'view-superadmin'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById(viewId).classList.remove('hidden');
  if(viewId === 'view-kiosk') { initGPS(); updateOfflineUI(); }
}
function toggleLoader(s, t='Procesando...') { const l=document.getElementById('loader'); document.getElementById('loader-text').innerText=t; s?(l.classList.remove('hidden'),l.classList.add('flex')):(l.classList.add('hidden'),l.classList.remove('flex')); }
function showToast(m, t='success') { const c=document.getElementById('toast-container'),d=document.createElement('div'); d.className=`toast ${t==='success'?'bg-green-600':'bg-red-600'} text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 mb-2`; d.innerHTML=`<i data-lucide="${t==='success'?'check-circle':'alert-circle'}"></i> ${m}`; c.appendChild(d); lucide.createIcons(); setTimeout(()=>{d.style.opacity='0';setTimeout(()=>d.remove(),300);},4000); }

// ADMIN & TABS
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
        currentEmpresa = res.data; document.getElementById('empresa-name').innerText = `RH: ${currentEmpresa.nombre}`;
        const hoy = new Date().toISOString().split('T')[0]; document.getElementById('date-start').value = hoy; document.getElementById('date-end').value = hoy;
        showView('view-dashboard');
      }
    } else showToast(res.message, 'error');
  } catch(e) { showToast('Servidor inaccesible', 'error'); } toggleLoader(false);
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

// RH: PRE-NÓMINA Y CSV
async function loadReports() {
  if(!currentEmpresa) return;
  const s = document.getElementById('date-start').value, e = document.getElementById('date-end').value;
  if(!s || !e) return; toggleLoader(true, 'Aplicando Ley LFT...');
  try {
    const res = await runServer('apiGetReports', { empresaId: currentEmpresa.empresaId, fechaInicio: s, fechaFin: e });
    const tb = document.getElementById('table-body'), btn = document.getElementById('btn-export');
    if(res.data.length === 0) {
      currentReportData = []; tb.innerHTML = '<tr><td colspan="6" class="p-4 text-center">Sin registros.</td></tr>'; btn.classList.add('hidden');
    } else {
      currentReportData = res.data; btn.classList.remove('hidden');
      tb.innerHTML = res.data.map(row => `
        <tr class="border-b">
          <td class="p-3 font-bold">${row.empleado}</td><td class="p-3 text-sm">${row.fecha}</td>
          <td class="p-3 text-center"><span class="${row.retardo?'text-red-600':'text-green-600'} font-bold">${row.entrada}</span><br><span class="font-bold">${row.salida}</span></td>
          <td class="p-3 text-center">${row.dobles > 0 ? `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded font-bold">${row.dobles} h</span>` : '-'}</td>
          <td class="p-3 text-center">${row.triples > 0 ? `<span class="bg-purple-100 text-purple-800 px-2 py-1 rounded font-bold">${row.triples} h</span>` : '-'}</td>
          <td class="p-3">${row.estatusGeo === 'ALERTA_GEO' ? '<span class="bg-red-100 text-red-800 px-2 rounded font-bold text-xs">GPS Fuera</span>' : ''}</td>
        </tr>
      `).join('');
    }
  } catch(er) { showToast('Error al generar', 'error'); } toggleLoader(false);
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

// API CALLS: EMPLEADOS & EMPRESAS
async function loadEmpleados() {
  toggleLoader(true);
  try {
    const res = await runServer('apiGetEmpleados', currentEmpresa.empresaId);
    document.getElementById('table-empleados').innerHTML = res.data.length ? res.data.map(e => `
      <tr class="border-b"><td class="p-3 font-bold">${e.nombre}</td><td class="p-3 text-blue-600 font-bold">${e.pin}</td><td class="p-3">${e.turno}</td><td class="p-3">${e.estatus}</td>
      <td class="p-3"><button onclick="toggleEstatus('${e.id}', '${e.estatus==='ACTIVO'?'INACTIVO':'ACTIVO'}')" class="bg-gray-200 px-2 py-1 rounded font-bold">${e.estatus==='ACTIVO'?'Baja':'Alta'}</button></td></tr>
    `).join('') : '<tr><td colspan="5" class="p-4 text-center">Sin empleados.</td></tr>';
  } catch(e){} toggleLoader(false);
}
async function saveEmpleado() {
  const payload = { empresaId: currentEmpresa.empresaId, nombre: document.getElementById('new-emp-nombre').value, pin: document.getElementById('new-emp-pin').value, turnoId: document.getElementById('new-emp-turno').value };
  if(!payload.nombre || !payload.pin) return showToast('Completa los datos', 'error');
  toggleLoader(true); const res = await runServer('apiAddEmpleado', payload); toggleLoader(false);
  if(res.status==='success') { showToast(res.message); document.getElementById('modal-empleado').classList.add('hidden'); loadEmpleados(); } else showToast(res.message, 'error');
}
async function toggleEstatus(id, newStatus) { toggleLoader(true); await runServer('apiToggleEmpleado', { empleadoId: id, newStatus }); toggleLoader(false); loadEmpleados(); }

async function loadEmpresas() {
  toggleLoader(true);
  try {
    const res = await runServer('apiGetEmpresas');
    document.getElementById('table-empresas').innerHTML = res.data.map(c => `
      <tr class="border-b"><td class="p-3 font-bold text-purple-600">${c.id}</td><td class="p-3 font-bold">${c.nombre}</td><td class="p-3">${c.pin}</td><td class="p-3 text-xs">${c.modulos}</td></tr>
    `).join('');
  } catch(e){} toggleLoader(false);
}
async function saveEmpresa() {
  const payload = { nombre: document.getElementById('new-cia-nombre').value, lat: document.getElementById('new-cia-lat').value, lng: document.getElementById('new-cia-lng').value, radio: document.getElementById('new-cia-radio').value, pin: document.getElementById('new-cia-pin').value, modulos: document.getElementById('new-cia-modulos').value };
  if(!payload.nombre || !payload.pin) return showToast('Obligatorio', 'error');
  toggleLoader(true); const res = await runServer('apiAddEmpresa', payload); toggleLoader(false);
  if(res.status==='success') { showToast(res.message); document.getElementById('modal-empresa').classList.add('hidden'); loadEmpresas(); } else showToast(res.message, 'error');
}

// KIOSCO (GPS, CÁMARA, QR, OFFLINE)
function initGPS() { if(navigator.geolocation) navigator.geolocation.watchPosition(p=>{currentLat=p.coords.latitude;currentLng=p.coords.longitude;},e=>{}); }
function toggleQR() {
  const qrDiv = document.getElementById('qr-reader');
  if(qrDiv.classList.contains('hidden')) {
    qrDiv.classList.remove('hidden');
    html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
    html5QrcodeScanner.render((decodedText) => {
      document.getElementById('pin-input').value = decodedText; showToast('Gafete Leído', 'success');
      html5QrcodeScanner.clear(); qrDiv.classList.add('hidden');
    }, (error) => {});
  } else { if(html5QrcodeScanner) html5QrcodeScanner.clear(); qrDiv.classList.add('hidden'); }
}

document.getElementById('camera-input').addEventListener('change', function(e) {
  if(!e.target.files[0]) return; const r = new FileReader();
  r.onload = ev => {
    const img = new Image(); img.onload = () => {
      const c = document.getElementById('photo-canvas'); c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0); base64Photo = c.toDataURL('image/jpeg', 0.7);
      c.classList.remove('hidden'); document.getElementById('camera-placeholder').classList.add('hidden');
    }; img.src = ev.target.result;
  }; r.readAsDataURL(e.target.files[0]);
});

async function registrar(tipo) {
  const pin = document.getElementById('pin-input').value;
  if(!base64Photo || !pin) return showToast('Falta foto o PIN', 'error');
  
  const fechaActual = new Date();
  const payload = { 
    pin: pin, tipo: tipo, lat: currentLat, lng: currentLng, fotoBase64: base64Photo,
    isOffline: !navigator.onLine,
    offlineDate: fechaActual.toLocaleDateString('en-CA'),
    offlineTime: fechaActual.toLocaleTimeString('en-GB')
  };

  if(!navigator.onLine) return guardarLocalmente(payload);

  toggleLoader(true, 'Sincronizando con Google...');
  try {
    const res = await runServer('apiProcessCheckIn', payload);
    if(res.status === 'success') { showToast(res.message); resetKiosk(); } else showToast(res.message, 'error');
  } catch (e) { guardarLocalmente(payload); } toggleLoader(false);
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
    if(res.status === 'success') { localStorage.removeItem('offline_registros'); showToast(res.message); updateOfflineUI(); }
  } catch(e) { showToast('Fallo Servidor', 'error'); } toggleLoader(false);
}

function resetKiosk() {
  document.getElementById('pin-input').value=''; base64Photo=null;
  document.getElementById('photo-canvas').classList.add('hidden'); 
  document.getElementById('camera-placeholder').classList.remove('hidden'); document.getElementById('camera-input').value='';
  if(html5QrcodeScanner) { html5QrcodeScanner.clear(); document.getElementById('qr-reader').classList.add('hidden'); }
}

// Bootstrap
window.onload = () => { updateOfflineUI(); runServer('apiInitDatabase', {}).catch(e=>console.log("Offline mode activado")); };
