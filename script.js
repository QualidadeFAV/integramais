// --- CONFIGURAÇÃO DA API (GOOGLE SHEETS) ---
// IMPORTANTE: Verifique se esta URL é a da sua implantação mais recente
const API_URL = "https://script.google.com/macros/s/AKfycbw5FgjU_NeBebC82cyMXb8-sYiyql5P9iw5ujdbQTnu7w0hMNCqTFwxPocIPh2bQVg/exec";

// --- DADOS GLOBAIS ---
let appointments = {}; 
let validTokensMap = {}; 

// --- CACHE DE PERFORMANCE ---
const DASH_CACHE = {}; 
// Estrutura: { "2026-02": { total: 100, occupied: 50, loaded: true, counts: {...} } }

// CONFIGURAÇÃO DA DATA INICIAL (HOJE)
const todayDate = new Date();
const yInit = todayDate.getFullYear();
const mInit = String(todayDate.getMonth() + 1).padStart(2, '0');
const dInit = String(todayDate.getDate()).padStart(2, '0');
let selectedDateKey = `${yInit}-${mInit}-${dInit}`; 

let currentView = 'booking';
let currentSlotId = null;
let currentDateKey = null;

// --- CONTROLE DE SESSÃO ---
let currentUserToken = null;
let currentUserRole = null;
let pendingAction = null;

// --- CONSTANTES DE CONTRATOS ---
const CONTRACTS = {
    LOCALS: ["ESTADO", "SERRA", "SALGUEIRO"],
    MUNICIPAL: ["RECIFE", "JABOATÃO"]
};

// --- INDICADOR DE CARREGAMENTO (CURSOR) ---
function setLoading(isLoading) {
    const body = document.body;
    body.style.cursor = isLoading ? 'wait' : 'default';
}

// --- NOTIFICAÇÃO TOAST (CONFIRMAÇÃO VISUAL) ---
function showToast(message, type = 'success') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: #1e293b; color: white; padding: 12px 24px; border-radius: 50px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-weight: 600; font-size: 0.9rem;
            z-index: 5000; opacity: 0; transition: opacity 0.3s, top 0.3s; pointer-events: none;
            display: flex; align-items: center; gap: 8px;
        `;
        document.body.appendChild(toast);
    }
    const bg = type === 'success' ? '#059669' : (type === 'error' ? '#dc2626' : '#1e293b');
    toast.style.background = bg;
    
    const icon = type === 'success' 
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        : '';

    toast.innerHTML = `${icon} ${message}`;
    toast.style.top = '20px';
    toast.style.opacity = '1';

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.top = '0px';
    }, 3000);
}

// --- FUNÇÃO DE ANIMAÇÃO (NUMBERS GO UP) ---
function animateMetric(elementId, targetValue, isPercentage = false) {
    const element = document.getElementById(elementId);
    if (!element) return;

    let startValue = 0;
    const currentText = element.innerText;
    
    if (currentText !== '--' && currentText !== '--%') {
        startValue = parseFloat(currentText.replace('%', '').replace('(', '').replace(')', ''));
        if (isNaN(startValue)) startValue = 0;
    }

    if (startValue === targetValue) {
        element.innerText = isPercentage ? targetValue.toFixed(1) + '%' : targetValue;
        return;
    }

    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 4); 

        const current = startValue + (targetValue - startValue) * ease;

        if (isPercentage) {
            element.innerText = current.toFixed(1) + '%';
        } else {
            element.innerText = Math.floor(current);
        }

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.innerText = isPercentage ? targetValue.toFixed(1) + '%' : targetValue;
        }
    }

    requestAnimationFrame(update);
}

// --- FUNÇÃO AUXILIAR PARA SUB-ESTATÍSTICAS ---
function animateSubMetric(elementId, val, groupTotal) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const pct = groupTotal > 0 ? (val / groupTotal) * 100 : 0;
    const finalText = `${pct.toFixed(1)}% (${val})`;
    
    element.innerText = finalText;
}

// --- LÓGICA DE PRÉ-PROCESSAMENTO DO CACHE ---
function recalculateMonthCache(monthKey) {
    if (!monthKey) return;

    let totalSlots = 0;
    let occupiedSlots = 0;

    let counts = {
        Regulado: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Interno: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
        Municipal: { Total: 0, RECIFE: 0, JABOATÃO: 0 }
    };

    Object.keys(appointments).forEach(dateKey => {
        if (dateKey.startsWith(monthKey)) {
            const daySlots = appointments[dateKey];
            totalSlots += daySlots.length;

            daySlots.forEach(s => {
                if (s.status === 'OCUPADO') {
                    occupiedSlots++;
                    
                    const c = s.contract ? s.contract.toUpperCase() : null;
                    if (!c) return;

                    if (CONTRACTS.MUNICIPAL.includes(c)) {
                        counts.Municipal.Total++;
                        if (counts.Municipal[c] !== undefined) counts.Municipal[c]++;
                    } else if (CONTRACTS.LOCALS.includes(c)) {
                        let isReg = (s.regulated === true || s.regulated === "TRUE" || s.regulated === "YES");
                        if (isReg) {
                            counts.Regulado.Total++;
                            if (counts.Regulado[c] !== undefined) counts.Regulado[c]++;
                        } else {
                            counts.Interno.Total++;
                            if (counts.Interno[c] !== undefined) counts.Interno[c]++;
                        }
                    }
                }
            });
        }
    });

    if(!DASH_CACHE[monthKey]) DASH_CACHE[monthKey] = {};
    
    DASH_CACHE[monthKey].total = totalSlots;
    DASH_CACHE[monthKey].occupied = occupiedSlots;
    DASH_CACHE[monthKey].counts = counts;
}

// --- COMUNICAÇÃO COM O BACKEND (GOOGLE SHEETS) ---

// 1. CARREGAR TOKENS VÁLIDOS
async function fetchValidTokens() {
    try {
        const response = await fetch(`${API_URL}?type=tokens`, { redirect: "follow" });
        const data = await response.json();
        if (data.error) {
            console.error("Erro tokens:", data.error);
        } else {
            validTokensMap = data;
        }
    } catch (error) {
        console.error("Falha tokens:", error);
    }
}

// 2. PROCESSAMENTO DE DADOS (RAW -> APP)
function processRawData(rows, forceDateKey = null) {
    if ((!rows || rows.length === 0) && forceDateKey) {
        if (!appointments[forceDateKey]) appointments[forceDateKey] = [];
        return;
    }

    rows.forEach(row => {
        const key = row.date; 
        if (!key) return;

        if (!appointments[key]) appointments[key] = [];
        
        const exists = appointments[key].find(s => String(s.id) === String(row.id));
        
        if (!exists) {
            appointments[key].push({
                id: row.id,
                date: row.date,
                time: row.time,
                room: row.room,
                location: row.location,
                doctor: row.doctor,
                specialty: row.specialty,
                status: row.status,
                patient: row.patient,
                record: row.record,
                contract: row.contract,
                regulated: (row.regulated === true || row.regulated === "TRUE" || row.regulated === "YES"),
                procedure: row.procedure,
                detail: row.detail,
                eye: row.eye,
                createdBy: row.created_by
            });
        } else {
            const idx = appointments[key].findIndex(s => String(s.id) === String(row.id));
            if(idx !== -1) {
                appointments[key][idx] = {
                    ...appointments[key][idx],
                    status: row.status,
                    patient: row.patient,
                    record: row.record,
                    contract: row.contract,
                    regulated: (row.regulated === true || row.regulated === "TRUE" || row.regulated === "YES"),
                    procedure: row.procedure,
                    detail: row.detail,
                    eye: row.eye,
                    createdBy: row.created_by
                };
            }
        }
    });

    if (forceDateKey) {
        recalculateMonthCache(forceDateKey.substring(0, 7));
    } else if (rows.length > 0) {
        recalculateMonthCache(rows[0].date.substring(0, 7));
    }
}

// 3. BUSCAR DADOS DE UM DIA ESPECÍFICO (FALLBACK)
async function fetchRemoteData(dateKey, isBackground = false) {
    if (API_URL.includes("SUA_URL")) { alert("Configure a API_URL!"); return; }
    if (!isBackground) setLoading(true);

    try {
        const response = await fetch(`${API_URL}?date=${dateKey}`, { redirect: "follow" });
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        if(data.length === 0) appointments[dateKey] = [];
        
        processRawData(data, dateKey);

        if (dateKey === selectedDateKey) {
            renderSlotsList();
            if (currentView === 'admin') renderAdminTable();
        }
        updateKPIs();

    } catch (error) {
        console.error(`Erro fetch (${dateKey}):`, error);
        if (!isBackground) showToast('Erro de conexão.', 'error');
    } finally {
        if (!isBackground) setLoading(false);
    }
}

// 4. SINCRONIZAR MÊS INTEIRO
async function syncMonthData(baseDateKey) {
    if(!baseDateKey) return;
    
    const parts = baseDateKey.split('-');
    const monthKey = `${parts[0]}-${parts[1]}`; 
    
    if (DASH_CACHE[monthKey] && DASH_CACHE[monthKey].loaded) {
        console.log("Mês já carregado (Cache).");
        return; 
    }

    setLoading(true);
    console.log(`Buscando mês inteiro: ${monthKey}`);

    try {
        const response = await fetch(`${API_URL}?month=${monthKey}`, { redirect: "follow" });
        const data = await response.json();
        
        if (data.error) throw new Error(data.error);

        Object.keys(appointments).forEach(k => {
            if(k.startsWith(monthKey)) delete appointments[k];
        });

        processRawData(data);
        
        if(!DASH_CACHE[monthKey]) recalculateMonthCache(monthKey);
        DASH_CACHE[monthKey].loaded = true;

        // Atualiza a tela assim que os dados chegarem
        if (selectedDateKey.startsWith(monthKey)) {
            renderSlotsList();
            if (currentView === 'admin') renderAdminTable();
            updateKPIs();
        }

    } catch (e) {
        console.error("Erro syncMonth:", e);
        showToast("Erro ao sincronizar mês.", "error");
    } finally {
        setLoading(false);
    }
}

// 5. ENVIAR DADOS (POST)
async function sendUpdateToSheet(payload) {
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            redirect: "follow",
            body: JSON.stringify(payload),
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });

        const result = await response.json();

        if (result.status === 'success') {
            return true;
        } else {
            throw new Error(result.message || "Erro no servidor.");
        }

    } catch (error) {
        console.error("Erro no envio:", error);
        return false;
    }
}

// --- SISTEMA DE LOGIN ---

function attemptLogin() {
    const input = document.getElementById('login-token');
    const val = input.value.trim();
    const err = document.getElementById('login-error');

    if (validTokensMap.hasOwnProperty(val)) {
        currentUserToken = val;
        const userData = validTokensMap[val];
        currentUserRole = userData.role || 'USER';

        input.style.borderColor = '#16a34a';
        input.style.color = '#16a34a';

        setTimeout(() => {
            closeLoginModal();
            if (pendingAction) {
                const action = pendingAction;
                pendingAction = null;
                action();
            }
        }, 400);
    } else {
        currentUserToken = null;
        currentUserRole = null;
        err.style.display = 'block';
        input.style.borderColor = '#dc2626';
        input.style.color = '#dc2626';
        input.focus();
        
        const card = document.querySelector('#login-modal .modal-card');
        card.style.animation = 'none';
        card.offsetHeight; 
        card.style.animation = 'shake 0.4s cubic-bezier(.36,.07,.19,.97) both';
    }
}

function handleLoginKey(e) { if (e.key === 'Enter') attemptLogin(); }

function requestToken(callback, customTitle = null) {
    pendingAction = callback;
    const modal = document.getElementById('login-modal');
    const input = document.getElementById('login-token');
    modal.querySelector('h2').innerText = customTitle || "Acesso Restrito";
    input.value = '';
    document.getElementById('login-error').style.display = 'none';
    input.style.borderColor = '';
    input.style.color = '';
    modal.style.display = 'flex';
    input.focus();
}

function closeLoginModal() {
    document.getElementById('login-modal').style.display = 'none';
    document.getElementById('login-token').value = '';
}

// --- NAVEGAÇÃO ---

function switchView(view) {
    if (view === 'admin') {
        if (!currentUserToken) {
            requestToken(() => executeSwitch('admin'), "Acesso Gestor");
        } else {
            executeSwitch('admin');
        }
    } else {
        currentUserToken = null; 
        currentUserRole = null;
        executeSwitch('booking');
    }
}

function executeSwitch(view) {
    if (view === 'admin' && currentUserRole !== 'GESTOR') {
        return showToast('Permissão insuficiente.', 'error');
    }

    currentView = view;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-view-${view}`).classList.add('active');

    document.getElementById('view-booking').style.display = 'none';
    document.getElementById('view-admin').style.display = 'none';
    document.getElementById('section-stats').style.display = 'none';

    const sidebar = document.querySelector('.listing-column');

    if (view === 'booking') {
        document.getElementById('view-booking').style.display = 'block';
        document.getElementById('section-stats').style.display = 'block';
        sidebar.classList.remove('locked');
        updateKPIs(); 
    } else {
        document.getElementById('view-admin').style.display = 'block';
        renderAdminTable();
        sidebar.classList.add('locked');
    }
}

// --- INICIALIZAÇÃO OTIMIZADA (COM TELA DE CARREGAMENTO) ---
async function initData() {
    fetchValidTokens();
    
    const picker = document.getElementById('sidebar-date-picker');
    if (picker) picker.value = selectedDateKey; 
    
    const dashPicker = document.getElementById('dashboard-month-picker');
    if (dashPicker) {
        dashPicker.value = selectedDateKey.substring(0, 7);
        dashPicker.addEventListener('change', (e) => {
            // Toast removido conforme solicitado
            syncMonthData(e.target.value); 
        });
    }

    // Await para garantir que o splash screen cubra o carregamento inicial
    await syncMonthData(selectedDateKey);

    // Remove o Splash Screen com fade-out suave
    const splash = document.getElementById('app-splash-screen');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => {
            splash.remove();
        }, 500); // Aguarda a transição CSS antes de remover do DOM
    }

    // Renderiza o que tem
    renderSlotsList();
    updateKPIs();
}

function updateSidebarDate() {
    const picker = document.getElementById('sidebar-date-picker');
    if (picker && picker.value) {
        selectedDateKey = picker.value;
    }
    document.getElementById('room-filter').value = 'ALL';
    document.getElementById('location-filter').value = 'ALL';

    const monthKey = selectedDateKey.substring(0, 7);
    
    if (DASH_CACHE[monthKey] && DASH_CACHE[monthKey].loaded) {
        renderSlotsList();
    } else {
        setLoading(true);
        syncMonthData(selectedDateKey).then(() => {
            renderSlotsList();
            setLoading(false);
        });
    }
}

function changeDate(delta) {
    const current = new Date(selectedDateKey + 'T00:00:00');
    current.setDate(current.getDate() + delta);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');

    selectedDateKey = `${y}-${m}-${d}`;
    document.getElementById('sidebar-date-picker').value = selectedDateKey;
    updateSidebarDate();
}

// --- UI LISTA DE VAGAS ---

function handleSlotClick(slot, key) {
    currentSlotId = slot.id;
    currentDateKey = key;
    renderSlotsList();

    if (currentView === 'booking') {
        openBookingModal(slot, key, slot.status === 'OCUPADO');
    }
}

function updateFilterOptions() {
    const slots = appointments[selectedDateKey] || [];

    const rooms = [...new Set(slots.map(s => s.room))].sort();
    const locations = [...new Set(slots.map(s => s.location || 'Iputinga'))].sort();

    const roomSelect = document.getElementById('room-filter');
    const locSelect = document.getElementById('location-filter');

    if (roomSelect.options.length <= 1) {
        roomSelect.innerHTML = '<option value="ALL">Todas Salas</option>';
        rooms.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r; opt.textContent = r; roomSelect.appendChild(opt);
        });
    }
    
    if (locSelect.options.length <= 1) {
        locSelect.innerHTML = '<option value="ALL">Todas Unidades</option>';
        locations.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l; opt.textContent = l; locSelect.appendChild(opt);
        });
    }
}

function applyFilters() { renderSlotsList(); }

function renderSlotsList() {
    updateFilterOptions();
    const container = document.getElementById('slots-list-container');
    container.innerHTML = '';

    let slots = appointments[selectedDateKey] || [];

    const locFilter = document.getElementById('location-filter').value;
    const roomFilter = document.getElementById('room-filter').value;
    const shiftFilter = document.getElementById('shift-filter').value;

    if (locFilter !== 'ALL') slots = slots.filter(s => (s.location || 'Iputinga') === locFilter);
    if (roomFilter !== 'ALL') slots = slots.filter(s => String(s.room) === String(roomFilter));

    if (shiftFilter !== 'ALL') {
        slots = slots.filter(s => {
            if (shiftFilter === 'MANHA') return s.time <= '11:59';
            if (shiftFilter === 'TARDE') return s.time >= '12:00';
            return true;
        });
    }

    slots.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.status !== b.status) return a.status === 'LIVRE' ? -1 : 1;
        return a.time.localeCompare(b.time);
    });

    if (slots.length === 0) {
        container.innerHTML = `
        <div style="text-align:center; color:#64748b; padding:40px; display:flex; flex-direction:column; align-items:center; gap:16px">
            <div style="background:#f1f5f9; padding:16px; border-radius:50%">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            </div>
            <div>Sem agendas neste dia.</div>
        </div>`;
        return;
    }

    slots.forEach(slot => {
        const item = document.createElement('div');
        item.className = 'slot-item';
        if (currentSlotId === slot.id) item.classList.add('active');

        let statusClass = slot.status === 'LIVRE' ? 'free' : 'booked';
        let statusText = slot.status === 'LIVRE' ? 'Disponível' : 'Ocupado';
        let doctorName = slot.doctor ? `<b>${slot.doctor.split(' ')[0]} ${slot.doctor.split(' ')[1] || ''}</b>` : 'Sem Médico';

        const dayPart = slot.date.split('-')[2];
        const monthPart = slot.date.split('-')[1];
        const formattedDate = `${dayPart}/${monthPart}`;

        let mainInfo = `
        <div style="flex:1">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%">
                <div class="slot-time" style="display:flex; gap:8px; align-items:center;">
                    <span style="background:#e2e8f0; color:#475569; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:600;">${formattedDate}</span>
                    <span>${slot.time}</span>
                </div>
                 <div class="slot-room-badge">Sala ${slot.room}</div>
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:4px;">${slot.location || 'Iputinga'}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">${doctorName}</div>
            <div style="font-size:0.75rem; color:var(--text-light); margin-top:2px;">${slot.specialty || '-'}</div>
        `;

        if (slot.status === 'OCUPADO') {
            mainInfo += `
            <div class="slot-detail-box">
                <div class="detail-patient">${slot.patient}</div>
                <div style="font-size:0.75rem; color:var(--text-light)">Pront: ${slot.record || '?'}</div>
                <div class="detail-meta"><span class="badge-kpi">${slot.contract}</span></div>
            </div>
            <div style="font-size:0.65rem; color:#94a3b8; text-align:right; margin-top:4px; font-style:italic">
                ${slot.createdBy ? 'Agendado por: ' + slot.createdBy : ''}
            </div>
            `;
        }
        mainInfo += `</div>`;

        item.innerHTML = `
        ${mainInfo}
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px">
             <div class="slot-status-badge ${statusClass}">${statusText}</div>
             ${slot.detail ? `<div style="font-size:0.7rem; color:var(--text-secondary); margin-top:4px">${slot.detail}</div>` : ''}
        </div>`;

        item.onclick = () => handleSlotClick(slot, slot.date);
        container.appendChild(item);
    });
}

// --- GERAÇÃO EM LOTE ---

function bulkCreateSlots() {
    const dateVal = document.getElementById('bulk-date').value;
    const location = document.getElementById('bulk-location').value;
    const room = document.getElementById('bulk-room').value;
    const group = document.getElementById('bulk-group').value;
    const doctor = document.getElementById('bulk-doctor').value;
    const startTime = document.getElementById('bulk-start-time').value;
    const endTime = document.getElementById('bulk-end-time').value;
    const qty = parseInt(document.getElementById('bulk-qty').value);

    if (!dateVal || !startTime || !endTime || !doctor || isNaN(qty) || qty < 1) {
        return showToast('Preencha todos os campos.', 'error');
    }

    const [h1, m1] = startTime.split(':').map(Number);
    const [h2, m2] = endTime.split(':').map(Number);
    const startMins = h1 * 60 + m1;
    const endMins = h2 * 60 + m2;

    if (endMins <= startMins) {
        return showToast('Horário final inválido.', 'error');
    }

    const slotDuration = (endMins - startMins) / qty;
    let slotsToSend = [];

    for (let i = 0; i < qty; i++) {
        const currentSlotMins = Math.round(startMins + (i * slotDuration));
        const h = Math.floor(currentSlotMins / 60);
        const m = currentSlotMins % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        slotsToSend.push({
            id: Date.now() + i,
            date: dateVal,
            time: timeStr,
            room: room || '1',
            location: location,
            doctor: doctor,
            specialty: group,
            procedure: group,
            createdBy: currentUserToken
        });
    }

    showMessageModal('Processando', `Criando ${qty} vagas...`, 'loading');

    const payload = { action: "create_bulk", data: slotsToSend };

    sendUpdateToSheet(payload).then(success => {
        closeMessageModal();
        if (success) {
            showToast(`${qty} vagas criadas!`, 'success');
            
            processRawData(slotsToSend.map(s => ({...s, status: 'LIVRE', created_by: currentUserToken})));
            
            selectedDateKey = dateVal;
            document.getElementById('sidebar-date-picker').value = selectedDateKey;
            renderSlotsList();
            updateKPIs();
            executeSwitch('booking');
        }
    });
}

// --- ADMIN TABLE ---

function renderAdminTable() {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;

    const currentlyChecked = Array.from(document.querySelectorAll('.slot-checkbox:checked'))
                                  .map(cb => String(cb.value));

    tbody.innerHTML = '';

    const targetMonth = selectedDateKey.substring(0, 7);
    const slots = [];
    
    Object.keys(appointments).forEach(k => {
        if(k.startsWith(targetMonth)) slots.push(...appointments[k]);
    });

    slots.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
    });

    slots.forEach(slot => {
        const tr = document.createElement('tr');
        
        let statusHtml = slot.status === 'OCUPADO' 
            ? `<span style="background:#fee2e2; color:#dc2626; padding:2px 8px; border-radius:12px; font-weight:600; font-size:0.75rem">OCUPADO</span>`
            : `<span style="background:#dcfce7; color:#16a34a; padding:2px 8px; border-radius:12px; font-weight:600; font-size:0.75rem">LIVRE</span>`;
        
        const dateFmt = `${slot.date.split('-')[2]}/${slot.date.split('-')[1]}`;
        const isChecked = currentlyChecked.includes(String(slot.id)) ? 'checked' : '';

        tr.innerHTML = `
            <td style="text-align:center">
                <input type="checkbox" class="slot-checkbox" value="${slot.id}" ${isChecked} onchange="updateDeleteButton()">
            </td>
            <td>${dateFmt}</td>
            <td>${slot.time}</td>
            <td>${slot.room}</td>
            <td>
                <div style="font-weight:600; font-size:0.85rem">${slot.doctor}</div>
                <div style="font-size:0.75rem; color:var(--text-light)">${slot.specialty}</div>
            </td>
            <td>${statusHtml}</td>
            <td style="text-align:center">
                <button class="btn btn-danger btn-delete-single" style="padding:4px 8px; font-size:0.75rem" onclick="deleteSlot('${slot.id}')">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateDeleteButton();
    
    const masterCheck = document.getElementById('check-all-slots');
    if(masterCheck) {
        const total = document.querySelectorAll('.slot-checkbox').length;
        const checked = document.querySelectorAll('.slot-checkbox:checked').length;
        masterCheck.checked = (total > 0 && total === checked);
    }
}

function toggleAllSlots(source) {
    document.querySelectorAll('.slot-checkbox').forEach(cb => cb.checked = source.checked);
    updateDeleteButton();
}

function updateDeleteButton() {
    const total = document.querySelectorAll('.slot-checkbox:checked').length;
    const btn = document.getElementById('btn-delete-selected');
    const countSpan = document.getElementById('count-selected');
    const singleBtns = document.querySelectorAll('.btn-delete-single');

    singleBtns.forEach(b => {
        b.style.opacity = total > 0 ? '0.3' : '1';
        b.style.pointerEvents = total > 0 ? 'none' : 'auto';
    });

    if (btn) {
        if (total > 0) {
            btn.style.display = 'inline-flex';
            if (countSpan) countSpan.innerText = total;
        } else {
            btn.style.display = 'none';
        }
    }
}

async function deleteSelectedSlots() {
    const checkboxes = document.querySelectorAll('.slot-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => cb.value);
    if (ids.length === 0) return;

    showMessageModal('Confirmação', `Deseja excluir ${ids.length} vagas selecionadas?`, 'confirm', () => {
        processBatchDelete(ids);
    });
}

async function processBatchDelete(ids) {
    showMessageModal('Processando', `Iniciando exclusão...`, 'loading');
    const msgBody = document.getElementById('msg-body');
    
    let successCount = 0;
    const total = ids.length;

    for (let i = 0; i < total; i++) {
        const id = ids[i];
        if(msgBody) msgBody.innerText = `Excluindo ${i + 1} de ${total}...`;
        await new Promise(r => setTimeout(r, 20));

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                redirect: "follow",
                body: JSON.stringify({ action: "delete", id: id }),
                headers: { "Content-Type": "text/plain;charset=utf-8" }
            });
            const result = await response.json();
            if (result.status === 'success') {
                successCount++;
                
                Object.keys(appointments).forEach(key => {
                    appointments[key] = appointments[key].filter(s => String(s.id) !== String(id));
                });
            }
        } catch (e) { console.error("Erro delete:", e); }
    }

    recalculateMonthCache(selectedDateKey.substring(0, 7));

    closeMessageModal();
    renderSlotsList(); 
    renderAdminTable(); 
    updateKPIs(); 

    showToast(`${successCount} vagas excluídas.`, 'success');
}

function deleteSlot(id) {
    const monthKey = selectedDateKey.substring(0,7);
    let slot = null;
    
    Object.keys(appointments).forEach(k => {
        if(!slot && k.startsWith(monthKey)) slot = appointments[k].find(s => String(s.id) === String(id));
    });

    let msg = 'Excluir vaga permanentemente?';
    if (slot && slot.status === 'OCUPADO') {
        msg = `<b>ATENÇÃO:</b> Vaga com paciente <b>${slot.patient}</b>. Excluir removerá ambos.`;
    }

    showMessageModal('Excluir', msg, 'confirm', async () => {
        closeMessageModal();
        setLoading(true); 
        
        const success = await sendUpdateToSheet({ action: "delete", id: id });
        if (success) {
             Object.keys(appointments).forEach(key => {
                appointments[key] = appointments[key].filter(s => String(s.id) !== String(id));
            });

            recalculateMonthCache(selectedDateKey.substring(0, 7));
            renderSlotsList();
            renderAdminTable();
            updateKPIs();

            showToast('Vaga excluída.', 'success');
        }
        setLoading(false);
    });
}

// --- MODAL DE AGENDAMENTO ---

function openBookingModal(slot, key, isEdit = false) {
    const modal = document.getElementById('booking-modal');

    document.getElementById('bk-record').value = slot.record || '';
    document.getElementById('bk-patient').value = slot.patient || '';
    document.getElementById('bk-contract').value = slot.contract || '';
    document.getElementById('bk-procedure').value = slot.procedure || slot.specialty || '';
    document.getElementById('bk-detail').value = slot.detail || '';
    document.getElementById('bk-eye').value = slot.eye || '';
    document.getElementById('selected-slot-id').value = slot.id;

    let isReg = slot.regulated;
    if (isReg === undefined || isReg === null) isReg = true;
    if (slot.status === 'LIVRE') isReg = true;

    const radios = document.getElementsByName('bk-regulated');
    const radioVal = isReg ? 'yes' : 'no';
    for (const r of radios) { 
        if (r.value === radioVal) r.checked = true; 
    }

    const dateFmt = `${slot.date.split('-')[2]}/${slot.date.split('-')[1]}`;
    document.getElementById('modal-slot-info').innerText = `${dateFmt} • ${slot.time} • ${slot.doctor}`;
    
    document.getElementById('warning-box').style.display = 'none';

    const btnArea = document.getElementById('action-buttons-area');
    if (isEdit) {
        btnArea.innerHTML = `<button class="btn btn-danger" onclick="cancelSlotBooking()">Liberar Vaga</button>`;
    } else {
        btnArea.innerHTML = `<button class="btn btn-primary" onclick="confirmBookingFromModal()">Confirmar</button>`;
    }

    modal.classList.add('open');
    checkWarning();
}

function closeModal() { document.getElementById('booking-modal').classList.remove('open'); }

function checkWarning() {
    const contract = document.getElementById('bk-contract').value;
    const warningBox = document.getElementById('warning-box');
    const radios = document.getElementsByName('bk-regulated');
    const isMunicipal = CONTRACTS.MUNICIPAL.includes(contract);
    
    for (const r of radios) r.disabled = isMunicipal;

    if (!contract || isMunicipal) {
        warningBox.style.display = 'none';
        return;
    }

    // Projeção Rápida
    let isNewBookingRegulated = true;
    for (const r of radios) { if (r.checked && r.value === 'no') isNewBookingRegulated = false; }

    const monthKey = selectedDateKey.substring(0,7);
    const stats = DASH_CACHE[monthKey];
    
    if(!stats || stats.total === 0) return;

    // Pega contagens atuais do cache
    let countReg = stats.counts.Regulado.Total;
    let countInt = stats.counts.Interno.Total;
    const totalSlots = stats.total;

    if (isNewBookingRegulated) countReg++;
    else countInt++;

    const pctReg = (countReg / totalSlots) * 100;
    const pctInt = (countInt / totalSlots) * 100;

    let showWarning = false;
    let msg = "";

    if (isNewBookingRegulated && pctReg > 60) {
        showWarning = true;
        msg = `Atenção: Regulados atingirão <b>${pctReg.toFixed(1)}%</b> (Meta: 60%)`;
    } else if (!isNewBookingRegulated && pctInt > 40) {
        showWarning = true;
        msg = `Atenção: Internos atingirão <b>${pctInt.toFixed(1)}%</b> (Meta: 40%)`;
    }

    if (showWarning) {
        warningBox.style.display = 'flex';
        if(warningBox.querySelector('div:last-child > div:last-child')) {
             warningBox.querySelector('div:last-child > div:last-child').innerHTML = msg;
        } else {
             const div = document.createElement('div');
             div.innerHTML = msg;
             warningBox.appendChild(div);
        }
    } else {
        warningBox.style.display = 'none';
    }
}

function confirmBookingFromModal() {
    const id = document.getElementById('selected-slot-id').value;
    const record = document.getElementById('bk-record').value;
    const patient = document.getElementById('bk-patient').value;
    const contract = document.getElementById('bk-contract').value;
    const procedure = document.getElementById('bk-procedure').value;
    const detail = document.getElementById('bk-detail').value;
    const eye = document.getElementById('bk-eye').value;

    if (!patient || !contract || !record || !detail || !eye) {
        return showToast('Preencha todos os campos.', 'error');
    }

    const radios = document.getElementsByName('bk-regulated');
    let isRegulated = true;
    const isMunicipal = CONTRACTS.MUNICIPAL.includes(contract);

    if (isMunicipal) {
        isRegulated = null; 
    } else {
        for (const r of radios) { if (r.checked && r.value === 'no') isRegulated = false; }
    }

    const summary = `
        <div style="text-align:left; background:#f8fafc; padding:16px; border-radius:8px; font-size:0.9rem; border:1px solid #e2e8f0">
            <div><b>Paciente:</b> ${patient}</div>
            <div><b>Contrato:</b> ${contract}</div>
            <div><b>Regulado:</b> ${isRegulated === true ? 'SIM' : (isRegulated === false ? 'NÃO' : '-')}</div>
        </div>
        <div style="margin-top:16px; font-weight:600">Confirmar?</div>
    `;

    showMessageModal('Confirmação', summary, 'confirm', () => {
        requestToken(async () => {
            Object.keys(appointments).forEach(dateKey => {
                const slotIndex = appointments[dateKey].findIndex(s => String(s.id) === String(id));
                if (slotIndex !== -1) {
                    appointments[dateKey][slotIndex] = {
                        ...appointments[dateKey][slotIndex],
                        status: 'OCUPADO',
                        patient: patient,
                        record: record,
                        contract: contract,
                        regulated: isRegulated,
                        procedure: procedure,
                        detail: detail,
                        eye: eye,
                        createdBy: currentUserToken
                    };
                }
            });

            recalculateMonthCache(selectedDateKey.substring(0, 7));
            closeMessageModal();
            closeModal();
            renderSlotsList();
            updateKPIs();
            showToast("Agendamento realizado!", "success");

            const payload = {
                action: "update",
                id: id,
                status: 'OCUPADO',
                patient: patient,
                record: record,
                contract: contract,
                regulated: isRegulated,
                procedure: procedure,
                detail: detail,
                eye: eye,
                createdBy: currentUserToken
            };

            sendUpdateToSheet(payload).then(success => {
                if (!success) {
                    showToast("Falha ao salvar no servidor.", "error");
                }
            });
        });
    });
}

function cancelSlotBooking() {
    showMessageModal('Liberar Vaga', 'Remover paciente?', 'confirm', () => {
        requestToken(async () => {
            const id = document.getElementById('selected-slot-id').value;
            
            Object.keys(appointments).forEach(dateKey => {
                const slotIndex = appointments[dateKey].findIndex(s => String(s.id) === String(id));
                if (slotIndex !== -1) {
                    appointments[dateKey][slotIndex] = {
                        ...appointments[dateKey][slotIndex],
                        status: 'LIVRE',
                        patient: '', record: '', contract: '', regulated: null,
                        procedure: '', detail: '', eye: '', createdBy: currentUserToken
                    };
                }
            });

            recalculateMonthCache(selectedDateKey.substring(0, 7));
            closeMessageModal();
            closeModal();
            renderSlotsList();
            updateKPIs();
            showToast("Vaga liberada.", "success");

            const payload = {
                action: "update",
                id: id,
                status: 'LIVRE',
                patient: '', record: '', contract: '', regulated: null,
                procedure: '', detail: '', eye: '', createdBy: currentUserToken
            };
            
            sendUpdateToSheet(payload);
        }, "Autorizar Cancelamento");
    });
}

// --- KPI ---
function updateKPIs() {
    const picker = document.getElementById('dashboard-month-picker');
    let targetMonth = selectedDateKey.substring(0, 7);

    if (picker && picker.value) {
        targetMonth = picker.value;
    } else if (picker) {
        picker.value = targetMonth;
    }

    if (!DASH_CACHE[targetMonth]) recalculateMonthCache(targetMonth);
    
    const stats = DASH_CACHE[targetMonth] || {
        total: 0, occupied: 0, 
        counts: {
            Regulado: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
            Interno: { Total: 0, ESTADO: 0, SERRA: 0, SALGUEIRO: 0 },
            Municipal: { Total: 0, RECIFE: 0, JABOATÃO: 0 }
        }
    };

    const { total, occupied, counts } = stats;

    const pctOccupied = total > 0 ? (occupied / total) * 100 : 0;
    const pctIdle = total > 0 ? ((total - occupied) / total) * 100 : 0;

    animateMetric('glb-total', total);
    animateMetric('glb-occupied', pctOccupied, true);
    animateMetric('glb-idle', pctIdle, true);

    const totalReg = counts.Regulado.Total;
    const pctRegGlobal = total > 0 ? (totalReg / total) * 100 : 0;
    
    animateMetric('kpi-60-val', pctRegGlobal, true);
    document.getElementById('prog-60').style.width = Math.min(pctRegGlobal, 100) + '%';

    animateSubMetric('stat-estado', counts.Regulado.ESTADO, totalReg);
    animateSubMetric('stat-serra', counts.Regulado.SERRA, totalReg);
    animateSubMetric('stat-salgueiro', counts.Regulado.SALGUEIRO, totalReg);

    const totalInt = counts.Interno.Total;
    const pctIntGlobal = total > 0 ? (totalInt / total) * 100 : 0;

    animateMetric('kpi-40-val', pctIntGlobal, true);
    document.getElementById('prog-40').style.width = Math.min(pctIntGlobal, 100) + '%';

    animateSubMetric('stat-int-estado', counts.Interno.ESTADO, totalInt);
    animateSubMetric('stat-int-serra', counts.Interno.SERRA, totalInt);
    animateSubMetric('stat-int-salgueiro', counts.Interno.SALGUEIRO, totalInt);

    animateMetric('stat-recife', counts.Municipal.RECIFE);
    animateMetric('stat-jaboatao', counts.Municipal.JABOATÃO);
    animateMetric('kpi-mun-val', counts.Municipal.Total);
}

// --- PDF ---
function generateDashboardPDF() {
    const monthVal = document.getElementById('dashboard-month-picker').value || 'Geral';
    
    let stats = DASH_CACHE[monthVal];
    if (!stats) {
        recalculateMonthCache(monthVal);
        stats = DASH_CACHE[monthVal];
    }
    
    const { total, occupied, counts } = stats;
    
    const pctOcup = total > 0 ? (occupied / total * 100).toFixed(1) : "0.0";
    const totalReg = counts.Regulado.Total;
    const totalInt = counts.Interno.Total;
    const pctRegGlobal = total > 0 ? (totalReg / total * 100).toFixed(1) : "0.0";
    const pctIntGlobal = total > 0 ? (totalInt / total * 100).toFixed(1) : "0.0";

    const calcSubPct = (val, groupTot) => groupTot > 0 ? (val / groupTot * 100).toFixed(1) : "0.0";

    const regEstadoPct = calcSubPct(counts.Regulado.ESTADO, totalReg);
    const regSerraPct = calcSubPct(counts.Regulado.SERRA, totalReg);
    const regSalgPct = calcSubPct(counts.Regulado.SALGUEIRO, totalReg);

    const intEstadoPct = calcSubPct(counts.Interno.ESTADO, totalInt);
    const intSerraPct = calcSubPct(counts.Interno.SERRA, totalInt);
    const intSalgPct = calcSubPct(counts.Interno.SALGUEIRO, totalInt);

    const content = document.createElement('div');
    content.innerHTML = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <div style="border-bottom: 2px solid #0284c7; padding-bottom: 10px; margin-bottom: 20px;">
                <h1 style="color: #1e293b; font-size: 24px; margin: 0;">Relatório de Governança Cirúrgica</h1>
                <div style="color: #64748b; font-size: 14px; margin-top: 5px;">Período de Referência: ${monthVal}</div>
            </div>

            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 30px;">
                <h3 style="margin-top:0; color:#475569; font-size:16px; border-bottom:1px solid #cbd5e1; padding-bottom:5px;">Visão Global</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Total de Vagas:</strong> ${total}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Ocupação:</strong> ${pctOcup}%</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Ociosidade:</strong> ${(100 - parseFloat(pctOcup)).toFixed(1)}%</td>
                    </tr>
                </table>
            </div>

            <div style="display:flex; gap:20px;">
                <div style="flex:1;">
                    <h3 style="color:#7c3aed; font-size:16px; border-bottom:1px solid #ddd; padding-bottom:5px;">Contratos Regulados (Meta 60%)</h3>
                    <div style="font-size:24px; font-weight:bold; color:#7c3aed; margin-bottom:10px;">${pctRegGlobal}% <span style="font-size:12px; color:#666">do total</span></div>
                    <table style="width: 100%; border: 1px solid #e2e8f0; font-size:13px;">
                        <tr style="background:#f1f5f9;"><th style="padding:8px; text-align:left;">Unidade</th><th style="padding:8px; text-align:right;">% Grupo (Qtd)</th></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Estado</td><td style="padding:8px; text-align:right;">${regEstadoPct}% (${counts.Regulado.ESTADO})</td></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Serra Talhada</td><td style="padding:8px; text-align:right;">${regSerraPct}% (${counts.Regulado.SERRA})</td></tr>
                        <tr><td style="padding:8px;">Salgueiro</td><td style="padding:8px; text-align:right;">${regSalgPct}% (${counts.Regulado.SALGUEIRO})</td></tr>
                        <tr style="background:#f8fafc; font-weight:bold;"><td style="padding:8px;">TOTAL</td><td style="padding:8px; text-align:right;">100% (${totalReg})</td></tr>
                    </table>
                </div>

                <div style="flex:1;">
                    <h3 style="color:#059669; font-size:16px; border-bottom:1px solid #ddd; padding-bottom:5px;">Contratos Internos (Meta 40%)</h3>
                    <div style="font-size:24px; font-weight:bold; color:#059669; margin-bottom:10px;">${pctIntGlobal}% <span style="font-size:12px; color:#666">do total</span></div>
                    <table style="width: 100%; border: 1px solid #e2e8f0; font-size:13px;">
                        <tr style="background:#f1f5f9;"><th style="padding:8px; text-align:left;">Unidade</th><th style="padding:8px; text-align:right;">% Grupo (Qtd)</th></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Estado</td><td style="padding:8px; text-align:right;">${intEstadoPct}% (${counts.Interno.ESTADO})</td></tr>
                        <tr><td style="padding:8px; border-bottom:1px solid #eee;">Serra Talhada</td><td style="padding:8px; text-align:right;">${intSerraPct}% (${counts.Interno.SERRA})</td></tr>
                        <tr><td style="padding:8px;">Salgueiro</td><td style="padding:8px; text-align:right;">${intSalgPct}% (${counts.Interno.SALGUEIRO})</td></tr>
                        <tr style="background:#f8fafc; font-weight:bold;"><td style="padding:8px;">TOTAL</td><td style="padding:8px; text-align:right;">100% (${totalInt})</td></tr>
                    </table>
                </div>
            </div>

            <div style="margin-top: 30px;">
                 <h3 style="color:#64748b; font-size:16px; border-bottom:1px solid #ddd; padding-bottom:5px;">Municípios (Sem Meta)</h3>
                 <table style="width: 100%; border: 1px solid #e2e8f0; font-size:13px;">
                    <tr style="background:#f1f5f9;"><th style="padding:8px; text-align:left;">Município</th><th style="padding:8px; text-align:right;">Qtd</th></tr>
                    <tr><td style="padding:8px; border-bottom:1px solid #eee;">Recife</td><td style="padding:8px; text-align:right;">${counts.Municipal.RECIFE}</td></tr>
                    <tr><td style="padding:8px;">Jaboatão</td><td style="padding:8px; text-align:right;">${counts.Municipal.JABOATÃO}</td></tr>
                 </table>
            </div>

            <div style="margin-top:40px; font-size:10px; color:#94a3b8; text-align:center; border-top:1px solid #eee; padding-top:10px;">
                Documento gerado automaticamente pelo sistema GovCirúrgica em ${new Date().toLocaleString()}
            </div>
        </div>
    `;

    const opt = {
        margin:       10,
        filename:     `Relatorio_Gov_${monthVal}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    setLoading(true);

    if (typeof html2pdf === 'undefined') {
        setLoading(false);
        return showToast('Erro: Biblioteca PDF não carregada.', 'error');
    }

    html2pdf().set(opt).from(content).save().then(() => {
        setLoading(false);
        showToast('PDF baixado com sucesso!', 'success');
    }).catch(err => {
        setLoading(false);
        console.error(err);
        showToast('Erro ao gerar PDF.', 'error');
    });
}

// --- MODAIS GERAIS ---

let messageCallback = null;

function showMessageModal(title, message, type = 'success', onConfirm = null) {
    const modal = document.getElementById('message-modal');
    const iconEl = document.getElementById('msg-icon');
    const btns = document.getElementById('msg-actions');

    document.getElementById('msg-title').innerText = title;
    document.getElementById('msg-body').innerHTML = message;
    messageCallback = onConfirm;

    btns.style.display = 'flex';
    if (type === 'loading') btns.style.display = 'none';

    const icons = {
        'success': { color: '#16a34a', bg: '#dcfce7', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>` },
        'warning': { color: '#d97706', bg: '#fef3c7', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>` },
        'error': { color: '#dc2626', bg: '#fee2e2', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>` },
        'confirm': { color: '#0284c7', bg: '#e0f2fe', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>` },
        'loading': { color: '#0284c7', bg: '#f0f9ff', svg: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>` }
    };

    const style = icons[type] || icons['success'];
    iconEl.style.color = style.color;
    iconEl.style.background = style.bg;
    iconEl.innerHTML = style.svg;

    const btnConfirm = document.getElementById('msg-btn-confirm');
    const btnCancel = document.getElementById('msg-btn-cancel');

    if (type === 'confirm') {
        btnCancel.style.display = 'block';
        btnConfirm.innerText = 'Confirmar';
        btnConfirm.onclick = () => { if (messageCallback) messageCallback(); };
    } else {
        btnCancel.style.display = 'none';
        btnConfirm.innerText = 'OK';
        btnConfirm.onclick = () => closeMessageModal();
    }

    modal.classList.add('open');
}

function closeMessageModal() {
    document.getElementById('message-modal').classList.remove('open');
    messageCallback = null;
}

function exportDailyReport() {
    const key = selectedDateKey;
    const slots = appointments[key] || [];

    if (slots.length === 0) return showToast('Nada para exportar.', 'warning');

    const headers = ["Data", "Hora", "Unidade", "Sala", "Status", "Paciente", "Prontuario", "Contrato", "Regulado", "Medico", "Procedimento", "Detalhe"];
    const rows = slots.map(s => {
        return [
            key, s.time, s.location, s.room, s.status, s.patient, s.record, s.contract, 
            (s.regulated ? 'SIM' : 'NÃO'), s.doctor, s.procedure, s.detail
        ].map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';');
    });

    const csvContent = "\uFEFF" + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Relatorio_${key}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.onclick = function (event) {
    if (event.target === document.getElementById('login-modal')) closeLoginModal();
    if (event.target === document.getElementById('booking-modal')) closeModal();
    if (event.target === document.getElementById('message-modal')) closeMessageModal();
}

// Inicia
initData();