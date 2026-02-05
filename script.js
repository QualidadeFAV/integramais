/* --- CONFIGURAÇÕES GERAIS --- */
const API_URL = "https://script.google.com/macros/s/AKfycbyA8a8PaPz7T4lkx6NlQfeX1iWiNi9OywZKQO-Y_hUaNzrZF5_66ptDHCA-l9_IFeKc/exec";
const API_TOKEN = "fav-2026-seguro-123";

// Hash Base64 de "110423"
const PIN_HASH = "MTEwNDIz"; 

/* --- ESTADO GLOBAL --- */
let tasks = [];
let tempSteps = [];
let newFiles = [];
let keptExistingAttachments = [];
let filesToDelete = [];
let editingStepIndex = -1;
let termoBusca = "";
let isStatsOpen = false;
let attachmentToDeleteIndex = -1;

/* --- OTIMIZAÇÃO DE SCROLL (NOVO) --- */
let currentFilteredTasks = []; // Armazena a lista completa já filtrada/ordenada
let itemsRendered = 0;         // Quantos itens já estão na tela
const ITEMS_PER_BATCH = 30;    // Quantos itens carregar por vez
let isRendering = false;       // Trava para evitar execução dupla

// Variáveis de controle do PIN
let pendingPinAction = null;

// Sistema de Itens Fixados (LocalStorage)
let pinnedItems = JSON.parse(localStorage.getItem('fav_pinned_tasks')) || [];

// Sistema de Rascunho
let draftData = null;
let estadoInicialFormulario = "";
let pendingIntentId = null;

// Cache e Controle
let photoCache = {};
let buscandoAgora = new Set();
let dbNomes = {};
let debounceTimer;
let filterTimeout;

Chart.defaults.font.family = 'Montserrat';
Chart.defaults.color = '#64748b';
let chartStatusInstance, chartRespInstance, chartUnitInstance, chartPrazosInstance;

// Referências DOM Principais
const grid = document.getElementById('grid');
const modal = document.getElementById('modalOverlay');
const deleteModal = document.getElementById('deleteModal');
const attachmentDeleteModal = document.getElementById('attachmentDeleteModal');
const alertModal = document.getElementById('alertModal');
const draftConfirmModal = document.getElementById('draftConfirmModal');
const pinModal = document.getElementById('pinModal');
const timelineList = document.getElementById('timelineList');
const btnAddStep = document.getElementById('btnAddStepBtn');
const statsPanel = document.getElementById('statsPanel');
const btnStats = document.getElementById('btnStats');
const loadingOverlay = document.getElementById('loading-overlay');
const fileInput = document.getElementById('inpFiles');

/* --- INICIALIZAÇÃO --- */
window.onload = () => {
    carregarDados();

    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
        pinInput.addEventListener('keyup', function(event) {
            if (event.key === "Enter") validarPin();
        });
    }

    // LISTENER DE SCROLL PARA CARREGAMENTO PROGRESSIVO
    window.addEventListener('scroll', () => {
        if (isRendering || isStatsOpen) return;

        // Verifica se chegou perto do fim da página (300px de margem)
        const scrollPosition = window.innerHeight + window.scrollY;
        const threshold = document.body.offsetHeight - 300;

        if (scrollPosition >= threshold) {
            // Se ainda existem itens na lista filtrada que não foram renderizados
            if (itemsRendered < currentFilteredTasks.length) {
                renderNextBatch(true); 
            }
        }
    });
};

/* --- LÓGICA DE SEGURANÇA (PIN OFUSCADO) --- */

function checkPinAndExecute(action) {
    pendingPinAction = action;
    const pinInp = document.getElementById('pinInput');
    pinInp.value = "";
    document.getElementById('pinError').style.opacity = "0";
    pinModal.style.display = 'flex';
    setTimeout(() => {
        pinModal.classList.add('active');
        pinInp.focus();
    }, 10);
}

function fecharPinModal() {
    pinModal.classList.remove('active');
    setTimeout(() => {
        pinModal.style.display = 'none';
        pendingPinAction = null;
        document.getElementById('pinInput').value = "";
    }, 300);
}

function validarPin() {
    const inputVal = document.getElementById('pinInput').value;
    const errorMsg = document.getElementById('pinError');

    if (btoa(inputVal) === PIN_HASH) {
        // Senha Correta
        const action = pendingPinAction;
        fecharPinModal();

        setTimeout(() => {
            if (action === 'save') {
                salvarTask();
            } else if (action === 'delete') {
                tentarDeletar();
            }
        }, 310);
    } else {
        // Senha Incorreta
        errorMsg.style.opacity = "1";
        const pinInp = document.getElementById('pinInput');
        pinInp.classList.add('modified-field');
        setTimeout(() => pinInp.classList.remove('modified-field'), 500);
    }
}

/* --- FUNÇÕES DO SISTEMA (CRUD E LOAD) --- */

async function carregarDados(silencioso = false) {
    try {
        if (!silencioso) loadingOverlay.classList.remove('hidden');

        const r = await fetch(`${API_URL}?action=read&token=${API_TOKEN}&v=${Date.now()}`);
        const d = await r.json();

        if (d.result === 'error') throw new Error(d.message);
        
        const lista = Array.isArray(d) ? d : (d.data ? d.data : []);

        tasks = lista.map(t => {
            const k = (n) => Object.keys(t).find(x => x.toLowerCase() === n.toLowerCase());
            let stepsRaw = t[k('steps')] || t.steps;
            if (typeof stepsRaw === 'string') {
                try { stepsRaw = JSON.parse(stepsRaw); } catch { stepsRaw = []; }
            }

            return {
                ...t,
                id: t.id,
                title: t[k('title')] || "Sem Título",
                dateStart: t[k('datestart')] || "",
                dateDue: t[k('datedue')] || "",
                status: t[k('status')] || "pendente",
                steps: Array.isArray(stepsRaw) ? stepsRaw : [],
                attachments: t[k('attachments')] || "",
                origin: t[k('origin')] || "",
                unit: t[k('unit')] || "",
                resp: t[k('resp')] || "",
                why: t[k('why')] || "",
                how: t[k('how')] || "",
                cost: t[k('cost')] || "",
                obs: t[k('obs')] || ""
            };
        });

        checkPinnedExpiration();
        popularFiltroUnidades();
        popularFiltroOrigem();
        aplicarFiltros(!silencioso);

        if (isStatsOpen) setTimeout(() => atualizarGraficos(), 100);

        if (Object.keys(dbNomes).length === 0) {
            fetch(`${API_URL}?action=getNamesHistory&token=${API_TOKEN}`)
                .then(res => res.json())
                .then(data => { dbNomes = data; })
                .catch(err => console.log("Erro nomes:", err));
        }

    } catch (e) {
        console.error("Erro ao carregar:", e);
        if (!silencioso) showToast("Erro ao conectar no banco", "error");
    } finally {
        if (!silencioso) loadingOverlay.classList.add('hidden');
    }
}

function salvarTask() {
    const originVal = document.getElementById('inpOrigin').value;
    if (!originVal || originVal.trim() === "") {
        document.getElementById('alertMsg').innerText = "O campo ORIGEM é obrigatório!";
        document.getElementById('alertModal').style.display = 'flex';
        setTimeout(() => document.getElementById('alertModal').classList.add('active'), 10);
        return;
    }
    const id = document.getElementById('taskId').value;
    const title = document.getElementById('inpTitle').value;
    if (!title || title.trim() === "") {
        document.getElementById('alertMsg').innerText = "Preencha o título.";
        document.getElementById('alertModal').style.display = 'flex';
        setTimeout(() => document.getElementById('alertModal').classList.add('active'), 10);
        return;
    }

    const stT = document.getElementById('newStepTitle').value.trim();
    const stD = document.getElementById('newStepDesc').value.trim();
    if (stT !== "" || stD !== "") {
        const passo = {
            title: stT,
            desc: stD,
            date: document.getElementById('newStepDate').value
        };
        if (editingStepIndex > -1) tempSteps[editingStepIndex] = passo;
        else tempSteps.push(passo);
    }

    const taskObj = {
        id: id ? id : "temp_" + Date.now(),
        title: title,
        origin: originVal,
        unit: document.getElementById('inpUnit').value,
        priority: document.getElementById('inpPriority').value,
        status: document.getElementById('selectedStatus').value,
        resp: document.getElementById('inpResp').value,
        problem: document.getElementById('inpProblem').value,
        why: document.getElementById('inpWhy').value,
        how: document.getElementById('inpHow').value,
        cost: document.getElementById('inpCost').value,
        obs: document.getElementById('inpObs').value,
        dateStart: document.getElementById('inpDateStart').value,
        dateDue: document.getElementById('inpDateDue').value,
        steps: tempSteps,
        attachments: keptExistingAttachments.join('|||')
    };

    if (id) {
        const idx = tasks.findIndex(t => String(t.id) === String(id));
        if (idx > -1) tasks[idx] = { ...tasks[idx], ...taskObj };
    } else {
        tasks.unshift(taskObj);
    }

    fecharModal(true);
    showToast("Salvo com sucesso!", "success");

    aplicarFiltros(false);
    renderPinnedSection();

    setTimeout(() => {
        if (isStatsOpen) atualizarGraficos();

        const payload = {
            action: id ? 'update' : 'create',
            id: id,
            title: title,
            token: API_TOKEN,
            origin: originVal,
            unit: taskObj.unit,
            priority: taskObj.priority,
            status: taskObj.status,
            resp: taskObj.resp,
            problem: taskObj.problem,
            why: taskObj.why,
            how: taskObj.how,
            cost: taskObj.cost,
            obs: taskObj.obs,
            dateStart: taskObj.dateStart,
            dateDue: taskObj.dateDue,
            steps: JSON.stringify(tempSteps),
            keptAttachments: keptExistingAttachments.join('|||'),
            filesToDelete: filesToDelete.join('|||'),
            newFiles: newFiles
        };

        fetch(API_URL, {
            method: "POST",
            body: JSON.stringify(payload)
        })
        .then(r => r.json())
        .then(d => {
            if (d.result === 'success' || d.result === 'updated' || d.result === 'created') {
                carregarDados(true);
            } else {
                showToast("Erro no servidor: " + (d.message || d.error), "error");
            }
        })
        .catch(e => console.log("Erro rede ao salvar", e));
    }, 100);
}

function tentarDeletar() {
    const id = document.getElementById('taskId').value;
    if (!id) return;
    document.getElementById('deleteModal').style.display = 'flex';
    setTimeout(() => document.getElementById('deleteModal').classList.add('active'), 10);
}

function confirmarExclusao() {
    const id = document.getElementById('taskId').value;
    if (!id) return;
    
    document.getElementById('deleteModal').classList.remove('active');
    setTimeout(() => document.getElementById('deleteModal').style.display = 'none', 300);
    fecharModal(true);

    tasks = tasks.filter(t => String(t.id) !== String(id));
    const pinIdx = pinnedItems.findIndex(p => String(p.id) === String(id));
    if (pinIdx > -1) {
        pinnedItems.splice(pinIdx, 1);
        localStorage.setItem('fav_pinned_tasks', JSON.stringify(pinnedItems));
        renderPinnedSection();
    }
    aplicarFiltros(false);
    showToast("Excluído com sucesso!", "success");

    setTimeout(() => {
        fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "delete",
                id: id,
                token: API_TOKEN
            })
        })
        .then(r => r.json())
        .catch(e => carregarDados(true));
    }, 50);
}

function fecharDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    setTimeout(() => document.getElementById('deleteModal').style.display = 'none', 300);
}

function resetarPagina() {
    if (document.activeElement) document.activeElement.blur();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const searchInput = document.querySelector('.search-input');
    if (searchInput) searchInput.value = "";
    termoBusca = "";
    if (isStatsOpen) {
        statsPanel.classList.remove('open');
        document.getElementById('btnStats').classList.remove('active');
        isStatsOpen = false;
    }
    setTimeout(() => limparFiltros(false), 300);
}

function toggleDropdown(id) {
    const el = document.getElementById(id);
    const overlay = document.getElementById('clickOverlay');
    document.querySelectorAll('.custom-dropdown').forEach(d => { if (d.id !== id) d.classList.remove('active'); });
    if (el.classList.contains('active')) {
        el.classList.remove('active');
        overlay.classList.remove('active');
    } else {
        el.classList.add('active');
        overlay.classList.add('active');
    }
}

function toggleModalDropdown(id, e) {
    if (e) e.stopPropagation();
    const el = document.getElementById(id);
    document.querySelectorAll('.custom-dropdown-modal').forEach(d => { if (d.id !== id) d.classList.remove('active'); });
    if (el.classList.contains('active')) {
        el.classList.remove('active');
    } else {
        el.classList.add('active');
        const inputVal = el.querySelector('input').value;
        el.querySelectorAll('.dropdown-item').forEach(item => {
            const dataVal = item.getAttribute('data-value');
            if (dataVal === inputVal) item.classList.add('selected');
            else item.classList.remove('selected');
        });
    }
}

function selectModalOption(type, value, label, e) {
    if (e) e.stopPropagation();
    if (type === 'unit') {
        document.getElementById('inpUnit').value = value;
        document.getElementById('display-unit').innerText = label;
        document.getElementById('dd-modal-unit').classList.remove('active');
    } else if (type === 'priority') {
        document.getElementById('inpPriority').value = value;
        document.getElementById('display-prio').innerText = label;
        document.getElementById('dd-modal-prio').classList.remove('active');
    }
}

document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-dropdown-modal')) {
        document.querySelectorAll('.custom-dropdown-modal').forEach(d => d.classList.remove('active'));
    }
});

function closeAllDropdowns() {
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('active'));
    document.getElementById('clickOverlay').classList.remove('active');
}

function selectFilter(type, value, label, item) {
    document.getElementById('filtro-' + type).value = value;
    const btnLabel = document.getElementById('lbl-' + type);
    if (btnLabel) btnLabel.innerText = label;
    const container = document.getElementById('dd-' + type);
    const options = container.querySelectorAll('.dropdown-item');
    options.forEach(op => op.classList.remove('selected'));
    item.classList.add('selected');
    closeAllDropdowns();
    aplicarFiltros(true);
}

function formatarMoeda(elm) {
    let value = elm.value.replace(/\D/g, "");
    value = (Number(value) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    elm.value = value;
}

function formatarData(isoStr) {
    if (!isoStr) return "";
    const partes = isoStr.split(/[-/T ]/);
    if (partes.length >= 3) {
        if (partes[0].length === 4) return `${partes[2]}/${partes[1]}/${partes[0]}`;
        return `${partes[0]}/${partes[1]}/${partes[2]}`;
    }
    return isoStr;
}

function dataParaInput(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().split('T')[0];
}

function formatarNomeProprio(texto) {
    if (!texto || typeof texto !== 'string') return "";
    return texto.trim().replace(/\s+/g, ' ').toLowerCase().replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'check_circle' : (type === 'info' ? 'info' : 'error');
    toast.innerHTML = `<span class="material-icons-round" style="font-size:18px">${icon}</span> ${msg}`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

function normalizarTexto(t) {
    if (!t) return "pendente";
    return t.toString().toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

fileInput.addEventListener('change', function(e) {
    if (this.files) {
        Array.from(this.files).forEach(f => {
            const r = new FileReader();
            r.onload = evt => {
                newFiles.push({ name: f.name, type: f.type, data: evt.target.result });
                renderFilePreview();
            };
            r.readAsDataURL(f);
        });
    }
    this.value = '';
});

function renderFilePreview() {
    const c = document.getElementById('filePreviewList');
    c.innerHTML = "";
    newFiles.forEach((f, i) => {
        const s = document.createElement('span');
        s.className = 'file-chip';
        let th = f.data.startsWith('data:image') ? `<img src="${f.data}" class="file-preview-img">` : `<span class="material-icons-round" style="font-size:16px">insert_drive_file</span>`;
        s.innerHTML = `${th} <span class="file-name-trunc" title="${f.name}">${f.name}</span> <div class="file-remove-btn" onclick="removeNewFile(${i}, event)">&times;</div>`;
        c.appendChild(s);
    });
}

function removeNewFile(i, e) {
    if (e) e.stopPropagation();
    newFiles.splice(i, 1);
    renderFilePreview();
}

function removeExistingAttachment(idx) {
    attachmentToDeleteIndex = idx;
    attachmentDeleteModal.style.display = 'flex';
    setTimeout(() => attachmentDeleteModal.classList.add('active'), 10);
}

function fecharModalAnexo() {
    attachmentDeleteModal.classList.remove('active');
    setTimeout(() => attachmentDeleteModal.style.display = 'none', 300);
    attachmentToDeleteIndex = -1;
}

function confirmarExclusaoAnexo() {
    if (attachmentToDeleteIndex > -1) {
        filesToDelete.push(keptExistingAttachments[attachmentToDeleteIndex]);
        keptExistingAttachments.splice(attachmentToDeleteIndex, 1);
        renderExistingAttachments();
        fecharModalAnexo();
    }
}

function renderExistingAttachments() {
    const c = document.getElementById('existingAttachmentsArea');
    if (keptExistingAttachments.length === 0) {
        c.innerHTML = "";
        return;
    }
    let h = '<div style="margin-bottom:5px; font-weight:bold; font-size:0.8rem; color:#555">Arquivos Salvos:</div><div style="display:flex; flex-wrap:wrap;">';
    keptExistingAttachments.forEach((l, i) => {
        h += `<div class="existing-file-link"><span class="material-icons-round" style="font-size:16px; color:var(--primary)">cloud_done</span> <span onclick="window.open('${l}','_blank')">Ver Arquivo ${i + 1}</span><span class="material-icons-round" style="font-size:14px; color:var(--danger); cursor:pointer; margin-left:5px;" onclick="removeExistingAttachment(${i})">close</span></div>`;
    });
    h += '</div>';
    c.innerHTML = h;
}

function popularFiltroUnidades() {
    const list = document.getElementById('list-unidade');
    const currentVal = document.getElementById('filtro-unidade').value;
    const u = [...new Set(tasks.map(t => t.unit).filter(x => x))].sort();
    let html = `<div class="dropdown-item ${currentVal === 'todos' ? 'selected' : ''}" onclick="selectFilter('unidade', 'todos', 'Unidade: Todas', this)">Unidade: Todas</div>`;
    u.forEach(x => {
        const isSel = currentVal === x ? 'selected' : '';
        html += `<div class="dropdown-item ${isSel}" onclick="selectFilter('unidade', '${x}', '${x}', this)">${x}</div>`;
    });
    list.innerHTML = html;
}

function popularFiltroOrigem() {
    const list = document.getElementById('list-origem');
    const currentVal = document.getElementById('filtro-origem').value;
    const o = [...new Set(tasks.map(t => t.origin).filter(x => x && x.trim() !== ''))].sort();
    let html = `<div class="dropdown-item ${currentVal === 'todos' ? 'selected' : ''}" onclick="selectFilter('origem', 'todos', 'Origem: Todas', this)">Origem: Todas</div>`;
    o.forEach(x => {
        const isSel = currentVal === x ? 'selected' : '';
        html += `<div class="dropdown-item ${isSel}" onclick="selectFilter('origem', '${x}', '${x}', this)">${x}</div>`;
    });
    list.innerHTML = html;
}

function filtrarCards(v) {
    termoBusca = v.toLowerCase();
    if (filterTimeout) clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
        aplicarFiltros(true);
    }, 300);
}

function limparFiltros(animar = true) {
    document.getElementById('filtro-status').value = 'todos';
    document.getElementById('filtro-prioridade').value = 'todos';
    document.getElementById('filtro-unidade').value = 'todos';
    document.getElementById('filtro-origem').value = 'todos';
    document.getElementById('lbl-status').innerText = 'Status: Todos';
    document.getElementById('lbl-prioridade').innerText = 'Prioridade: Todas';
    document.getElementById('lbl-unidade').innerText = 'Unidade: Todas';
    document.getElementById('lbl-origem').innerText = 'Origem: Todas';
    document.querySelectorAll('.dropdown-item').forEach(d => d.classList.remove('selected'));
    document.querySelectorAll('.dropdown-options').forEach(optContainer => {
        if (optContainer.children[0]) optContainer.children[0].classList.add('selected');
    });

    termoBusca = "";
    const searchInput = document.querySelector('.search-input');
    if (searchInput) searchInput.value = "";
    aplicarFiltros(animar);
}

/* --- LÓGICA DE FILTRO E RENDERIZAÇÃO OTIMIZADA --- */

function aplicarFiltros(animar = true) {
    const fs = document.getElementById('filtro-status').value;
    const fp = document.getElementById('filtro-prioridade').value;
    const fu = document.getElementById('filtro-unidade').value;
    const fo = document.getElementById('filtro-origem').value;
    const btn = document.getElementById('btn-limpar');

    const deveMostrar = (fs !== 'todos' || fp !== 'todos' || fu !== 'todos' || fo !== 'todos' || termoBusca !== "");
    if (deveMostrar) btn.classList.add('visible');
    else btn.classList.remove('visible');

    // Filtra os dados
    const f = tasks.filter(t => {
        const tTitle = (t.title || "").toLowerCase();
        const tResp = (t.resp || "").toLowerCase();
        const tUnit = (t.unit || "").toLowerCase();

        const mB = termoBusca === "" || tTitle.includes(termoBusca) || tResp.includes(termoBusca) || tUnit.includes(termoBusca);
        const mS = fs === 'todos' || normalizarTexto(t.status) === fs;
        const mP = fp === 'todos' || (t.priority || 'baixa') === fp;
        const mU = fu === 'todos' || t.unit === fu;
        const mO = fo === 'todos' || (t.origin && t.origin === fo);

        return mB && mS && mP && mU && mO;
    });

    // Ordena os dados
    const hj = new Date().toISOString().split('T')[0];
    f.sort((a, b) => {
        const stA = normalizarTexto(a.status), stB = normalizarTexto(b.status);
        const isConcA = (stA === 'concluido'), isConcB = (stB === 'concluido');
        if (isConcA && !isConcB) return 1;
        if (!isConcA && isConcB) return -1;
        const dDueA = dataParaInput(a.dateDue), dDueB = dataParaInput(b.dateDue);
        const isLateA = (dDueA && dDueA < hj && dDueA !== ""), isLateB = (dDueB && dDueB < hj && dDueB !== "");
        if (isLateA && !isLateB) return -1;
        if (!isLateA && isLateB) return 1;
        if (isLateA && isLateB) {
            if (dDueA < dDueB) return -1;
            if (dDueA > dDueB) return 1;
        }
        const mapPrio = { 'alta': 3, 'media': 2, 'baixa': 1 };
        const pA = mapPrio[a.priority || 'baixa'] || 1, pB = mapPrio[b.priority || 'baixa'] || 1;
        if (pA > pB) return -1;
        if (pA < pB) return 1;
        return b.id - a.id;
    });

    renderGrid(f, animar);
}

// --- NOVA FUNÇÃO PRINCIPAL: Renderiza o Grid em Lotes ---
function renderGrid(l, animar = true) {
    // Reinicia o estado da lista
    currentFilteredTasks = l;
    itemsRendered = 0;
    grid.innerHTML = "";

    if (l.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:80px;color:#94a3b8"><span class="material-icons-round" style="font-size:40px">filter_list_off</span><h3>Nada encontrado</h3></div>`;
        return;
    }

    // Renderiza o primeiro lote
    renderNextBatch(animar);
}

// --- NOVA FUNÇÃO AUXILIAR: Adiciona o próximo lote ao DOM ---
function renderNextBatch(animar = true) {
    if (isRendering) return;
    isRendering = true;

    const nextBatch = currentFilteredTasks.slice(itemsRendered, itemsRendered + ITEMS_PER_BATCH);
    const fragment = document.createDocumentFragment();
    const hj = new Date().toISOString().split('T')[0];

    nextBatch.forEach((t, i) => {
        // Cálculo de índice global para delay da animação (se desejar)
        const globalIndex = itemsRendered + i;

        const st = normalizarTexto(t.status);
        const dDue = dataParaInput(t.dateDue);
        const isLate = (dDue && dDue < hj && st !== 'concluido');
        const isConc = (st === 'concluido');
        const isOnt = (dDue && !isLate && !isConc);

        const respH = t.resp ? t.resp.split(',').map((r, idx) => getAvatarHTML(r, idx)).join('') : '<span style="font-size:0.7rem;color:#94a3b8; padding-left:10px;">--</span>';
        const stInfo = st === 'pendente' ? { l: 'A Fazer', c: 'st-pendente' } : st === 'andamento' ? { l: 'Andamento', c: 'st-andamento' } : { l: 'Concluído', c: 'st-concluido' };
        const corBarra = st === 'pendente' ? 'rgba(0,0,0,0.05)' : st === 'andamento' ? '#f59e0b' : '#059669';
        const prio = t.priority || 'baixa';
        const pL = { 'alta': 'Alta', 'media': 'Média', 'baixa': 'Baixa' }[prio] || 'Baixa';
        const pC = { 'alta': 'p-alta', 'media': 'p-media', 'baixa': 'p-baixa' }[prio] || 'p-baixa';
        const pI = prio === 'alta' ? 'priority_high' : prio === 'media' ? 'remove' : 'keyboard_arrow_down';

        let dtH = isLate ? `<span class="date-pill late">Atrasado</span>` : isOnt ? `<span class="date-pill ontime">Em dia</span>` : (!dDue && !isConc) ? `<span class="date-pill nodate">S/ Prazo</span>` : '';

        let thH = '';
        if (t.attachments) {
            let lks = t.attachments.toString().includes("|||") ? t.attachments.split('|||').filter(x => x) : t.attachments.split(',').filter(x => x);
            if (lks.length > 0) {
                let innerTh = '';
                for (let j = 0; j < Math.min(lks.length, 3); j++) innerTh += `<a href="${lks[j]}" target="_blank" class="thumb-link" onclick="event.stopPropagation()"><span class="material-icons-round" style="font-size:16px">description</span></a>`;
                if (lks.length > 3) innerTh += `<div class="thumb-more">+${lks.length - 3}</div>`;
                thH = `<div class="card-thumbs">${innerTh}</div>`;
            }
        }
        if (!thH) thH = `<div class="card-thumbs"></div>`;

        const isPinned = pinnedItems.some(p => String(p.id) === String(t.id));
        const pinClass = isPinned ? 'active' : '';

        const c = document.createElement('div');
        c.className = `card ${animar ? 'animate-in' : 'no-anim'} ${isLate ? 'is-late' : ''} ${isConc ? 'is-concluded' : ''}`;
        c.onclick = () => abrirModal(t.id, event);
        
        // Animação apenas nos primeiros elementos para não travar
        if (animar && globalIndex < 10) c.style.animationDelay = `${i * 0.05}s`;

        c.innerHTML = `
            <div class="card-main">
                <div class="btn-pin-card ${pinClass}" onclick="togglePin('${t.id}', event)" title="${isPinned ? 'Desafixar' : 'Fixar por 24h'}">
                    <span class="material-icons-round" style="font-size:16px">push_pin</span>
                </div>
                <div class="card-header-top">
                    <div class="prio-badge ${pC}"><span class="material-icons-round" style="font-size:10px">${pI}</span> ${pL}</div>
                    <div class="status-text ${stInfo.c}"><div class="dot-status"></div> ${stInfo.l}</div>
                </div>
                <h3 title="${t.title}">${t.title}</h3>
                <div class="card-origin-row"><span class="material-icons-round card-icon-std">history_edu</span> ${t.origin || 'N/A'}</div>
                ${thH}
                <div class="card-meta">
                    <div class="meta-item"><span class="material-icons-round card-icon-std">event</span> ${formatarData(t.dateStart)}</div>
                    <div class="meta-item"><span class="material-icons-round" style="font-size:16px;color:${isLate ? 'var(--danger)' : 'inherit'}">event_busy</span> ${formatarData(t.dateDue)} ${dtH}</div>
                </div>
            </div>
            <div class="card-footer"><div class="resp-container">${respH}</div><div class="unit-clean"><span class="material-icons-round card-icon-std">apartment</span> ${t.unit || 'N/A'}</div></div>
            <div class="card-progress-bar"><div class="progress-fill" style="width:100%;background:${corBarra}"></div></div>`;

        fragment.appendChild(c);
    });

    grid.appendChild(fragment);
    itemsRendered += nextBatch.length;
    
    // Pequeno delay para liberar a thread
    setTimeout(() => { isRendering = false; }, 50);
}

async function buscarFoto(nome) {
    if (!nome) return null;
    if (photoCache[nome] !== undefined) return photoCache[nome];
    if (buscandoAgora.has(nome)) return null;
    buscandoAgora.add(nome);
    try {
        const res = await fetch(`${API_URL}?action=getPhoto&name=${encodeURIComponent(nome)}&token=${API_TOKEN}`);
        const data = await res.json();
        if (data.url) {
            photoCache[nome] = data.url;
            document.querySelectorAll(`.avatar-stack-item[data-name="${nome}"]`).forEach(el => {
                el.innerHTML = `<img src="${data.url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                el.className = el.className.replace(/av-color-\d/g, "");
                el.style.backgroundColor = "transparent";
            });
            document.querySelectorAll(`.avatar-wrapper[data-name="${nome}"]`).forEach(wrapper => {
                const divBolinha = wrapper.querySelector('div.modal-avatar-big');
                if (divBolinha) divBolinha.remove();
                if (!wrapper.querySelector('img')) {
                    const img = document.createElement('img');
                    img.src = data.url;
                    img.className = 'modal-avatar-big';
                    wrapper.appendChild(img);
                }
            });
            buscandoAgora.delete(nome);
            return data.url;
        } else {
            photoCache[nome] = null;
            buscandoAgora.delete(nome);
        }
    } catch (e) {
        photoCache[nome] = null;
        buscandoAgora.delete(nome);
    }
    return null;
}

function getAvatarHTML(nomeStr, index) {
    if (!nomeStr) return '';
    const nomeTrim = formatarNomeProprio(nomeStr.trim());
    if (!nomeTrim || !nomeTrim.includes(' ')) return '';
    const url = photoCache[nomeTrim];
    const colorIndex = nomeTrim.length % 6;
    const fallbackClass = `av-color-${colorIndex}`;
    const zIdx = 10 - index;
    if (url) return `<div class="avatar-stack-item" style="z-index:${zIdx}" title="${nomeTrim}" data-name="${nomeTrim}"><img src="${url}" alt="${nomeTrim[0]}" onerror="this.style.display='none';this.parentNode.classList.add('${fallbackClass}');this.parentNode.innerText='${nomeTrim[0]}' "></div>`;
    if (photoCache[nomeTrim] === undefined) buscarFoto(nomeTrim);
    return `<div class="avatar-stack-item ${fallbackClass}" style="z-index:${zIdx}" title="${nomeTrim}" data-name="${nomeTrim}">${nomeTrim[0].toUpperCase()}</div>`;
}

function checkPinnedExpiration() {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const validPins = pinnedItems.filter(p => (now - p.time) < oneDay);
    if (validPins.length !== pinnedItems.length) {
        pinnedItems = validPins;
        localStorage.setItem('fav_pinned_tasks', JSON.stringify(pinnedItems));
    }
    renderPinnedSection();
}

function togglePin(id, e) {
    if (e) e.stopPropagation();
    const now = Date.now();
    const idx = pinnedItems.findIndex(p => String(p.id) === String(id));

    if (idx > -1) {
        const pinnedCard = document.querySelector(`.pinned-card[onclick*="${id}"]`);
        if (pinnedCard) {
            pinnedCard.classList.add('animate-leave');
            setTimeout(() => {
                pinnedItems.splice(idx, 1);
                localStorage.setItem('fav_pinned_tasks', JSON.stringify(pinnedItems));
                renderPinnedSection();
            }, 280);
        } else {
            pinnedItems.splice(idx, 1);
            localStorage.setItem('fav_pinned_tasks', JSON.stringify(pinnedItems));
            renderPinnedSection();
        }
    } else {
        pinnedItems.push({ id: id, time: now });
        localStorage.setItem('fav_pinned_tasks', JSON.stringify(pinnedItems));
        renderPinnedSection();
    }

    const pinBtn = document.querySelector(`.card .btn-pin-card[onclick*="${id}"]`);
    if (pinBtn) {
        pinBtn.classList.toggle('active');
        const isPinnedNow = pinBtn.classList.contains('active');
        pinBtn.setAttribute('title', isPinnedNow ? 'Desafixar' : 'Fixar por 24h');
    }
}

function renderPinnedSection() {
    const container = document.getElementById('pinnedSection');
    const gridPin = document.getElementById('pinnedGrid');
    const pinnedTasks = [];
    pinnedItems.forEach(p => {
        const t = tasks.find(x => String(x.id) === String(p.id));
        if (t) pinnedTasks.push(t);
    });

    if (pinnedTasks.length === 0) {
        container.classList.remove('visible');
        setTimeout(() => { if (!container.classList.contains('visible')) container.style.display = 'none'; }, 300);
        return;
    }

    container.style.display = 'flex';
    requestAnimationFrame(() => container.classList.add('visible'));

    gridPin.innerHTML = "";

    pinnedTasks.forEach(t => {
        const card = document.createElement('div');
        card.className = 'pinned-card animate-enter';
        card.setAttribute('onclick', `abrirModal('${t.id}', event)`);
        const st = normalizarTexto(t.status);
        const corStatus = st === 'concluido' ? 'var(--status-done)' : (st === 'andamento' ? 'var(--warning)' : 'var(--text-light)');
        card.innerHTML = `
            <div style="font-size:0.65rem; font-weight:800; color:${corStatus}; text-transform:uppercase; margin-bottom:5px;">
                ${t.status || 'Pendente'}
            </div>
            <div style="font-weight:700; font-size:0.85rem; color:var(--text-main); margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:20px;">
                ${t.title}
            </div>
            <div style="font-size:0.75rem; color:var(--text-light);">
                ${t.unit || 'N/A'}
            </div>
            <div class="btn-pin-card active" onclick="togglePin('${t.id}', event)" title="Desafixar">
                <span class="material-icons-round" style="font-size:16px">push_pin</span>
            </div>
        `;
        gridPin.appendChild(card);
    });
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function abrirModalNomes(e = null) {
    if (e) e.stopPropagation();
    const container = document.getElementById('namesListContainer');
    container.innerHTML = '';
    let lista = [];
    for (let k in dbNomes) {
        dbNomes[k].forEach(last => lista.push(k + " " + last));
    }
    lista.sort();
    if (lista.length === 0) container.innerHTML = '<div style="padding:20px;text-align:center;color:#aaa;">Nenhum nome encontrado.</div>';
    else {
        lista.forEach(n => {
            const item = document.createElement('div');
            item.className = 'name-list-item';
            item.innerHTML = `<span>${n}</span> <span class="material-icons-round" style="font-size:18px; color:var(--brand-cyan)">add_circle_outline</span>`;
            item.onclick = () => {
                const input = document.getElementById('inpResp');
                let valorAtual = input.value ? input.value.trimEnd() : "";
                input.value = valorAtual.length > 0 ? (valorAtual.endsWith(',') ? valorAtual + " " + n : valorAtual + ", " + n) : n;
                autoResize(input);
                gerenciarInputResponsavel(input);
                showToast(n + " adicionado!", "success");
            };
            container.appendChild(item);
        });
    }
    document.getElementById('modalNomes').style.display = 'flex';
    setTimeout(() => document.getElementById('modalNomes').classList.add('active'), 10);
}

function fecharModalNomes() {
    document.getElementById('modalNomes').classList.remove('active');
    setTimeout(() => document.getElementById('modalNomes').style.display = 'none', 300);
}

function gerenciarInputResponsavel(input) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => atualizarAvatarsModal(input.value), 1500);
}

async function atualizarAvatarsModal(valorInput) {
    const container = document.getElementById('modalAvatarList');
    if (!valorInput) {
        container.innerHTML = '';
        return;
    }
    const nomesFormatados = valorInput.split(/[\n,]/).filter(n => n.trim().length > 0).map(n => formatarNomeProprio(n.trim()));

    Array.from(container.children).forEach(el => {
        const nomeEl = el.querySelector('.avatar-wrapper') ? el.querySelector('.avatar-wrapper').dataset.name : el.getAttribute('data-name');
        if (!nomesFormatados.includes(nomeEl)) el.remove();
    });

    for (const n of nomesFormatados) {
        if (!n.includes(' ')) continue;
        const jaExiste = Array.from(container.children).some(el => {
            const nomeEl = el.querySelector('.avatar-wrapper') ? el.querySelector('.avatar-wrapper').dataset.name : el.getAttribute('data-name');
            return nomeEl === n;
        });
        if (!jaExiste) {
            const wrapper = document.createElement('div');
            wrapper.className = 'avatar-wrapper animate-in';
            wrapper.setAttribute('data-name', n);
            const div = document.createElement('div');
            div.className = `modal-avatar-big av-color-${n.length % 6}`;
            div.innerText = n[0].toUpperCase();
            wrapper.appendChild(div);
            container.appendChild(wrapper);
            buscarFoto(n).then(url => {
                if (url) {
                    div.remove();
                    const img = document.createElement('img');
                    img.src = url;
                    img.className = 'modal-avatar-big';
                    wrapper.appendChild(img);
                }
            });
        }
    }
}

function capturarEstadoAtual() {
    return JSON.stringify({
        title: document.getElementById('inpTitle').value,
        origin: document.getElementById('inpOrigin').value,
        unit: document.getElementById('inpUnit').value,
        priority: document.getElementById('inpPriority').value,
        desc: document.getElementById('inpProblem').value,
        why: document.getElementById('inpWhy').value,
        how: document.getElementById('inpHow').value,
        cost: document.getElementById('inpCost').value,
        obs: document.getElementById('inpObs').value,
        resp: document.getElementById('inpResp').value,
        start: document.getElementById('inpDateStart').value,
        due: document.getElementById('inpDateDue').value,
        status: document.getElementById('selectedStatus').value,
        steps: tempSteps,
        newStepT: document.getElementById('newStepTitle').value,
        newStepD: document.getElementById('newStepDesc').value,
        newStepDt: document.getElementById('newStepDate').value,
        newFilesLen: newFiles.length,
        deletedFilesLen: filesToDelete.length
    });
}

function destacarCamposModificados(estadoDraft, estadoOriginal) {
    document.querySelectorAll('.modified-field').forEach(el => el.classList.remove('modified-field'));
    const draft = JSON.parse(estadoDraft);
    const orig = JSON.parse(estadoOriginal);
    const mapCampos = {
        'title': 'inpTitle',
        'origin': 'inpOrigin',
        'desc': 'inpProblem',
        'why': 'inpWhy',
        'how': 'inpHow',
        'cost': 'inpCost',
        'obs': 'inpObs',
        'resp': 'inpResp'
    };
    for (const key in mapCampos) {
        if (draft[key] !== orig[key]) {
            const el = document.getElementById(mapCampos[key]);
            if (el) el.classList.add('modified-field');
        }
    }
}

function fecharModal(isSaving = false) {
    const m = document.getElementById('modalOverlay');
    if (!isSaving) {
        const id = document.getElementById('taskId').value;
        const title = document.getElementById('inpTitle').value;
        const desc = document.getElementById('inpProblem').value;
        const estadoAtual = capturarEstadoAtual();
        if (estadoAtual !== estadoInicialFormulario && (title || desc)) {
            draftData = {
                id: id,
                title: title,
                origin: document.getElementById('inpOrigin').value,
                unit: document.getElementById('inpUnit').value,
                priority: document.getElementById('inpPriority').value,
                problem: desc,
                why: document.getElementById('inpWhy').value,
                how: document.getElementById('inpHow').value,
                cost: document.getElementById('inpCost').value,
                obs: document.getElementById('inpObs').value,
                resp: document.getElementById('inpResp').value,
                dateStart: document.getElementById('inpDateStart').value,
                dateDue: document.getElementById('inpDateDue').value,
                status: document.getElementById('selectedStatus').value,
                steps: tempSteps,
                newStepT: document.getElementById('newStepTitle').value,
                newStepD: document.getElementById('newStepDesc').value,
                newStepDt: document.getElementById('newStepDate').value,
                newFiles: newFiles,
                originalState: estadoInicialFormulario
            };
            showToast("Rascunho salvo temporariamente", "info");
        } else {
            if (draftData && draftData.id === id) draftData = null;
        }
    } else {
        draftData = null;
    }
    m.classList.remove('active');
    document.body.classList.remove('modal-open');
    setTimeout(() => {
        m.style.display = 'none';
        document.querySelectorAll('.modified-field').forEach(el => el.classList.remove('modified-field'));
    }, 300);
}

function abrirModal(id = null, e = null) {
    if (e) e.stopPropagation();
    pendingIntentId = id;
    if (draftData !== null) {
        if (id !== null && String(draftData.id) === String(id)) {
            prepararModal(id, true);
            return;
        }
        const draftTitle = draftData.title || "(Sem Título)";
        const draftType = draftData.id ? "Editando: " : "Novo: ";
        document.getElementById('txtDraftName').innerText = draftType + draftTitle;
        draftConfirmModal.style.display = 'flex';
        setTimeout(() => draftConfirmModal.classList.add('active'), 10);
        return;
    }
    prepararModal(id);
}

function descartarRascunho() {
    draftData = null;
    draftConfirmModal.classList.remove('active');
    setTimeout(() => {
        draftConfirmModal.style.display = 'none';
        prepararModal(pendingIntentId);
    }, 300);
}

function usarRascunho() {
    draftConfirmModal.classList.remove('active');
    setTimeout(() => {
        draftConfirmModal.style.display = 'none';
        prepararModal(draftData.id || null, true);
    }, 300);
}

function prepararModal(id, useDraft = false) {
    const m = document.getElementById('modalOverlay');
    m.style.display = 'flex';
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            m.classList.add('active');
            const body = document.querySelector('.modal-body-dashboard');
            if (body) body.scrollTop = 0;
        });
    });

    const isEdit = id !== null && id !== "";
    editingStepIndex = -1;
    document.getElementById('newStepDesc').value = '';
    document.getElementById('newStepDate').value = '';
    document.getElementById('newStepTitle').value = '';
    filesToDelete = [];
    keptExistingAttachments = [];
    document.getElementById('existingAttachmentsArea').innerHTML = '';
    const ti = document.getElementById('inpTitle');
    document.getElementById('modalAvatarList').innerHTML = "";

    let source = useDraft ? draftData : (isEdit ? tasks.find(x => String(x.id) === String(id)) : null);

    if (source) {
        document.getElementById('taskId').value = source.id || (useDraft ? '' : source.id);
        ti.value = source.title;
        setTimeout(() => autoResize(ti), 10);
        document.getElementById('inpUnit').value = source.unit;
        document.getElementById('display-unit').innerText = source.unit || 'Selecionar...';
        document.getElementById('inpPriority').value = source.priority;
        document.getElementById('display-prio').innerText = (source.priority === 'alta' ? 'Alta' : source.priority === 'media' ? 'Média' : 'Baixa');
        document.getElementById('inpOrigin').value = source.origin;
        document.getElementById('inpProblem').value = source.problem || source.desc || "";
        document.getElementById('inpWhy').value = source.why || "";
        document.getElementById('inpHow').value = source.how || "";
        document.getElementById('inpCost').value = source.cost || "";
        document.getElementById('inpObs').value = source.obs || "";
        document.getElementById('inpResp').value = source.resp;
        setTimeout(() => autoResize(document.getElementById('inpResp')), 10);
        if (source.resp) atualizarAvatarsModal(source.resp);
        document.getElementById('inpDateStart').value = useDraft ? source.dateStart : dataParaInput(source.dateStart);
        document.getElementById('inpDateDue').value = useDraft ? source.dateDue : dataParaInput(source.dateDue);
        updateStatusUI(useDraft ? source.status : normalizarTexto(source.status));
        tempSteps = source.steps ? [...source.steps] : [];

        if (useDraft) {
            newFiles = source.newFiles ? [...source.newFiles] : [];
            document.getElementById('newStepTitle').value = source.newStepT || '';
            document.getElementById('newStepDesc').value = source.newStepD || '';
            document.getElementById('newStepDate').value = source.newStepDt || '';
            if (source.id) {
                const original = tasks.find(x => String(x.id) === String(source.id));
                if (original && original.attachments) {
                    keptExistingAttachments = original.attachments.toString().includes("|||") ? original.attachments.split('|||').filter(x => x) : original.attachments.split(',').filter(x => x);
                    renderExistingAttachments();
                }
            }
        } else {
            newFiles = [];
            if (source.attachments) {
                keptExistingAttachments = source.attachments.toString().includes("|||") ? source.attachments.split('|||').filter(x => x) : source.attachments.split(',').filter(x => x);
                renderExistingAttachments();
            }
        }

        renderFilePreview();
        if (useDraft && source.originalState) {
            setTimeout(() => destacarCamposModificados(capturarEstadoAtual(), source.originalState), 100);
        }
    } else {
        document.getElementById('taskId').value = '';
        ti.value = '';
        ti.style.height = '50px';
        document.getElementById('inpUnit').value = '';
        document.getElementById('display-unit').innerText = 'Selecionar...';
        document.getElementById('inpPriority').value = 'baixa';
        document.getElementById('display-prio').innerText = 'Baixa';
        document.getElementById('inpOrigin').value = '';
        document.getElementById('inpProblem').value = '';
        document.getElementById('inpWhy').value = '';
        document.getElementById('inpHow').value = '';
        document.getElementById('inpCost').value = '';
        document.getElementById('inpObs').value = '';
        const hj = new Date(),
            y = hj.getFullYear(),
            m = String(hj.getMonth() + 1).padStart(2, '0'),
            d = String(hj.getDate()).padStart(2, '0');
        document.getElementById('inpDateStart').value = `${y}-${m}-${d}`;
        document.getElementById('inpDateDue').value = '';
        updateStatusUI('pendente');
        document.getElementById('inpResp').value = '';
        document.getElementById('inpResp').style.height = '46px';
        tempSteps = [];
        newFiles = [];
        renderFilePreview();
    }

    renderTimeline();
    setTimeout(() => {
        estadoInicialFormulario = (useDraft && draftData && draftData.originalState) ? draftData.originalState : capturarEstadoAtual();
    }, 50);
    document.body.classList.add('modal-open');
}

function fecharDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    setTimeout(() => document.getElementById('deleteModal').style.display = 'none', 300);
}

function fecharAlertModal() {
    document.getElementById('alertModal').classList.remove('active');
    setTimeout(() => document.getElementById('alertModal').style.display = 'none', 300);
}

function acionarCalendario(wrapper) {
    const input = wrapper.querySelector('input');
    if (input) {
        if (input.showPicker) input.showPicker();
        else {
            input.focus();
            input.click();
        }
    }
}

function renderTimeline(novoItemIndex = -1) {
    timelineList.innerHTML = "";
    tempSteps.forEach((s, i) => {
        const el = document.createElement('div');
        el.className = 'map-item';
        if (i === novoItemIndex) el.classList.add('new-item');
        el.innerHTML = `
            <div class="map-connector"></div><div class="map-dot"></div>
            <div class="map-card" onclick="toggleMapCard(this)">
                <div class="map-card-header">
                    <div class="map-header-left"><span class="map-title">${s.title || "Sem Título"}</span><span class="map-date">${s.date ? formatarData(s.date) : "Data N/A"}</span></div>
                    <div class="map-header-right" onclick="event.stopPropagation()">
                        <span class="material-icons-round map-btn-icon" onclick="prepararEdicao(${i}, event)" title="Editar">edit</span>
                        <span class="material-icons-round map-btn-icon del" onclick="removeStep(${i}, event)" title="Excluir">delete</span>
                        <span class="material-icons-round toggle-icon" onclick="toggleMapCard(this.closest('.map-card'))">expand_more</span>
                    </div>
                </div>
                <div class="map-card-body"><div class="map-card-content-inner"><div class="map-desc">${s.desc || '<span style="color:#ccc;font-style:italic;">Sem descrição detalhada.</span>'}</div></div></div>
            </div>`;
        timelineList.appendChild(el);
    });
    if (novoItemIndex > -1) setTimeout(() => timelineList.lastElementChild.scrollIntoView({
        behavior: 'smooth'
    }), 100);
}

function toggleMapCard(card) {
    if (card.classList.contains('open')) card.classList.remove('open');
    else card.classList.add('open');
}

function prepararEdicao(i, e) {
    if (e) e.stopPropagation();
    const s = tempSteps[i];
    document.getElementById('newStepTitle').value = s.title || "";
    document.getElementById('newStepDesc').value = s.desc || "";
    document.getElementById('newStepDate').value = s.date ? dataParaInput(s.date) : '';
    editingStepIndex = i;
    btnAddStep.innerText = "Salvar Alteração";
    document.getElementById('newStepTitle').focus();
    document.getElementById('newStepTitle').scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
}

function adicionarPasso() {
    const t = document.getElementById('newStepTitle').value;
    const d = document.getElementById('newStepDesc').value;
    const dt = document.getElementById('newStepDate').value;
    if (!t && !d) return document.getElementById('newStepTitle').focus();
    const passoObj = {
        title: t,
        desc: d,
        date: dt
    };
    let novoIndex = -1;
    if (editingStepIndex > -1) {
        tempSteps[editingStepIndex] = passoObj;
        editingStepIndex = -1;
        btnAddStep.innerText = "Adicionar ao Mapa";
    } else {
        tempSteps.push(passoObj);
        novoIndex = tempSteps.length - 1;
    }
    renderTimeline(novoIndex);
    document.getElementById('newStepTitle').value = '';
    document.getElementById('newStepDesc').value = '';
    document.getElementById('newStepDate').value = '';
}

function removeStep(i, e) {
    if (e) e.stopPropagation();
    const el = timelineList.children[i];
    if (el) {
        el.classList.add('removing');
        setTimeout(() => {
            tempSteps.splice(i, 1);
            renderTimeline();
        }, 450);
    } else {
        tempSteps.splice(i, 1);
        renderTimeline();
    }
}

function setStatus(e) {
    updateStatusUI(e.getAttribute('data-val'));
}

function updateStatusUI(v) {
    document.getElementById('selectedStatus').value = v;
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.seg-btn[data-val="${v}"]`).classList.add('active');
}

modal.onclick = (e) => {
    if (e.target === modal) fecharModal()
};
deleteModal.onclick = (e) => {
    if (e.target === deleteModal) fecharDeleteModal()
};
attachmentDeleteModal.onclick = (e) => {
    if (e.target === attachmentDeleteModal) fecharModalAnexo()
};
alertModal.onclick = (e) => {
    if (e.target === alertModal) fecharAlertModal()
};
modalNomes.onclick = (e) => {
    if (e.target === modalNomes) fecharModalNomes()
};
draftConfirmModal.onclick = (e) => {
    if (e.target === draftConfirmModal) descartarRascunho()
};
pinModal.onclick = (e) => {
    if (e.target === pinModal) fecharPinModal()
};

function toggleStats(e) {
    isStatsOpen = !isStatsOpen;
    const btn = document.getElementById('btnStats');
    if (isStatsOpen) {
        statsPanel.classList.add('open');
        btn.classList.add('active');
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
        if (tasks.length > 0) setTimeout(() => atualizarGraficos(), 300);
    } else {
        statsPanel.classList.remove('open');
        btn.classList.remove('active');
    }
}

function atualizarGraficos() {
    if (!isStatsOpen) return;
    if (chartStatusInstance) chartStatusInstance.destroy();
    if (chartPrazosInstance) chartPrazosInstance.destroy();
    if (chartUnitInstance) chartUnitInstance.destroy();
    if (chartRespInstance) chartRespInstance.destroy();

    const statsStatus = {
        pendente: 0,
        andamento: 0,
        concluido: 0
    };
    tasks.forEach(t => {
        let s = normalizarTexto(t.status);
        if (statsStatus[s] !== undefined) statsStatus[s]++;
        else statsStatus.pendente++;
    });

    const hj = new Date().toISOString().split('T')[0];
    let atrasados = 0,
        noPrazo = 0,
        semPrazo = 0;
    tasks.forEach(t => {
        if (normalizarTexto(t.status) === 'concluido') return;
        const d = dataParaInput(t.dateDue);
        if (!d) semPrazo++;
        else if (d < hj) atrasados++;
        else noPrazo++;
    });

    const unitMap = {},
        respMap = {};
    tasks.forEach(t => {
        const u = t.unit || 'Sem Unidade';
        unitMap[u] = (unitMap[u] || 0) + 1;
        if (t.resp) t.resp.split(',').forEach(r => {
            const name = formatarNomeProprio(r.trim());
            if (name) respMap[name] = (respMap[name] || 0) + 1;
        });
    });
    const sortedResp = Object.entries(respMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const ctxStatus = document.getElementById('chartStatus').getContext('2d');
    chartStatusInstance = new Chart(ctxStatus, {
        type: 'doughnut',
        data: {
            labels: ['A Fazer', 'Andamento', 'Concluído'],
            datasets: [{
                data: [statsStatus.pendente, statsStatus.andamento, statsStatus.concluido],
                backgroundColor: ['#cbd5e1', '#f59e0b', '#059669'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 10
                    }
                }
            }
        }
    });
    const ctxPrazos = document.getElementById('chartPrazos').getContext('2d');
    chartPrazosInstance = new Chart(ctxPrazos, {
        type: 'doughnut',
        data: {
            labels: ['Em Dia', 'Atrasado', 'S/ Prazo'],
            datasets: [{
                data: [noPrazo, atrasados, semPrazo],
                backgroundColor: ['#10b981', '#ef4444', '#e2e8f0'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 10
                    }
                }
            }
        }
    });
    const ctxUnit = document.getElementById('chartUnit').getContext('2d');
    chartUnitInstance = new Chart(ctxUnit, {
        type: 'doughnut',
        data: {
            labels: Object.keys(unitMap),
            datasets: [{
                label: 'Ocorrências',
                data: Object.values(unitMap),
                backgroundColor: ['#0f4c81', '#00d2d3', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 10
                    }
                }
            }
        }
    });
    const containerResp = document.getElementById('respChartContainer');
    containerResp.style.height = (sortedResp.length * 40 + 50) + 'px';
    const ctxResp = document.getElementById('chartResp').getContext('2d');
    chartRespInstance = new Chart(ctxResp, {
        type: 'bar',
        indexAxis: 'y',
        data: {
            labels: sortedResp.map(i => i[0]),
            datasets: [{
                label: 'Tarefas Ativas',
                data: sortedResp.map(i => i[1]),
                backgroundColor: '#00d2d3',
                borderRadius: 4,
                barPercentage: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    beginAtZero: true,
                    padding: {
                        left: 35
                    }
                }
            }
        }
    });
}