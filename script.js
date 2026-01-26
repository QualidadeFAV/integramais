/* * FAV ANALYTICS - CORE V98 FINAL
 * Features: Tooltips Descritivos (Hover) + Fix Centralização Batida %
 */

const API_URL = "https://script.google.com/macros/s/AKfycbw_bHMpDh_8hUZvr0LbWA-IGfPrMmfEbkKN0he_n1FSkRdZRXOfFiGdNv_5G8rOq-bs/exec";

// Inicializa ícones
lucide.createIcons();
const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// --- ESTADO GLOBAL ---
let fullDB = { "2025": [], "2026": [] };
let currentYear = '2025';
let currentSector = 'Todos';
let currentView = 'table';
let currentTheme = localStorage.getItem('fav_theme') || 'dark';
let deadlineDay = parseInt(localStorage.getItem('fav_deadline')) || 15;
let charts = {}; 
let chartInstance = null;
let currentMetricId = null;
let isNewSectorMode = false;
let statusChartMode = 'last'; 

// --- INICIALIZAÇÃO ---
window.onload = () => {
    applyTheme(currentTheme, false); 
    loadData();
};

async function loadData() {
    toggleLoading(true);
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        
        if (Array.isArray(data)) {
            fullDB["2025"] = data;
            fullDB["2026"] = [];
        } else {
            fullDB = data;
            if (!fullDB["2025"]) fullDB["2025"] = [];
            if (!fullDB["2026"]) fullDB["2026"] = [];
        }
        renderApp();
    } catch (e) {
        console.error(e);
        showToast("Modo Offline (Erro Conexão)", "error");
    } finally {
        toggleLoading(false);
    }
}

async function saveData() {
    showToast("Salvando...", "wait");
    try {
        await fetch(API_URL, { method: 'POST', body: JSON.stringify(fullDB) });
        showToast("Sincronizado!");
    } catch (e) {
        showToast("Erro ao salvar!", "error");
    }
}

// --- TEMA (ANIMAÇÃO CONTROLADA) ---
function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('fav_theme', currentTheme);
    applyTheme(currentTheme, true);
    
    // Recarrega gráficos se estiverem visíveis para pegar novas cores
    if (currentView === 'exec') {
        renderApp(); 
    }
}

function applyTheme(theme, animate = false) {
    document.body.setAttribute('data-theme', theme);
    const btn = document.querySelector('button[onclick="toggleTheme()"]');
    if (btn) {
        const iconName = theme === 'light' ? 'moon' : 'sun';
        const className = animate ? 'icon-spin' : '';
        btn.innerHTML = `<i id="theme-icon" class="${className}" data-lucide="${iconName}"></i>`;
        lucide.createIcons();
        if (animate) {
            setTimeout(() => {
                const icon = document.getElementById('theme-icon');
                if (icon) icon.classList.remove('icon-spin');
            }, 600);
        }
    }
}

// --- RENDERIZAÇÃO ---
function renderApp(filter = currentSector) {
    populateSectorFilter();
    const data = fullDB[currentYear] || [];
    const filtered = filter === 'Todos' ? data : data.filter(i => i.sector === filter);

    updateKPIs(filtered);

    if (currentView === 'table') {
        renderTable(filtered);
    } else {
        renderExecutiveCharts(filtered);
    }
    
    document.getElementById('btn-2025').classList.toggle('active', currentYear === '2025');
    document.getElementById('btn-2026').classList.toggle('active', currentYear === '2026');
    lucide.createIcons();
}

// --- LÓGICA DE PONTUALIDADE ---
function checkOnTime(dateStr, monthIdx) {
    if (!dateStr) return false;
    const delivery = new Date(dateStr + "T12:00:00");
    const curYear = parseInt(currentYear);
    const minDate = new Date(curYear, monthIdx, 1, 0, 0, 0);
    
    let limitYear = curYear;
    let limitMonth = monthIdx + 1; 
    if (limitMonth > 11) {
        limitMonth = 0; 
        limitYear++;
    }
    const limitDate = new Date(limitYear, limitMonth, deadlineDay, 23, 59, 59);
    
    return delivery >= minDate && delivery <= limitDate;
}

// --- STATUS ---
function getStatus(val, meta, logic, fmt) {
    if (val === null || val === "" || val === "NaN") return "empty";
    let v, m;
    
    if (fmt === 'time') {
        v = timeToDec(val);
        m = timeToDec(meta);
    } else {
        let sVal = String(val).replace(',', '.');
        let sMeta = String(meta).replace(',', '.');
        v = parseFloat(sVal);
        m = parseFloat(sMeta);
    }
    
    if (isNaN(v) || isNaN(m)) return "empty";
    
    if (logic === 'maior') {
        return v >= m ? 'good' : 'bad';
    } else {
        return v <= m ? 'good' : 'bad';
    }
}

// --- FORMATADORES ---
function formatVal(v, f) {
    if (v === null || v === undefined || v === "" || v === "NaN") return "-";
    
    if (f === 'time') {
        let str = String(v);
        const match = str.match(/(\d{1,2}):(\d{2})/);
        if (match) return `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`;
        return str;
    }
    
    let num;
    if (typeof v === 'string') {
        const clean = v.replace(/[^\d.,\-]/g, '').replace(',', '.');
        num = parseFloat(clean);
    } else {
        num = parseFloat(v);
    }
    
    if (isNaN(num)) return "-";
    
    const br = num.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

    switch (f) {
        case 'money': return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        case 'percent': return num.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
        case 'minutes': return br + ' min';
        case 'days': return br + ' dias';
        case 'years': return br + ' anos';
        case 'm3': return br + ' m³';
        case 'liters': return br + ' L';
        case 'ml': return br + ' ml';
        case 'kg': return br + ' kg';
        case 'kwh': return br + ' kWh';
        case 'gas': return br + ' bot.';
        case 'cm': return br + ' cm';
        case 'package': return br + ' pct';
        case 'patients': return br + ' pac.';
        default: return br;
    }
}

function timeToDec(t) {
    if (!t || typeof t !== 'string') return NaN;
    const match = t.match(/(\d{1,2}):(\d{2})/);
    if (match) return parseFloat(match[1]) + (parseFloat(match[2]) / 60);
    return NaN; 
}

// --- KPIs ---
function updateKPIs(data) {
    let totalPerf = 0, hitsPerf = 0;
    let countCrit = 0;
    let puncTotal = 0, puncHits = 0;

    data.forEach(item => {
        // Performance
        item.data.forEach(val => {
            if (val !== null && val !== "") {
                const st = getStatus(val, item.meta, item.logic, item.format);
                if (st !== 'empty') {
                    totalPerf++;
                    if (st === 'good') hitsPerf++;
                    if (st === 'bad') countCrit++;
                }
            }
        });

        // Pontualidade
        if (item.dates) {
            item.dates.forEach((d, i) => {
                if (item.data[i] !== null && item.data[i] !== "") {
                    puncTotal++;
                    if (checkOnTime(d, i)) puncHits++;
                }
            });
        }
    });

    const perf = totalPerf ? Math.round((hitsPerf / totalPerf) * 100) : 0;
    const punc = puncTotal ? Math.round((puncHits / puncTotal) * 100) : 0;

    setText('kpi-perf', perf + "%");
    setText('kpi-punc', punc + "%");
    setText('kpi-crit', countCrit);
}

// --- TABELA ---
function renderTable(data) {
    const tbody = document.getElementById('table-body');
    const emptyState = document.getElementById('empty-state');
    const tableEl = document.querySelector('#main-table');
    tbody.innerHTML = '';

    if (!data.length) {
        tableEl.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }
    
    tableEl.style.display = 'table';
    emptyState.style.display = 'none';

    const sectors = currentSector === 'Todos' ? [...new Set(data.map(i => i.sector))].sort() : [currentSector];
    let delayCounter = 0;

    sectors.forEach(sec => {
        const items = data.filter(i => i.sector === sec);
        if (items.length === 0) return;

        if (currentSector === 'Todos') {
            tbody.innerHTML += `<tr class="sector-header cascade-item" style="animation-delay: ${delayCounter * 30}ms"><td colspan="14">${sec}</td></tr>`;
            delayCounter++;
        }

        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = 'cascade-item';
            tr.style.animationDelay = `${delayCounter * 30}ms`;
            delayCounter++;
            
            const logicLabel = item.logic === 'maior' ? 'Maior Melhor ↑' : 'Menor Melhor ↓';

            let html = `
                <td class="col-name" onclick="openMainModal(${item.id})">${item.name}</td>
                <td class="col-meta" onclick="openMainModal(${item.id})">
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;">
                        <span>${formatVal(item.meta, item.format)}</span>
                        <span style="font-size:0.55rem; opacity:0.8; margin-top:2px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">${logicLabel}</span>
                    </div>
                </td>
            `;

            for (let i = 0; i < 12; i++) {
                const val = item.data[i];
                const status = getStatus(val, item.meta, item.logic, item.format);
                
                let cls = 'cell-empty';
                if (status === 'good') cls = 'cell-good';
                else if (status === 'bad') cls = 'cell-bad';

                html += `<td class="${cls}" onclick="openMonthModal(${item.id}, ${i})">
                    ${formatVal(val, item.format)}
                </td>`;
            }
            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    });
}

// --- GRÁFICOS EXECUTIVOS ---
function renderExecutiveCharts(data) {
    if (currentView !== 'exec') return;
    
    const cards = document.querySelectorAll('.chart-card');
    cards.forEach((card, i) => {
        card.classList.remove('cascade-item'); 
        void card.offsetWidth; 
        card.classList.add('cascade-item');
        card.style.animationDelay = `${i * 100}ms`;
    });

    renderTrendChart(data);
    renderStatusChart(data);
    renderPuncChart(data);
}

function getChartColors() {
    const isDark = currentTheme === 'dark';
    return {
        text: isDark ? '#a1a1aa' : '#52525b',
        grid: isDark ? '#27272a' : '#d4d4d8',
        bg:   isDark ? '#18181b' : '#ffffff',
        title: isDark ? '#ffffff' : '#18181b'
    };
}

function renderTrendChart(data) {
    const ctxTrend = document.getElementById('chart-trend').getContext('2d');
    if (charts.trend) charts.trend.destroy();

    const colors = getChartColors();
    const gradientTrend = ctxTrend.createLinearGradient(0, 300, 0, 0);
    gradientTrend.addColorStop(0, '#1e3a8a');
    gradientTrend.addColorStop(1, '#3b82f6');

    const mAvg = Array(12).fill(0);
    const mCount = Array(12).fill(0);

    data.forEach(item => {
        item.data.forEach((val, i) => {
            if (val !== null && val !== "") {
                const st = getStatus(val, item.meta, item.logic, item.format);
                if (st !== 'empty') {
                    mAvg[i] += (st === 'good' ? 100 : 0);
                    mCount[i]++;
                }
            }
        });
    });

    const trendData = mAvg.map((s, i) => mCount[i] ? Math.round(s / mCount[i]) : 0);

    const dataLabelPlugin = {
        id: 'customDataLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            chart.data.datasets.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i);
                meta.data.forEach((bar, index) => {
                    const value = dataset.data[index];
                    if (value > 0) {
                        ctx.fillStyle = '#ffffff'; 
                        ctx.font = 'bold 10px Inter, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(value + '%', bar.x, bar.y + 15);
                    }
                });
            });
        }
    };

    charts.trend = new Chart(ctxTrend, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: '% Performance',
                data: trendData,
                backgroundColor: gradientTrend,
                borderRadius: 4,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: function(context) { return context.parsed.y + '% de Aproveitamento'; } } }
            },
            scales: {
                y: { beginAtZero: true, max: 100, grid: { color: colors.grid }, ticks: { color: colors.text, stepSize: 25 } },
                x: { grid: { display: false }, ticks: { color: colors.text, font: { size: 10 } } }
            }
        },
        plugins: [dataLabelPlugin]
    });
}

function renderStatusChart(data) {
    const ctxStatus = document.getElementById('chart-status').getContext('2d');
    if (charts.status) charts.status.destroy();

    const colors = getChartColors();
    let batido = 0, naoBatido = 0, naoContabilizado = 0; 

    data.forEach(item => {
        if (statusChartMode === 'year') {
            item.data.forEach(val => {
                const st = getStatus(val, item.meta, item.logic, item.format);
                if (st === 'good') batido++;
                else if (st === 'bad') naoBatido++;
                else naoContabilizado++;
            });
        } else {
            if (!temDadosValidos(item)) {
                naoContabilizado++;
            } else {
                const valid = item.data.filter(v => 
                    v !== null && v !== undefined && (typeof v !== 'string' || (v.trim() !== "" && v.trim() !== "NaN"))
                );
                
                if (valid.length > 0) {
                    const status = getStatus(valid[valid.length - 1], item.meta, item.logic, item.format);
                    if (status === 'good') batido++;
                    else if (status === 'bad') naoBatido++;
                    else naoContabilizado++;
                } else {
                    naoContabilizado++;
                }
            }
        }
    });

    const centerTextPlugin = {
        id: 'centerText',
        beforeDraw: function(chart) {
            if (chart.config.type !== 'doughnut') return;
            const width = chart.width, height = chart.height, ctx = chart.ctx;
            ctx.restore();
            
            const fontSize = (height / 140).toFixed(2);
            ctx.font = `bold ${fontSize}em Inter`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = colors.title; 

            const text = statusChartMode === 'year' ? "ANO" : "ATUAL";
            const textX = Math.round((width - ctx.measureText(text).width) / 2);
            const textY = height / 2;

            ctx.fillText(text, textX, textY);
            
            ctx.font = `normal ${fontSize*0.4}em Inter`;
            ctx.fillStyle = colors.text;
            const sub = "(Clique)";
            const subX = Math.round((width - ctx.measureText(sub).width) / 2);
            ctx.fillText(sub, subX, textY + 20);
            
            ctx.save();
        }
    };

    charts.status = new Chart(ctxStatus, {
        type: 'doughnut',
        data: {
            labels: ['Batido', 'Não Batido', 'S/ Dados'],
            datasets: [{
                data: [batido, naoBatido, naoContabilizado],
                backgroundColor: ['#10b981', '#ef4444', '#6b7280'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            onClick: (e) => {
                statusChartMode = statusChartMode === 'last' ? 'year' : 'last';
                showToast(`Visão: ${statusChartMode === 'year' ? 'Acumulado do Ano' : 'Status Atual'}`, "wait");
                renderStatusChart(data); 
            },
            plugins: {
                legend: { position: 'bottom', labels: { color: colors.text, font: { size: 11 }, usePointStyle: true, padding: 20 } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            let value = context.parsed;
                            let total = batido + naoBatido + naoContabilizado;
                            let perc = total > 0 ? Math.round((value / total) * 100) : 0;
                            return `${label}: ${value} (${perc}%)`;
                        }
                    }
                }
            }
        },
        plugins: [centerTextPlugin]
    });
}

function renderPuncChart(data) {
    const ctxPunc = document.getElementById('chart-punc').getContext('2d');
    if (charts.punc) charts.punc.destroy();

    const colors = getChartColors();
    const pData = Array(12).fill(0).map((_, i) => {
        let ok = 0, tot = 0;
        data.forEach(item => {
            if (item.dates && item.dates[i] && item.data[i] !== null) {
                tot++;
                if (checkOnTime(item.dates[i], i)) ok++;
            }
        });
        return tot ? Math.round((ok / tot) * 100) : 0;
    });

    const gradientPunc = ctxPunc.createLinearGradient(0, 0, 0, 300);
    gradientPunc.addColorStop(0, 'rgba(245, 158, 11, 0.2)');
    gradientPunc.addColorStop(1, 'rgba(245, 158, 11, 0.0)');

    charts.punc = new Chart(ctxPunc, {
        type: 'line',
        data: {
            labels: months,
            datasets: [{
                label: 'Pontualidade',
                data: pData,
                borderColor: '#f59e0b',
                backgroundColor: gradientPunc,
                borderWidth: 2,
                pointBackgroundColor: colors.bg, 
                pointBorderColor: '#f59e0b',
                pointRadius: 4,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 100, grid: { color: colors.grid }, ticks: { color: colors.text } },
                x: { grid: { display: false }, ticks: { color: colors.text, font: { size: 10 } } }
            }
        }
    });
}

// --- MODAL PRINCIPAL (COM TOOLTIPS NOS CÁLCULOS) ---
function openMainModal(id) {
    currentMetricId = id;
    const item = fullDB[currentYear].find(i => i.id == id);
    if (!item) return;

    setText('modalTitle', item.name);
    setText('viewMetaDisplay', formatVal(item.meta, item.format));
    setText('viewLogicBadge', item.logic === 'maior' ? 'Maior Melhor ↑' : 'Menor Melhor ↓');

    // Preparar meta numérica
    let nMeta = 0;
    if (item.format === 'time') {
        nMeta = timeToDec(item.meta);
    } else {
        nMeta = parseFloat(String(item.meta).replace(',', '.'));
    }

    // Helper: Texto + Tooltip
    const setStatWithTooltip = (elementId, valNum, contextLabel) => {
        const el = document.getElementById(elementId);
        if (!el) return;

        if (!nMeta || isNaN(nMeta) || isNaN(valNum) || nMeta === 0) {
            el.innerText = '-';
            el.title = '';
            return;
        }

        const pct = (valNum / nMeta) * 100;
        const pctStr = pct.toFixed(1) + '%';
        let displayStr = '';
        let descStr = '';

        if (item.logic === 'menor') {
            displayStr = `${pctStr} do Limite`;
            descStr = `Cálculo: (Valor Utilizado / Limite) * 100. \nIndica que você consumiu ${pctStr} do limite máximo permitido.`;
        } else {
            displayStr = `${pctStr} da Meta`;
            descStr = `Cálculo: (Valor Realizado / Meta) * 100. \nIndica que você atingiu ${pctStr} da meta estabelecida.`;
        }

        el.innerText = displayStr;
        el.title = descStr; // Define tooltip
    };

    const valid = item.data.filter(v => v !== null && v !== "");
    
    if (valid.length > 0) {
        const last = valid[valid.length - 1];
        let hits = 0;
        valid.forEach(v => {
            const s = getStatus(v, item.meta, item.logic, item.format);
            if (s === 'good') hits++;
        });

        setText('viewLast', formatVal(last, item.format));
        
        // --- Tooltip no Último ---
        let nLast = item.format === 'time' ? timeToDec(last) : parseFloat(String(last).replace(',', '.'));
        setStatWithTooltip('viewLastPct', nLast, 'Último');
        // -------------------------

        // --- CÁLCULO TARGET COM TOOLTIP ---
        const targetEl = document.getElementById('viewTarget');
        if (valid.length > 0) {
            const pctBatida = Math.round((hits / valid.length) * 100);
            targetEl.innerText = pctBatida + '%';
            
            // Descrição da Regra
            targetEl.title = `Regra: (Meses na Meta / Meses Lançados) * 100.\nIndica a consistência: de ${valid.length} meses lançados, a meta foi atingida em ${hits}.`;
        } else {
            targetEl.innerText = "-";
            targetEl.title = "";
        }
        // ----------------------------------
        
        if (item.format === 'time') {
            setText('viewAvg', "-");
            setText('viewAvgPct', "-");
        } else {
            const values = valid.map(v => parseFloat(String(v).replace(',', '.'))).filter(n => !isNaN(n));
            
            if (values.length > 0) {
                const sum = values.reduce((a, b) => a + b, 0);
                const avg = sum / values.length;
                setText('viewAvg', formatVal(avg, item.format));

                // --- Tooltip na Média ---
                setStatWithTooltip('viewAvgPct', avg, 'Média');
                // ------------------------

            } else {
                setText('viewAvg', "-");
                setText('viewAvgPct', "-");
            }
        }
    } else {
        setText('viewLast', "-");
        setText('viewLastPct', "-");
        setText('viewAvg', "-");
        setText('viewAvgPct', "-");
        setText('viewTarget', "-");
    }

    let pCount = 0, pTotal = 0;
    const dates = item.dates || Array(12).fill(null);
    dates.forEach((d, i) => {
        if (item.data[i] !== null && item.data[i] !== "") {
            pTotal++;
            if (checkOnTime(d, i)) pCount++;
        }
    });
    const pScore = pTotal ? Math.round((pCount / pTotal) * 100) : 0;
    setText('viewPunc', pTotal ? pScore + "%" : "-");
    
    const badgeEl = document.getElementById('puncBadge');
    if (badgeEl) {
        if(pTotal === 0) badgeEl.innerHTML = '<span class="badge badge-warn">Sem dados</span>';
        else if(pScore === 100) badgeEl.innerHTML = '<span class="badge badge-good">Excelente</span>';
        else if(pScore >= 70) badgeEl.innerHTML = '<span class="badge badge-warn">Regular</span>';
        else badgeEl.innerHTML = '<span class="badge badge-bad">Crítico</span>';
    }

    renderTimeline(item);
    populateEditForm(item);

    switchToViewMode();
    document.getElementById('mainModal').classList.add('open');
    setTimeout(() => renderDetailChart(item), 100); 
}

function renderTimeline(item) {
    const c = document.getElementById('timelineTrack');
    let h = '';
    
    for (let i = 0; i < 12; i++) {
        const hasData = item.data[i] !== null && item.data[i] !== "";
        
        if (hasData) {
            const dateStr = item.dates[i];
            let cls = 'tl-dot'; 
            let tip = 'Entregue';

            if (dateStr) {
                if (checkOnTime(dateStr, i)) { 
                    cls += ' ok';  
                    tip = 'No Prazo'; 
                } else { 
                    cls += ' late'; 
                    tip = 'Atrasado'; 
                }
            } else {
                cls += ' empty'; 
                tip = 'Sem data'; 
            }
            
            h += `<div class="timeline-item" title="${months[i]}: ${tip}">
                <div class="${cls}"></div><div class="tl-label">${months[i]}</div>
            </div>`;
        }
    }
    
    c.innerHTML = h || '<div style="color:#666;font-size:0.8rem;text-align:center;width:100%;padding:10px">Sem dados lançados.</div>';
}

function populateEditForm(item) {
    document.getElementById('inp-id').value = item.id;
    document.getElementById('inp-name').value = item.name;
    document.getElementById('inp-meta').value = item.meta;
    document.getElementById('inp-logic').value = item.logic;
    document.getElementById('inp-format').value = item.format;
    
    const secSel = document.getElementById('inp-sector');
    const secs = [...new Set(fullDB[currentYear].map(i => i.sector))];
    secSel.innerHTML = secs.map(s => `<option value="${s}">${s}</option>`).join('');
    secSel.value = item.sector;

    const c = document.getElementById('monthsGrid');
    c.innerHTML = '';
    months.forEach((m, i) => {
        const v = item.data[i] || '';
        const d = item.dates[i] || '';
        c.innerHTML += `
            <div class="month-inp-group">
                <div class="mig-header"><span>${m}</span></div>
                <input type="text" id="mv-${i}" class="input-field" value="${v}" placeholder="-" style="text-align:center">
                <input type="date" id="md-${i}" class="date-inp" value="${d}">
            </div>
        `;
    });
}

function saveItem() {
    const id = document.getElementById('inp-id').value;
    const name = document.getElementById('inp-name').value;
    const sector = isNewSectorMode ? document.getElementById('inp-new-sector').value : document.getElementById('inp-sector').value;
    
    if (!name || !sector) return alert("Preencha Nome e Setor.");

    const newData = [];
    const newDates = [];
    for (let i = 0; i < 12; i++) {
        newData.push(document.getElementById(`mv-${i}`).value || null);
        newDates.push(document.getElementById(`md-${i}`).value || null);
    }

    const newItem = {
        id: id ? parseFloat(id) : Date.now(),
        name, sector,
        meta: document.getElementById('inp-meta').value,
        logic: document.getElementById('inp-logic').value,
        format: document.getElementById('inp-format').value,
        data: newData, dates: newDates
    };

    if (id) {
        const idx = fullDB[currentYear].findIndex(i => i.id == id);
        fullDB[currentYear][idx] = newItem;
        currentMetricId = newItem.id;
        openMainModal(currentMetricId);
    } else {
        fullDB[currentYear].push(newItem);
        if (currentYear === '2025') {
            const clone = {...newItem, id: Date.now()+1, data: Array(12).fill(null), dates: Array(12).fill(null)};
            fullDB['2026'].push(clone);
        }
        closeModal('mainModal');
    }
    saveData();
    renderApp(currentSector);
}

function openCreateModal() {
    currentMetricId = null;
    setText('modalTitle', 'Novo Indicador');
    document.getElementById('inp-id').value = "";
    document.getElementById('inp-name').value = "";
    document.getElementById('inp-meta').value = "";
    
    const c = document.getElementById('monthsGrid');
    c.innerHTML = '';
    months.forEach((m, i) => {
        c.innerHTML += `
            <div class="month-inp-group">
                <div class="mig-header"><span>${m}</span></div>
                <input type="text" id="mv-${i}" class="input-field" placeholder="-" style="text-align:center">
                <input type="date" id="md-${i}" class="date-inp">
            </div>
        `;
    });
    
    const secSel = document.getElementById('inp-sector');
    const secs = [...new Set(fullDB[currentYear].map(i => i.sector))];
    secSel.innerHTML = secs.map(s => `<option value="${s}">${s}</option>`).join('');

    switchToEditMode();
    document.getElementById('mainModal').classList.add('open');
}

function openPdfModal() { document.getElementById('pdfModal').classList.add('open'); }

function generateExport(type) {
    closeModal('pdfModal');
    
    if (type === 'table-pdf') {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(16);
        doc.text(`Relatório FAV Analytics - ${currentYear}`, 14, 20);
        doc.setFontSize(10);
        doc.text(`Setor: ${currentSector}`, 14, 28);

        const rows = [];
        const pdfRowMap = {}; 
        let currentRowIndex = 0;

        const sectors = currentSector === 'Todos' 
            ? [...new Set(fullDB[currentYear].map(i => i.sector))].sort() 
            : [currentSector];

        sectors.forEach(sec => {
            rows.push([{ 
                content: sec, 
                colSpan: 14, 
                styles: { fillColor: [228, 228, 231], textColor: [24, 24, 27], fontStyle: 'bold', halign: 'left' } 
            }]);
            pdfRowMap[currentRowIndex] = null; 
            currentRowIndex++;

            const items = fullDB[currentYear].filter(i => i.sector === sec);
            items.forEach(item => {
                rows.push([
                    item.name, 
                    formatVal(item.meta, item.format), 
                    ...item.data.map(v => formatVal(v, item.format))
                ]);
                pdfRowMap[currentRowIndex] = item; 
                currentRowIndex++;
            });
        });

        doc.autoTable({
            head: [['Indicador', 'Meta', ...months]],
            body: rows,
            startY: 35,
            styles: { 
                fontSize: 7, 
                cellPadding: 2, 
                lineColor: 200, 
                lineWidth: 0.1,
                halign: 'center', 
                valign: 'middle'  
            },
            headStyles: { 
                fillColor: [59, 130, 246],
                halign: 'center'
            },
            didParseCell: function(dataCell) {
                if (dataCell.section === 'body' && dataCell.column.index >= 2) {
                    const rowIndex = dataCell.row.index;
                    const item = pdfRowMap[rowIndex];

                    if (item) {
                        const monthIndex = dataCell.column.index - 2;
                        const rawValue = item.data[monthIndex];
                        const status = getStatus(rawValue, item.meta, item.logic, item.format);

                        if (status === 'good') {
                            dataCell.cell.styles.fillColor = [16, 185, 129];
                            dataCell.cell.styles.textColor = [255, 255, 255];
                        } else if (status === 'bad') {
                            dataCell.cell.styles.fillColor = [239, 68, 68]; 
                            dataCell.cell.styles.textColor = [255, 255, 255];
                        }
                    }
                }
            }
        });
        doc.save(`Relatorio_${currentYear}.pdf`);
    
    } else if (type === 'excel') {
        const data = currentSector === 'Todos' ? fullDB[currentYear] : fullDB[currentYear].filter(i => i.sector === currentSector);
        const wsData = data.map(item => {
            const row = { "Indicador": item.name, "Setor": item.sector, "Meta": item.meta };
            months.forEach((m, i) => row[m] = item.data[i] || "");
            return row;
        });
        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Dados");
        XLSX.writeFile(wb, `FAV_Dados_${currentYear}.xlsx`);

    } else if (type === 'visual-pdf') {
        showToast("Gerando PDF...", "wait");
        
        const wasTable = currentView === 'table';
        if (wasTable) switchView('exec');
        
        setTimeout(() => {
            const element = document.getElementById('charts-area');
            const options = {
                scale: 2,
                useCORS: true, 
                backgroundColor: currentTheme === 'light' ? '#ffffff' : '#09090b',
                logging: false,
                onclone: function(clonedDoc) {
                    const clonedChartsArea = clonedDoc.getElementById('charts-area');
                    if (clonedChartsArea) {
                        const bg = currentTheme === 'light' ? '#ffffff' : '#09090b';
                        const cardBg = currentTheme === 'light' ? '#ffffff' : '#18181b';
                        const border = currentTheme === 'light' ? '#d4d4d8' : '#3f3f46';

                        clonedChartsArea.style.padding = '20px';
                        clonedChartsArea.style.backgroundColor = bg;
                        const chartCards = clonedChartsArea.querySelectorAll('.chart-card');
                        chartCards.forEach(card => {
                            card.style.boxShadow = 'none';
                            card.style.border = `1px solid ${border}`;
                            card.style.backgroundColor = cardBg;
                            card.style.overflow = 'visible';
                        });
                        const canvases = clonedChartsArea.querySelectorAll('canvas');
                        canvases.forEach(canvas => {
                            canvas.style.display = 'block';
                            canvas.style.width = '100%';
                            canvas.style.height = '100%';
                        });
                    }
                }
            };
            
            html2canvas(element, options).then(canvas => {
                const imgData = canvas.toDataURL('image/png', 1.0);
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF('l', 'mm', 'a4');
                const pageWidth = doc.internal.pageSize.getWidth();
                const pageHeight = doc.internal.pageSize.getHeight();
                const imgWidth = pageWidth - 20; 
                const imgHeight = (canvas.height * imgWidth) / canvas.width;
                
                if (currentTheme === 'dark') {
                    doc.setFillColor(9, 9, 11);
                    doc.rect(0, 0, pageWidth, pageHeight, 'F');
                    doc.setTextColor(255, 255, 255);
                } else {
                    doc.setFillColor(255, 255, 255);
                    doc.rect(0, 0, pageWidth, pageHeight, 'F');
                    doc.setTextColor(0, 0, 0);
                }

                doc.setFontSize(16);
                doc.text(`Dashboard FAV Analytics - ${currentYear}`, pageWidth / 2, 15, { align: 'center' });
                
                doc.setFontSize(10);
                doc.setTextColor(150, 150, 150);
                doc.text(`Setor: ${currentSector} | Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 
                        pageWidth / 2, 22, { align: 'center' });
                
                const xPos = (pageWidth - imgWidth) / 2;
                const yPos = 30; 
                
                if (yPos + imgHeight > pageHeight) {
                    const adjustedHeight = pageHeight - yPos - 10;
                    const adjustedWidth = (canvas.width * adjustedHeight) / canvas.height;
                    const adjustedXPos = (pageWidth - adjustedWidth) / 2;
                    doc.addImage(imgData, 'PNG', adjustedXPos, yPos, adjustedWidth, adjustedHeight);
                } else {
                    doc.addImage(imgData, 'PNG', xPos, yPos, imgWidth, imgHeight);
                }
                
                doc.setFontSize(8);
                doc.setTextColor(100, 100, 100);
                doc.text('Página 1/1', pageWidth - 10, pageHeight - 10, { align: 'right' });
                
                doc.save(`Dashboard_FAV_${currentYear}_${currentSector}.pdf`);
                
                if (wasTable) {
                    setTimeout(() => switchView('table'), 500);
                }
                showToast("PDF gerado com sucesso!");
            }).catch(error => {
                console.error('Erro ao gerar PDF:', error);
                showToast("Erro ao gerar PDF!", "error");
                if (wasTable) switchView('table');
            });
        }, 1000);
    }
}

function openMonthModal(id, idx) {
    const item = fullDB[currentYear].find(i => i.id == id);
    if (!item) return;

    const val = item.data[idx];
    const status = getStatus(val, item.meta, item.logic, item.format);
    
    setText('monthModalTitle', `${months[idx]} - ${item.name}`);
    setText('monthValue', formatVal(val, item.format));
    
    const colors = { good: 'var(--good)', bad: 'var(--bad)', 'empty': '#fff' };
    document.getElementById('monthValue').style.color = colors[status];
    
    const txts = { good: 'Meta Batida', bad: 'Não Batida', 'empty': 'Sem Dados' };
    setText('monthStatus', txts[status]);
    document.getElementById('monthStatus').style.color = colors[status];
    
    setText('monthMeta', formatVal(item.meta, item.format));
    setText('monthDelivery', item.dates[idx] ? item.dates[idx].split('-').reverse().join('/') : 'Pendente');
    
    document.getElementById('monthModal').classList.add('open');
}

function renderDetailChart(item) {
    const ctx = document.getElementById('detailChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    
    const colors = getChartColors();
    const cData = item.data.map(v => {
        if(v===null||v==="") return null;
        let n = item.format==='time'?timeToDec(v):parseFloat(v.replace(',','.'));
        return isNaN(n) ? null : n; 
    });
    
    const cMeta = item.format==='time' ? timeToDec(item.meta) : parseFloat(item.meta.replace(',','.'));
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)'); 
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)'); 

    chartInstance = new Chart(ctx, { 
        type: 'line', 
        data: { 
            labels: months, 
            datasets: [{ 
                label: 'Real', 
                data: cData, 
                borderColor: '#3b82f6', 
                backgroundColor: gradient,
                borderWidth: 3,
                tension: 0.3, 
                fill: true,   
                pointRadius: 4,
                pointBackgroundColor: colors.bg, // Dinâmico
                pointBorderColor: '#3b82f6'
            }, { 
                label: 'Meta', 
                data: Array(12).fill(cMeta), 
                borderColor: '#ef4444', 
                borderDash: [5,5], 
                pointRadius: 0,
                borderWidth: 2
            }] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            layout: {
                padding: { left: 0, right: 0, top: 10, bottom: 0 } 
            },
            plugins: { legend: { display: false } },
            scales: {
                x: { 
                    grid: { display: false },
                    ticks: { color: colors.text, font: { size: 10 } }
                },
                y: {
                    grid: { color: colors.grid },
                    ticks: { color: colors.text }
                }
            }
        } 
    });
}

function temDadosValidos(item) {
    for (let i = 0; i < item.data.length; i++) {
        const val = item.data[i];
        if (val !== null && val !== undefined) {
            if (typeof val === 'string') {
                const trimmed = val.trim();
                if (trimmed !== "" && trimmed !== "null" && trimmed !== "undefined" && trimmed !== "NaN") {
                    return true;
                }
            } else {
                return true;
            }
        }
    }
    return false;
}

// Helpers diversos
function populateSectorFilter() { const d = fullDB[currentYear]||[]; const s = ['Todos', ...new Set(d.map(i => i.sector))].sort(); const el = document.getElementById('sector-filter'); el.innerHTML = s.map(x => `<option value="${x}">${x}</option>`).join(''); el.value = currentSector; }

// --- TOGGLE SETOR IMÓVEL (SWAP) ---
function toggleNewSector() { 
    isNewSectorMode = !isNewSectorMode; 
    const selectEl = document.getElementById('inp-sector');
    const inputEl = document.getElementById('inp-new-sector');
    const btnEl = document.getElementById('btn-toggle-sector'); 

    if(isNewSectorMode) {
        selectEl.style.display = 'none';
        inputEl.style.display = 'block';
        if(btnEl) btnEl.innerText = "(Voltar)";
        inputEl.focus();
    } else {
        selectEl.style.display = 'block';
        inputEl.style.display = 'none';
        if(btnEl) btnEl.innerText = "(Novo?)";
        inputEl.value = ""; 
    }
}

function switchToEditMode() { document.getElementById('mode-view').style.display='none'; document.getElementById('footer-view').style.display='none'; document.getElementById('mode-edit').style.display='block'; document.getElementById('footer-edit').style.display='flex'; if(currentMetricId) setText('modalTitle', 'Editar Indicador'); }
function switchToViewMode() { document.getElementById('mode-view').style.display='block'; document.getElementById('footer-view').style.display='flex'; document.getElementById('mode-edit').style.display='none'; document.getElementById('footer-edit').style.display='none'; if(currentMetricId) setText('modalTitle', fullDB[currentYear].find(i=>i.id==currentMetricId).name); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function setSector(val) { currentSector = val; renderApp(); }
function setYear(y) { currentYear = y; renderApp(); }
function switchView(v) { currentView = v; document.getElementById('view-table').style.display = v==='table'?'block':'none'; document.getElementById('view-exec').style.display = v==='exec'?'block':'none'; document.getElementById('btn-view-table').classList.toggle('active', v==='table'); document.getElementById('btn-view-exec').classList.toggle('active', v==='exec'); renderApp(); }
function toggleLoading(s) { document.getElementById('loading-overlay').style.display=s?'flex':'none'; }
function showToast(m, t) { const el=document.getElementById('toast'); el.innerText=m; el.className=`toast ${t}`; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),3000); }
function setText(id, txt) { const el = document.getElementById(id); if(el) el.innerText = txt; }
function configDeadline() { const n = prompt("Novo dia limite (Ex: 15):", deadlineDay); if(n && !isNaN(n)) { deadlineDay = parseInt(n); localStorage.setItem('fav_deadline', deadlineDay); renderApp(); } }
function importFrom2025() { if(confirm("Deseja importar?")) { fullDB['2026'] = fullDB['2025'].map(i => ({...i, id: Date.now()+Math.random(), data: Array(12).fill(null), dates: Array(12).fill(null)})); saveData(); renderApp(); } }
function deleteItem() { if(confirm("Excluir?")) { fullDB[currentYear] = fullDB[currentYear].filter(i=>i.id!=currentMetricId); saveData(); closeModal('mainModal'); renderApp(); } }