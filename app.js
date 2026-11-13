const STORAGE_KEY = 'monai_terminal_v1';

const MONTHS_PT = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'
];

const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const DEFAULT_CATEGORIES = [
  { id: 'cat_food', name: 'Alimentação', icon: '🍔', color: '#2E8BFF', budget: 350, type: 'expense' },
  { id: 'cat_home', name: 'Casa & Contas', icon: '🏠', color: '#00D4FF', budget: 750, type: 'expense' },
  { id: 'cat_trans', name: 'Transportes', icon: '🚇', color: '#7B61FF', budget: 120, type: 'expense' },
  { id: 'cat_leisure', name: 'Lazer', icon: '🎮', color: '#F0B90B', budget: 150, type: 'expense' },
  { id: 'cat_health', name: 'Saúde', icon: '💊', color: '#FF6B8B', budget: 80, type: 'expense' },
  { id: 'cat_subs', name: 'Subscrições', icon: '⚡', color: '#A855F7', budget: 60, type: 'expense' },
  { id: 'cat_salary', name: 'Salário', icon: '💼', color: '#0ECB81', budget: 0, type: 'income' },
  { id: 'cat_extra', name: 'Extra / Cripto', icon: '📈', color: '#00E5FF', budget: 0, type: 'income' }
];

function createInitialState() {
  return {
    settings: {
      rollover: false,
      privacy: false
    },
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    transactions: [],
    fixedTemplates: [],
    fixedStatus: {},
    pots: []
  };
}

let state = loadState();
const now = new Date();
let selectedYear = now.getFullYear();
let selectedMonth = now.getMonth(); // 0-11
let modalTxType = 'expense';
let selectedCategoryId = 'cat_food';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw);
    return { ...createInitialState(), ...parsed };
  } catch {
    return createInitialState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getMonthKey(year = selectedYear, month = selectedMonth) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function getPrevMonthKey(year = selectedYear, month = selectedMonth) {
  const d = new Date(year, month - 1, 1);
  return getMonthKey(d.getFullYear(), d.getMonth());
}

function formatMoney(val, showSign = false) {
  if (state.settings.privacy) return '•••• €';
  const abs = Math.abs(val).toLocaleString('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const prefix = val < 0 ? '-' : (showSign && val > 0 ? '+' : '');
  return `${prefix}${abs} €`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getCategory(id) {
  return state.categories.find((c) => c.id === id) || {
    id,
    name: 'Geral',
    icon: '💠',
    color: '#2E8BFF',
    budget: 0,
    type: 'expense'
  };
}

/* Core Monthly Calculations */
function getMonthSummary(mKey) {
  const txs = state.transactions.filter((t) => t.monthKey === mKey);
  const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return { txs, income, expense, net: income - expense };
}

function getRolloverBalance(targetKey) {
  if (!state.settings.rollover) return 0;
  return state.transactions
    .filter((t) => t.monthKey < targetKey)
    .reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);
}

/* Render Everything */
function renderAll() {
  const mKey = getMonthKey();
  document.getElementById('currentMonthLabel').textContent = `${MONTHS_PT[selectedMonth]} ${selectedYear}`;
  document.getElementById('toggleRollover').checked = state.settings.rollover;

  renderWallet(mKey);
  renderFixedAndBudgets(mKey);
  renderPots();
  renderYearly();
}

function renderWallet(mKey) {
  const { txs, income, expense, net } = getMonthSummary(mKey);
  const rollover = getRolloverBalance(mKey);
  const available = net + rollover;

  const heroEl = document.getElementById('heroBalance');
  heroEl.textContent = formatMoney(available);
  heroEl.style.color = available < 0 ? 'var(--red)' : 'var(--text-main)';

  const rolloverNote = document.getElementById('rolloverNote');
  if (state.settings.rollover && rollover !== 0) {
    rolloverNote.classList.remove('hidden');
    document.getElementById('rolloverVal').textContent = formatMoney(rollover, true);
  } else {
    rolloverNote.classList.add('hidden');
  }

  document.getElementById('totalIncome').textContent = formatMoney(income, true);
  document.getElementById('totalExpense').textContent = formatMoney(-expense);

  // PnL vs Previous Month
  const prevSummary = getMonthSummary(getPrevMonthKey());
  const pnlBadge = document.getElementById('pnlBadge');
  if (prevSummary.income === 0 && prevSummary.expense === 0) {
    pnlBadge.className = 'pnl-badge neutral';
    pnlBadge.textContent = 'Sem histórico ant.';
  } else {
    const base = Math.abs(prevSummary.net) || 1;
    const diffPct = ((net - prevSummary.net) / base) * 100;
    pnlBadge.className = `pnl-badge ${diffPct >= 0 ? 'positive' : 'negative'}`;
    pnlBadge.textContent = `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}% vs mês ant.`;
  }

  // Fixed quick badge
  const statusMap = state.fixedStatus[mKey] || {};
  const paidCount = state.fixedTemplates.filter((f) => statusMap[f.id]).length;
  document.getElementById('fixedQuickStat').textContent = `Fixas: ${paidCount}/${state.fixedTemplates.length}`;

  // Expense Ratio
  const ratio = income > 0 ? Math.min(999, Math.round((expense / income) * 100)) : (expense > 0 ? 100 : 0);
  document.getElementById('expenseRatioTag').textContent = `${ratio}% da receita`;

  // Category filter dropdown
  const filterSelect = document.getElementById('filterCategory');
  const currentFilter = filterSelect.value;
  filterSelect.innerHTML = '<option value="ALL">Todas</option>' +
    state.categories.map((c) => `<option value="${c.id}">${c.icon} ${escapeHtml(c.name)}</option>`).join('');
  filterSelect.value = currentFilter || 'ALL';

  renderTransactionsList(txs);
  drawDailyChart(mKey, txs, rollover);
  drawCategoryDonut(txs, expense);
}

function renderTransactionsList(txs) {
  const query = document.getElementById('searchTx').value.trim().toLowerCase();
  const catFilter = document.getElementById('filterCategory').value;

  const filtered = [...txs]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .filter((t) => {
      if (catFilter !== 'ALL' && t.categoryId !== catFilter) return false;
      if (!query) return true;
      const cat = getCategory(t.categoryId);
      return (t.note || '').toLowerCase().includes(query) ||
        cat.name.toLowerCase().includes(query) ||
        String(t.amount).includes(query);
    });

  const listEl = document.getElementById('txList');
  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-state">Sem movimentos registados neste filtro.</div>';
    return;
  }

  listEl.innerHTML = filtered.map((t) => {
    const cat = getCategory(t.categoryId);
    const signVal = t.type === 'income' ? t.amount : -t.amount;
    const colorClass = t.type === 'income' ? 'green' : 'red';
    const dayLabel = t.date.split('-').reverse().slice(0, 2).join('/');
    return `
      <div class="tx-item">
        <div class="tx-left">
          <div class="tx-icon">${cat.icon}</div>
          <div class="tx-meta">
            <div class="tx-title">${escapeHtml(t.note || cat.name)}</div>
            <div class="tx-sub">${escapeHtml(cat.name)} • ${dayLabel}${t.fixedId ? ' • Fixa' : ''}</div>
          </div>
        </div>
        <div class="tx-right">
          <span class="tx-amount mono ${colorClass}">${formatMoney(signVal, true)}</span>
          <button class="del-btn" data-del-tx="${t.id}" title="Eliminar">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

/* Charts (Native Retina Canvas) */
function drawDailyChart(mKey, txs, startBalance) {
  const canvas = document.getElementById('dailyChart');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 340;
  const height = 150;
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const dailyDelta = new Array(daysInMonth).fill(0);

  txs.forEach((t) => {
    const day = parseInt(t.date.split('-')[2], 10);
    if (day >= 1 && day <= daysInMonth) {
      dailyDelta[day - 1] += t.type === 'income' ? t.amount : -t.amount;
    }
  });

  const points = [];
  let running = startBalance;
  for (let i = 0; i < daysInMonth; i++) {
    running += dailyDelta[i];
    points.push(running);
  }

  const minVal = Math.min(0, ...points);
  const maxVal = Math.max(10, ...points);
  const range = (maxVal - minVal) || 1;
  const padX = 10;
  const padY = 18;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  // Grid lines
  ctx.strokeStyle = '#1E2329';
  ctx.lineWidth = 1;
  for (let g = 0; g < 3; g++) {
    const y = padY + (plotH / 2) * g;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(width - padX, y);
    ctx.stroke();
  }

  const coords = points.map((val, idx) => ({
    x: padX + (idx / (daysInMonth - 1)) * plotW,
    y: padY + plotH - ((val - minVal) / range) * plotH
  }));

  // Gradient Fill
  const grad = ctx.createLinearGradient(0, padY, 0, height);
  grad.addColorStop(0, 'rgba(46, 139, 255, 0.35)');
  grad.addColorStop(1, 'rgba(0, 102, 255, 0.0)');

  ctx.beginPath();
  ctx.moveTo(coords[0].x, height - padY);
  coords.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(coords[coords.length - 1].x, height - padY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Electric Cobalt Line
  ctx.beginPath();
  coords.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = '#2E8BFF';
  ctx.lineWidth = 2.4;
  ctx.shadowColor = 'rgba(0, 102, 255, 0.8)';
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // End Dot
  const last = coords[coords.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#0066FF';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawCategoryDonut(txs, totalExpense) {
  const canvas = document.getElementById('categoryChart');
  const dpr = window.devicePixelRatio || 1;
  const size = 130;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  document.getElementById('donutTotal').textContent = state.settings.privacy
    ? '•••'
    : `${Math.round(totalExpense)}€`;

  const totalsByCat = {};
  txs.filter((t) => t.type === 'expense').forEach((t) => {
    totalsByCat[t.categoryId] = (totalsByCat[t.categoryId] || 0) + t.amount;
  });

  const entries = Object.entries(totalsByCat)
    .map(([catId, amount]) => ({ cat: getCategory(catId), amount }))
    .sort((a, b) => b.amount - a.amount);

  const cx = size / 2;
  const cy = size / 2;
  const radius = 50;
  const lineWidth = 14;

  if (!entries.length || totalExpense <= 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#2B3139';
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    document.getElementById('categoryLegend').innerHTML =
      '<span class="sub-text">Sem despesas neste mês.</span>';
    return;
  }

  let startAngle = -Math.PI / 2;
  entries.forEach(({ cat, amount }) => {
    const slice = (amount / totalExpense) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
    ctx.strokeStyle = cat.color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    startAngle += slice;
  });

  document.getElementById('categoryLegend').innerHTML = entries.slice(0, 4).map(({ cat, amount }) => {
    const pct = Math.round((amount / totalExpense) * 100);
    return `
      <div class="legend-item">
        <span class="legend-left">
          <i class="legend-dot" style="background:${cat.color}"></i>
          <span>${escapeHtml(cat.name)}</span>
        </span>
        <span class="mono">${pct}%</span>
      </div>
    `;
  }).join('');
}

/* Tab 2: Fixed & Budgets */
function renderFixedAndBudgets(mKey) {
  const statusMap = state.fixedStatus[mKey] || {};
  const committed = state.fixedTemplates.reduce((s, f) => s + f.amount, 0);
  const paid = state.fixedTemplates.filter((f) => statusMap[f.id]).reduce((s, f) => s + f.amount, 0);

  document.getElementById('fixedTotalCommitted').textContent = formatMoney(committed);
  document.getElementById('fixedTotalPaid').textContent = formatMoney(paid);

  const fixedListEl = document.getElementById('fixedList');
  if (!state.fixedTemplates.length) {
    fixedListEl.innerHTML = '<div class="empty-state">Adiciona as tuas contas fixas (ex: Renda, Ginásio) para não teres de as escrever todos os meses.</div>';
  } else {
    fixedListEl.innerHTML = state.fixedTemplates.map((f) => {
      const cat = getCategory(f.categoryId);
      const isPaid = Boolean(statusMap[f.id]);
      return `
        <div class="fixed-item ${isPaid ? 'is-paid' : ''}">
          <div class="tx-left">
            <div class="tx-icon">${cat.icon}</div>
            <div>
              <div class="tx-title">${escapeHtml(f.title)}</div>
              <div class="tx-sub">${escapeHtml(cat.name)} • <span class="mono">${formatMoney(f.amount)}</span></div>
            </div>
          </div>
          <div class="tx-right">
            <button class="pay-toggle ${isPaid ? 'paid' : ''}" data-toggle-fixed="${f.id}">
              ${isPaid ? '✓ Pago' : 'Marcar Pago'}
            </button>
            <button class="del-btn" data-del-fixed="${f.id}" title="Remover fixa">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Budgets per Expense Category
  const monthTxs = state.transactions.filter((t) => t.monthKey === mKey && t.type === 'expense');
  const expenseCats = state.categories.filter((c) => c.type === 'expense');

  document.getElementById('budgetList').innerHTML = expenseCats.map((cat) => {
    const spent = monthTxs.filter((t) => t.categoryId === cat.id).reduce((s, t) => s + t.amount, 0);
    const budget = cat.budget || 0;
    const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
    const barClass = budget > 0 && spent > budget ? 'over' : (pct >= 80 ? 'warn' : '');

    return `
      <div class="budget-item">
        <div class="budget-top">
          <span>${cat.icon} <strong>${escapeHtml(cat.name)}</strong></span>
          <span class="mono">
            ${formatMoney(spent)} /
            <button class="del-btn blue-text mono" data-edit-budget="${cat.id}" title="Alterar limite">
              ${budget > 0 ? formatMoney(budget) : 'Definir'}
            </button>
          </span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${barClass}" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleFixedPayment(fixedId) {
  const mKey = getMonthKey();
  if (!state.fixedStatus[mKey]) state.fixedStatus[mKey] = {};
  const currentlyPaid = Boolean(state.fixedStatus[mKey][fixedId]);

  if (currentlyPaid) {
    state.fixedStatus[mKey][fixedId] = false;
    state.transactions = state.transactions.filter(
      (t) => !(t.monthKey === mKey && t.fixedId === fixedId)
    );
  } else {
    const tpl = state.fixedTemplates.find((f) => f.id === fixedId);
    if (!tpl) return;
    state.fixedStatus[mKey][fixedId] = true;
    state.transactions.push({
      id: 'tx_' + Date.now() + Math.random().toString(36).slice(2, 6),
      date: `${mKey}-01`,
      monthKey: mKey,
      type: 'expense',
      amount: tpl.amount,
      categoryId: tpl.categoryId,
      note: tpl.title,
      fixedId: tpl.id
    });
  }
  saveState();
  renderAll();
}

/* Tab 3: Pots (Cofres) */
function renderPots() {
  const totalSaved = state.pots.reduce((s, p) => s + p.current, 0);
  document.getElementById('potsGrandTotal').textContent = formatMoney(totalSaved);

  const listEl = document.getElementById('potsList');
  if (!state.pots.length) {
    listEl.innerHTML = '<div class="card empty-state">Cria cofres contínuos (ex: Fundo de Emergência) que não fazem reset quando muda o mês.</div>';
    return;
  }

  listEl.innerHTML = state.pots.map((p) => {
    const pct = p.target > 0 ? Math.min(100, Math.round((p.current / p.target) * 100)) : 0;
    return `
      <div class="pot-card">
        <div class="card-header">
          <div>
            <h3>${p.icon} ${escapeHtml(p.name)}</h3>
            <p class="sub-text mono">${formatMoney(p.current)} de ${formatMoney(p.target)} (${pct}%)</p>
          </div>
          <button class="del-btn" data-del-pot="${p.id}">✕</button>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="pot-actions">
          <button class="btn-outline" data-pot-move="${p.id}:add">+ Reforçar</button>
          <button class="btn-outline" data-pot-move="${p.id}:sub">− Retirar</button>
        </div>
      </div>
    `;
  }).join('');
}

/* Tab 4: Yearly */
function renderYearly() {
  document.getElementById('yearlyTitleYear').textContent = selectedYear;
  const monthlyData = [];
  let yearNet = 0;

  for (let m = 0; m < 12; m++) {
    const key = getMonthKey(selectedYear, m);
    const sum = getMonthSummary(key);
    yearNet += sum.net;
    monthlyData.push({ month: MONTHS_SHORT[m], ...sum });
  }

  const badge = document.getElementById('yearlyNetBadge');
  badge.className = `pnl-badge ${yearNet >= 0 ? 'positive' : 'negative'}`;
  badge.textContent = formatMoney(yearNet, true);

  document.getElementById('yearlyTableBody').innerHTML = monthlyData.map((row) => `
    <tr>
      <td>${row.month}</td>
      <td class="green">${formatMoney(row.income)}</td>
      <td class="red">${formatMoney(row.expense)}</td>
      <td class="${row.net >= 0 ? 'green' : 'red'}">${formatMoney(row.net, true)}</td>
    </tr>
  `).join('');

  drawYearlyChart(monthlyData);
}

function drawYearlyChart(data) {
  const canvas = document.getElementById('yearlyChart');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 340;
  const height = 190;
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const maxVal = Math.max(100, ...data.map((d) => Math.max(d.income, d.expense)));
  const padB = 22;
  const padT = 12;
  const plotH = height - padB - padT;
  const groupW = width / 12;
  const barW = Math.max(4, groupW * 0.28);

  data.forEach((d, i) => {
    const baseX = i * groupW + groupW * 0.18;
    const incH = (d.income / maxVal) * plotH;
    const expH = (d.expense / maxVal) * plotH;

    ctx.fillStyle = '#0ECB81';
    ctx.fillRect(baseX, padT + plotH - incH, barW, incH);

    ctx.fillStyle = '#F6465D';
    ctx.fillRect(baseX + barW + 2, padT + plotH - expH, barW, expH);

    ctx.fillStyle = '#848E9C';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.month[0], i * groupW + groupW / 2, height - 6);
  });
}

/* Modal & Form Helpers */
function openTxModal(type = 'expense') {
  modalTxType = type;
  document.getElementById('txAmount').value = '';
  document.getElementById('txNote').value = '';

  const today = new Date();
  const isCurrent = today.getFullYear() === selectedYear && today.getMonth() === selectedMonth;
  document.getElementById('txDate').value = isCurrent
    ? today.toISOString().split('T')[0]
    : `${getMonthKey()}-01`;

  updateTxTypeUI();
  document.getElementById('modalTx').classList.remove('hidden');
  setTimeout(() => document.getElementById('txAmount').focus(), 60);
}

function updateTxTypeUI() {
  document.querySelectorAll('.type-btn').forEach((btn) => {
    const t = btn.dataset.txType;
    btn.className = 'type-btn' + (t === modalTxType ? ` active-${t}` : '');
  });

  const cats = state.categories.filter((c) => c.type === modalTxType);
  if (!cats.some((c) => c.id === selectedCategoryId)) {
    selectedCategoryId = cats[0]?.id || state.categories[0].id;
  }

  document.getElementById('txCategoryGrid').innerHTML = cats.map((c) => `
    <button type="button" class="cat-chip ${c.id === selectedCategoryId ? 'selected' : ''}" data-pick-cat="${c.id}">
      ${c.icon} ${escapeHtml(c.name)}
    </button>
  `).join('');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`view-${tabName}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.tab === tabName);
  });
  renderAll();
}

/* Event Listeners */
document.getElementById('prevMonth').addEventListener('click', () => {
  selectedMonth--;
  if (selectedMonth < 0) { selectedMonth = 11; selectedYear--; }
  renderAll();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  selectedMonth++;
  if (selectedMonth > 11) { selectedMonth = 0; selectedYear++; }
  renderAll();
});

document.getElementById('currentMonthLabel').addEventListener('click', () => {
  const d = new Date();
  selectedYear = d.getFullYear();
  selectedMonth = d.getMonth();
  renderAll();
});

document.getElementById('btnPrivacy').addEventListener('click', () => {
  state.settings.privacy = !state.settings.privacy;
  saveState();
  renderAll();
});

document.getElementById('btnSettings').addEventListener('click', () => {
  document.getElementById('modalSettings').classList.remove('hidden');
});

document.getElementById('toggleRollover').addEventListener('change', (e) => {
  state.settings.rollover = e.target.checked;
  saveState();
  renderAll();
});

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('[data-switch-tab]').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.switchTab));
});

document.querySelectorAll('[data-open-tx]').forEach((btn) => {
  btn.addEventListener('click', () => openTxModal(btn.dataset.openTx));
});

document.querySelectorAll('.close-modal').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.close).classList.add('hidden');
  });
});

document.querySelectorAll('.type-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    modalTxType = btn.dataset.txType;
    updateTxTypeUI();
  });
});

document.getElementById('txCategoryGrid').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-pick-cat]');
  if (!chip) return;
  selectedCategoryId = chip.dataset.pickCat;
  updateTxTypeUI();
});

document.getElementById('formTx').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('txAmount').value);
  const date = document.getElementById('txDate').value;
  const note = document.getElementById('txNote').value.trim();
  if (!amount || amount <= 0 || !date) return;

  const monthKey = date.slice(0, 7);
  state.transactions.push({
    id: 'tx_' + Date.now(),
    date,
    monthKey,
    type: modalTxType,
    amount,
    categoryId: selectedCategoryId,
    note
  });

  const [y, m] = monthKey.split('-').map(Number);
  selectedYear = y;
  selectedMonth = m - 1;

  saveState();
  document.getElementById('modalTx').classList.add('hidden');
  renderAll();
});

document.getElementById('searchTx').addEventListener('input', () => renderAll());
document.getElementById('filterCategory').addEventListener('change', () => renderAll());

/* Delegated Clicks for Lists */
document.body.addEventListener('click', (e) => {
  const delTx = e.target.closest('[data-del-tx]');
  if (delTx) {
    state.transactions = state.transactions.filter((t) => t.id !== delTx.dataset.delTx);
    saveState();
    renderAll();
    return;
  }

  const toggleFix = e.target.closest('[data-toggle-fixed]');
  if (toggleFix) {
    toggleFixedPayment(toggleFix.dataset.toggleFixed);
    return;
  }

  const delFix = e.target.closest('[data-del-fixed]');
  if (delFix) {
    state.fixedTemplates = state.fixedTemplates.filter((f) => f.id !== delFix.dataset.delFixed);
    saveState();
    renderAll();
    return;
  }

  const editBudget = e.target.closest('[data-edit-budget]');
  if (editBudget) {
    const cat = getCategory(editBudget.dataset.editBudget);
    const val = prompt(`Limite mensal (€) para ${cat.name}:`, cat.budget || 0);
    if (val !== null && !isNaN(parseFloat(val))) {
      cat.budget = Math.max(0, parseFloat(val));
      saveState();
      renderAll();
    }
    return;
  }

  const delPot = e.target.closest('[data-del-pot]');
  if (delPot) {
    state.pots = state.pots.filter((p) => p.id !== delPot.dataset.delPot);
    saveState();
    renderAll();
    return;
  }

  const potMove = e.target.closest('[data-pot-move]');
  if (potMove) {
    const [potId, dir] = potMove.dataset.potMove.split(':');
    const pot = state.pots.find((p) => p.id === potId);
    if (!pot) return;
    const raw = prompt(dir === 'add' ? `Quanto queres reforçar em "${pot.name}" (€)?` : `Quanto queres retirar de "${pot.name}" (€)?`);
    const amt = parseFloat(raw);
    if (!isNaN(amt) && amt > 0) {
      pot.current = dir === 'add' ? pot.current + amt : Math.max(0, pot.current - amt);
      saveState();
      renderAll();
    }
  }
});

/* Add Fixed Expense */
document.getElementById('btnAddFixed').addEventListener('click', () => {
  const select = document.getElementById('fixedCategory');
  select.innerHTML = state.categories
    .filter((c) => c.type === 'expense')
    .map((c) => `<option value="${c.id}">${c.icon} ${escapeHtml(c.name)}</option>`)
    .join('');
  document.getElementById('fixedTitle').value = '';
  document.getElementById('fixedAmount').value = '';
  document.getElementById('modalFixed').classList.remove('hidden');
});

document.getElementById('formFixed').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = document.getElementById('fixedTitle').value.trim();
  const amount = parseFloat(document.getElementById('fixedAmount').value);
  const categoryId = document.getElementById('fixedCategory').value;
  if (!title || !amount || amount <= 0) return;

  state.fixedTemplates.push({
    id: 'fix_' + Date.now(),
    title,
    amount,
    categoryId
  });
  saveState();
  document.getElementById('modalFixed').classList.add('hidden');
  renderAll();
});

/* Add Pot */
document.getElementById('btnAddPot').addEventListener('click', () => {
  document.getElementById('potName').value = '';
  document.getElementById('potTarget').value = '';
  document.getElementById('modalPot').classList.remove('hidden');
});

document.getElementById('formPot').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('potName').value.trim();
  const target = parseFloat(document.getElementById('potTarget').value);
  const icon = document.getElementById('potIcon').value;
  if (!name || !target || target <= 0) return;

  state.pots.push({
    id: 'pot_' + Date.now(),
    name,
    target,
    current: 0,
    icon
  });
  saveState();
  document.getElementById('modalPot').classList.add('hidden');
  renderAll();
});

/* Backup Export / Import / Demo */
document.getElementById('btnExportJson').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `monai-backup-${getMonthKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('inputImportJson').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.transactions)) throw new Error();
      state = { ...createInitialState(), ...imported };
      saveState();
      renderAll();
      document.getElementById('modalSettings').classList.add('hidden');
      alert('Backup restaurado com sucesso!');
    } catch {
      alert('Ficheiro JSON inválido.');
    }
  };
  reader.readAsText(file);
});

document.getElementById('btnDemoData').addEventListener('click', () => {
  const mKey = getMonthKey();
  const prevKey = getPrevMonthKey();
  state.transactions = [
    { id: 'd1', date: `${prevKey}-01`, monthKey: prevKey, type: 'income', amount: 1450, categoryId: 'cat_salary', note: 'Salário Base' },
    { id: 'd2', date: `${prevKey}-10`, monthKey: prevKey, type: 'expense', amount: 890, categoryId: 'cat_home', note: 'Despesas Mês Anterior' },
    { id: 'd3', date: `${mKey}-01`, monthKey: mKey, type: 'income', amount: 1450, categoryId: 'cat_salary', note: 'Salário Mensal' },
    { id: 'd4', date: `${mKey}-03`, monthKey: mKey, type: 'expense', amount: 520, categoryId: 'cat_home', note: 'Renda Apartamento' },
    { id: 'd5', date: `${mKey}-06`, monthKey: mKey, type: 'expense', amount: 84.50, categoryId: 'cat_food', note: 'Supermercado Continente' },
    { id: 'd6', date: `${mKey}-09`, monthKey: mKey, type: 'expense', amount: 40, categoryId: 'cat_trans', note: 'Passe Andante' },
    { id: 'd7', date: `${mKey}-12`, monthKey: mKey, type: 'income', amount: 180, categoryId: 'cat_extra', note: 'Lucro Trading' }
  ];
  state.fixedTemplates = [
    { id: 'f1', title: 'Renda Casa', amount: 520, categoryId: 'cat_home' },
    { id: 'f2', title: 'Ginásio', amount: 34.90, categoryId: 'cat_health' },
    { id: 'f3', title: 'Internet & Telemóvel', amount: 29.99, categoryId: 'cat_subs' }
  ];
  state.fixedStatus = { [mKey]: { f1: true } };
  state.pots = [
    { id: 'p1', name: 'Fundo de Emergência', target: 3000, current: 1150, icon: '🛡️' },
    { id: 'p2', name: 'Férias 2027', target: 1200, current: 420, icon: '✈️' }
  ];
  saveState();
  document.getElementById('modalSettings').classList.add('hidden');
  renderAll();
});

document.getElementById('btnResetAll').addEventListener('click', () => {
  if (!confirm('Tens a certeza que queres apagar todos os dados guardados no telemóvel?')) return;
  state = createInitialState();
  saveState();
  document.getElementById('modalSettings').classList.add('hidden');
  renderAll();
});

/* Service Worker Registration */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

window.addEventListener('resize', () => renderAll());
renderAll();
