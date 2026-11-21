import React, { useState, useEffect, useRef, useMemo } from "react";
import "./styles.css";

type TxType = "income" | "expense";
type TabType = "wallet" | "fixed" | "debts" | "pots" | "yearly";
type DebtType = "owed_to_me" | "i_owe";

interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  budget: number;
  type: TxType;
}

interface Transaction {
  id: string;
  date: string;
  monthKey: string;
  type: TxType;
  amount: number;
  categoryId: string;
  note: string;
  fixedId?: string;
}

interface FixedTemplate {
  id: string;
  type: TxType;
  title: string;
  amount: number;
  categoryId: string;
  day: number;
  startMonthKey: string;
  monthsCount: number;
  active: boolean;
}

interface DebtItem {
  id: string;
  type: DebtType;
  person: string;
  totalAmount: number;
  remainingAmount: number;
  note: string;
  date: string;
  settled: boolean;
}

interface PotItem {
  id: string;
  name: string;
  target: number;
  current: number;
  icon: string;
}

interface AppState {
  settings: {
    rollover: boolean;
    privacy: boolean;
  };
  categories: Category[];
  transactions: Transaction[];
  fixedTemplates: FixedTemplate[];
  fixedSkipped: Record<string, Record<string, boolean>>;
  debts: DebtItem[];
  pots: PotItem[];
}

const STORAGE_KEY = "monai_terminal_v1";

const MONTHS_PT = [
  "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
  "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"
];

const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const DEFAULT_CATEGORIES: Category[] = [
  { id: "cat_food", name: "Alimentação", icon: "🍔", color: "#2E8BFF", budget: 350, type: "expense" },
  { id: "cat_home", name: "Casa & Contas", icon: "🏠", color: "#00D4FF", budget: 750, type: "expense" },
  { id: "cat_trans", name: "Transportes", icon: "🚇", color: "#7B61FF", budget: 120, type: "expense" },
  { id: "cat_leisure", name: "Lazer", icon: "🎮", color: "#F0B90B", budget: 150, type: "expense" },
  { id: "cat_health", name: "Saúde", icon: "💊", color: "#FF6B8B", budget: 80, type: "expense" },
  { id: "cat_subs", name: "Subscrições", icon: "⚡", color: "#A855F7", budget: 60, type: "expense" },
  { id: "cat_salary", name: "Salário", icon: "💼", color: "#0ECB81", budget: 0, type: "income" },
  { id: "cat_extra", name: "Extra / Acerto", icon: "📈", color: "#00E5FF", budget: 0, type: "income" }
];

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function getPrevMonthKey(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return getMonthKey(d.getFullYear(), d.getMonth());
}

function monthDiff(startKey: string, targetKey: string): number {
  const [sy, sm] = startKey.split("-").map(Number);
  const [ty, tm] = targetKey.split("-").map(Number);
  return (ty - sy) * 12 + (tm - sm);
}

function formatMonthShort(mKey: string): string {
  const [y, m] = mKey.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

function findCategory(categories: Category[], id: string): Category {
  return (
    categories.find((c) => c.id === id) || {
      id,
      name: "Geral",
      icon: "💠",
      color: "#2E8BFF",
      budget: 0,
      type: "expense"
    }
  );
}

function createInitialState(): AppState {
  return {
    settings: { rollover: false, privacy: false },
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    transactions: [],
    fixedTemplates: [],
    fixedSkipped: {},
    debts: [],
    pots: []
  };
}

function loadInitialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw);
    const base = createInitialState();
    const now = new Date();
    const fallbackKey = getMonthKey(now.getFullYear(), now.getMonth());
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      fixedTemplates: Array.isArray(parsed.fixedTemplates)
        ? parsed.fixedTemplates.map((f: Partial<FixedTemplate>) => ({
            id: f.id || "fix_" + Math.random(),
            type: f.type || "expense",
            title: f.title || "Fixa",
            amount: Number(f.amount) || 0,
            categoryId: f.categoryId || (f.type === "income" ? "cat_salary" : "cat_home"),
            day: f.day || 1,
            startMonthKey: f.startMonthKey || fallbackKey,
            monthsCount: Number(f.monthsCount) || 0,
            active: f.active !== undefined ? Boolean(f.active) : true
          }))
        : [],
      debts: Array.isArray(parsed.debts) ? parsed.debts : [],
      pots: Array.isArray(parsed.pots) ? parsed.pots : [],
      fixedSkipped: parsed.fixedSkipped || {}
    };
  } catch {
    return createInitialState();
  }
}

function isTemplateApplicable(
  tpl: FixedTemplate,
  mKey: string,
  skipped: Record<string, Record<string, boolean>>
): boolean {
  if (!tpl.active) return false;
  const diff = monthDiff(tpl.startMonthKey, mKey);
  if (diff < 0) return false;
  if (tpl.monthsCount > 0 && diff >= tpl.monthsCount) return false;
  if (skipped[mKey]?.[tpl.id]) return false;
  return true;
}

function generateMissingRecurring(currentState: AppState, mKey: string): Transaction[] {
  const [y, m] = mKey.split("-").map(Number);
  const maxDay = new Date(y, m, 0).getDate();
  const created: Transaction[] = [];

  currentState.fixedTemplates.forEach((tpl) => {
    if (!isTemplateApplicable(tpl, mKey, currentState.fixedSkipped)) return;
    const exists = currentState.transactions.some((t) => t.monthKey === mKey && t.fixedId === tpl.id);
    if (!exists) {
      const clampedDay = String(Math.min(tpl.day || 1, maxDay)).padStart(2, "0");
      created.push({
        id: `tx_fix_${tpl.id}_${mKey}`,
        date: `${mKey}-${clampedDay}`,
        monthKey: mKey,
        type: tpl.type,
        amount: tpl.amount,
        categoryId: tpl.categoryId,
        note: tpl.title,
        fixedId: tpl.id
      });
    }
  });

  return created;
}

export default function App() {
  const [state, setState] = useState<AppState>(loadInitialState);
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth());
  const [activeTab, setActiveTab] = useState<TabType>("wallet");

  // Filters
  const [searchTx, setSearchTx] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("ALL");
  const [fixedFilterType, setFixedFilterType] = useState<"ALL" | TxType>("ALL");
  const [debtFilterStatus, setDebtFilterStatus] = useState<"pending" | "settled">("pending");

  // Modals
  const [showTxModal, setShowTxModal] = useState<boolean>(false);
  const [modalTxType, setModalTxType] = useState<TxType>("expense");
  const [txAmount, setTxAmount] = useState<string>("");
  const [txCategoryId, setTxCategoryId] = useState<string>("cat_food");
  const [txDate, setTxDate] = useState<string>("");
  const [txNote, setTxNote] = useState<string>("");

  const [showFixedModal, setShowFixedModal] = useState<boolean>(false);
  const [fixedModalType, setFixedModalType] = useState<TxType>("expense");
  const [fixedTitle, setFixedTitle] = useState<string>("");
  const [fixedAmount, setFixedAmount] = useState<string>("");
  const [fixedCategory, setFixedCategory] = useState<string>("cat_home");
  const [fixedDay, setFixedDay] = useState<string>("1");
  const [fixedDuration, setFixedDuration] = useState<string>("0");

  const [showDebtModal, setShowDebtModal] = useState<boolean>(false);
  const [debtModalType, setDebtModalType] = useState<DebtType>("owed_to_me");
  const [debtAmount, setDebtAmount] = useState<string>("");
  const [debtPerson, setDebtPerson] = useState<string>("");
  const [debtDate, setDebtDate] = useState<string>("");
  const [debtNote, setDebtNote] = useState<string>("");
  const [debtSyncWallet, setDebtSyncWallet] = useState<boolean>(false);

  const [showPotModal, setShowPotModal] = useState<boolean>(false);
  const [potName, setPotName] = useState<string>("");
  const [potTarget, setPotTarget] = useState<string>("");
  const [potIcon, setPotIcon] = useState<string>("🛡️");

  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

  // Canvas Refs
  const dailyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const donutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const yearlyCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const mKey = getMonthKey(selectedYear, selectedMonth);
  const prevKey = getPrevMonthKey(selectedYear, selectedMonth);

  // Register Service Worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Materialize recurring fixed items when switching months
  useEffect(() => {
    const missing = generateMissingRecurring(state, mKey);
    if (missing.length > 0) {
      setState((prev) => {
        const checkAgain = generateMissingRecurring(prev, mKey);
        if (checkAgain.length === 0) return prev;
        return { ...prev, transactions: [...prev.transactions, ...checkAgain] };
      });
    }
  }, [mKey, state]);

  const formatMoney = (val: number, showSign = false): string => {
    if (state.settings.privacy) return "•••• €";
    const abs = Math.abs(val).toLocaleString("pt-PT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const prefix = val < 0 ? "-" : showSign && val > 0 ? "+" : "";
    return `${prefix}${abs} €`;
  };

  // Monthly Summaries
  const monthSummary = useMemo(() => {
    const txs = state.transactions.filter((t) => t.monthKey === mKey);
    const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { txs, income, expense, net: income - expense };
  }, [state.transactions, mKey]);

  const prevSummary = useMemo(() => {
    const txs = state.transactions.filter((t) => t.monthKey === prevKey);
    const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { income, expense, net: income - expense };
  }, [state.transactions, prevKey]);

  const rollover = useMemo(() => {
    if (!state.settings.rollover) return 0;
    return state.transactions
      .filter((t) => t.monthKey < mKey)
      .reduce((sum, t) => sum + (t.type === "income" ? t.amount : -t.amount), 0);
  }, [state.settings.rollover, state.transactions, mKey]);

  const availableBalance = monthSummary.net + rollover;

  // PnL vs Previous Month
  const pnlInfo = useMemo(() => {
    if (prevSummary.income === 0 && prevSummary.expense === 0) {
      return { cls: "neutral", text: "Sem histórico ant." };
    }
    const base = Math.abs(prevSummary.net) || 1;
    const diffPct = ((monthSummary.net - prevSummary.net) / base) * 100;
    return {
      cls: diffPct >= 0 ? "positive" : "negative",
      text: `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}% vs mês ant.`
    };
  }, [monthSummary.net, prevSummary]);

  const filteredTransactions = useMemo(() => {
    const q = searchTx.trim().toLowerCase();
    return [...monthSummary.txs]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .filter((t) => {
        if (filterCategory !== "ALL" && t.categoryId !== filterCategory) return false;
        if (!q) return true;
        const cat = findCategory(state.categories, t.categoryId);
        return (
          (t.note || "").toLowerCase().includes(q) ||
          cat.name.toLowerCase().includes(q) ||
          String(t.amount).includes(q)
        );
      });
  }, [monthSummary.txs, searchTx, filterCategory, state.categories]);

  const donutEntries = useMemo(() => {
    const totals: Record<string, number> = {};
    monthSummary.txs
      .filter((t) => t.type === "expense")
      .forEach((t) => {
        totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount;
      });
    return Object.entries(totals)
      .map(([catId, amount]) => ({ cat: findCategory(state.categories, catId), amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthSummary.txs, state.categories]);

  // Yearly Data
  const yearlyData = useMemo(() => {
    let yearNet = 0;
    const rows = MONTHS_SHORT.map((label, idx) => {
      const k = getMonthKey(selectedYear, idx);
      const txs = state.transactions.filter((t) => t.monthKey === k);
      const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
      const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
      const net = income - expense;
      yearNet += net;
      return { month: label, income, expense, net };
    });
    return { rows, yearNet };
  }, [selectedYear, state.transactions]);

  // Draw Charts
  useEffect(() => {
    const drawAllCharts = () => {
      if (dailyCanvasRef.current && activeTab === "wallet") {
        const canvas = dailyCanvasRef.current;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.getBoundingClientRect().width || 340;
        const height = 150;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, height);
          const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
          const dailyDelta = new Array(daysInMonth).fill(0);
          monthSummary.txs.forEach((t) => {
            const d = parseInt(t.date.split("-")[2], 10);
            if (d >= 1 && d <= daysInMonth) {
              dailyDelta[d - 1] += t.type === "income" ? t.amount : -t.amount;
            }
          });

          const points: number[] = [];
          let running = rollover;
          for (let i = 0; i < daysInMonth; i++) {
            running += dailyDelta[i];
            points.push(running);
          }

          const minVal = Math.min(0, ...points);
          const maxVal = Math.max(10, ...points);
          const range = maxVal - minVal || 1;
          const padX = 10;
          const padY = 18;
          const plotW = width - padX * 2;
          const plotH = height - padY * 2;

          ctx.strokeStyle = "#1E2329";
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

          const grad = ctx.createLinearGradient(0, padY, 0, height);
          grad.addColorStop(0, "rgba(46, 139, 255, 0.35)");
          grad.addColorStop(1, "rgba(0, 102, 255, 0.0)");

          ctx.beginPath();
          ctx.moveTo(coords[0].x, height - padY);
          coords.forEach((p) => ctx.lineTo(p.x, p.y));
          ctx.lineTo(coords[coords.length - 1].x, height - padY);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();

          ctx.beginPath();
          coords.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.strokeStyle = "#2E8BFF";
          ctx.lineWidth = 2.4;
          ctx.shadowColor = "rgba(0, 102, 255, 0.8)";
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.shadowBlur = 0;

          const last = coords[coords.length - 1];
          ctx.beginPath();
          ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#FFFFFF";
          ctx.fill();
          ctx.strokeStyle = "#0066FF";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      if (donutCanvasRef.current && activeTab === "wallet") {
        const canvas = donutCanvasRef.current;
        const dpr = window.devicePixelRatio || 1;
        const size = 130;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, size, size);
          const cx = size / 2;
          const cy = size / 2;
          const radius = 50;
          const lineWidth = 14;

          if (!donutEntries.length || monthSummary.expense <= 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = "#2B3139";
            ctx.lineWidth = lineWidth;
            ctx.stroke();
          } else {
            let startAngle = -Math.PI / 2;
            donutEntries.forEach(({ cat, amount }) => {
              const slice = (amount / monthSummary.expense) * Math.PI * 2;
              ctx.beginPath();
              ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
              ctx.strokeStyle = cat.color;
              ctx.lineWidth = lineWidth;
              ctx.stroke();
              startAngle += slice;
            });
          }
        }
      }

      if (yearlyCanvasRef.current && activeTab === "yearly") {
        const canvas = yearlyCanvasRef.current;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.getBoundingClientRect().width || 340;
        const height = 190;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, width, height);
          const maxVal = Math.max(100, ...yearlyData.rows.map((d) => Math.max(d.income, d.expense)));
          const padB = 22;
          const padT = 12;
          const plotH = height - padB - padT;
          const groupW = width / 12;
          const barW = Math.max(4, groupW * 0.28);

          yearlyData.rows.forEach((d, i) => {
            const baseX = i * groupW + groupW * 0.18;
            const incH = (d.income / maxVal) * plotH;
            const expH = (d.expense / maxVal) * plotH;

            ctx.fillStyle = "#0ECB81";
            ctx.fillRect(baseX, padT + plotH - incH, barW, incH);

            ctx.fillStyle = "#F6465D";
            ctx.fillRect(baseX + barW + 2, padT + plotH - expH, barW, expH);

            ctx.fillStyle = "#848E9C";
            ctx.font = "10px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(d.month[0], i * groupW + groupW / 2, height - 6);
          });
        }
      }
    };

    drawAllCharts();
    window.addEventListener("resize", drawAllCharts);
    return () => window.removeEventListener("resize", drawAllCharts);
  }, [activeTab, selectedYear, selectedMonth, monthSummary, rollover, donutEntries, yearlyData]);

  // Handlers
  const changeMonth = (delta: number) => {
    const d = new Date(selectedYear, selectedMonth + delta, 1);
    setSelectedYear(d.getFullYear());
    setSelectedMonth(d.getMonth());
  };

  const resetToToday = () => {
    const d = new Date();
    setSelectedYear(d.getFullYear());
    setSelectedMonth(d.getMonth());
  };

  const openTxModal = (type: TxType) => {
    setModalTxType(type);
    setTxAmount("");
    setTxNote("");
    const cats = state.categories.filter((c) => c.type === type);
    setTxCategoryId(cats[0]?.id || "cat_food");
    const today = new Date();
    const isCurrent = today.getFullYear() === selectedYear && today.getMonth() === selectedMonth;
    setTxDate(isCurrent ? today.toISOString().split("T")[0] : `${mKey}-01`);
    setShowTxModal(true);
  };

  const handleTxTypeSwitch = (type: TxType) => {
    setModalTxType(type);
    const cats = state.categories.filter((c) => c.type === type);
    if (!cats.some((c) => c.id === txCategoryId)) {
      setTxCategoryId(cats[0]?.id || "cat_food");
    }
  };

  const handleCreateTx = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(txAmount);
    if (!amt || amt <= 0 || !txDate) return;
    const targetMKey = txDate.slice(0, 7);
    const newTx: Transaction = {
      id: "tx_" + Date.now(),
      date: txDate,
      monthKey: targetMKey,
      type: modalTxType,
      amount: amt,
      categoryId: txCategoryId,
      note: txNote.trim()
    };
    const [y, m] = targetMKey.split("-").map(Number);
    setSelectedYear(y);
    setSelectedMonth(m - 1);
    setState((prev) => ({ ...prev, transactions: [...prev.transactions, newTx] }));
    setShowTxModal(false);
  };

  const handleDeleteTx = (tx: Transaction) => {
    setState((prev) => {
      const nextSkipped = { ...prev.fixedSkipped };
      if (tx.fixedId) {
        nextSkipped[tx.monthKey] = { ...(nextSkipped[tx.monthKey] || {}), [tx.fixedId]: true };
      }
      return {
        ...prev,
        fixedSkipped: nextSkipped,
        transactions: prev.transactions.filter((t) => t.id !== tx.id)
      };
    });
  };

  const openFixedModal = () => {
    setFixedModalType("expense");
    setFixedTitle("");
    setFixedAmount("");
    setFixedCategory("cat_home");
    setFixedDay("1");
    setFixedDuration("0");
    setShowFixedModal(true);
  };

  const handleFixedModalTypeChange = (type: TxType) => {
    setFixedModalType(type);
    const firstCat = state.categories.find((c) => c.type === type);
    if (firstCat) setFixedCategory(firstCat.id);
  };

  const handleCreateFixed = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(fixedAmount);
    if (!fixedTitle.trim() || !amt || amt <= 0) return;
    const dayNum = Math.min(28, Math.max(1, parseInt(fixedDay, 10) || 1));
    const durNum = parseInt(fixedDuration, 10) || 0;
    const newTpl: FixedTemplate = {
      id: "fix_" + Date.now(),
      type: fixedModalType,
      title: fixedTitle.trim(),
      amount: amt,
      categoryId: fixedCategory,
      day: dayNum,
      startMonthKey: mKey,
      monthsCount: durNum,
      active: true
    };
    setState((prev) => ({
      ...prev,
      fixedTemplates: [...prev.fixedTemplates, newTpl]
    }));
    setShowFixedModal(false);
  };

  const toggleFixedActive = (tpl: FixedTemplate) => {
    setState((prev) => {
      const nextActive = !tpl.active;
      return {
        ...prev,
        fixedTemplates: prev.fixedTemplates.map((f) =>
          f.id === tpl.id
            ? {
                ...f,
                active: nextActive,
                startMonthKey: nextActive && mKey < f.startMonthKey ? mKey : f.startMonthKey
              }
            : f
        ),
        transactions: nextActive
          ? prev.transactions
          : prev.transactions.filter((t) => !(t.fixedId === tpl.id && t.monthKey >= mKey))
      };
    });
  };

  const editFixedAmount = (tpl: FixedTemplate) => {
    const raw = window.prompt(`Novo valor mensal (€) para "${tpl.title}":`, String(tpl.amount));
    if (!raw) return;
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) return;
    setState((prev) => ({
      ...prev,
      fixedTemplates: prev.fixedTemplates.map((f) => (f.id === tpl.id ? { ...f, amount: val } : f)),
      transactions: prev.transactions.map((t) =>
        t.fixedId === tpl.id && t.monthKey >= mKey ? { ...t, amount: val } : t
      )
    }));
  };

  const deleteFixedTemplate = (id: string) => {
    setState((prev) => ({
      ...prev,
      fixedTemplates: prev.fixedTemplates.filter((f) => f.id !== id),
      transactions: prev.transactions.filter((t) => !(t.fixedId === id && t.monthKey >= mKey))
    }));
  };

  const editCategoryBudget = (cat: Category) => {
    const raw = window.prompt(`Limite mensal (€) para ${cat.name}:`, String(cat.budget || 0));
    if (raw === null) return;
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    setState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) =>
        c.id === cat.id ? { ...c, budget: Math.max(0, val) } : c
      )
    }));
  };

  // Debts Handlers
  const openDebtModal = () => {
    setDebtModalType("owed_to_me");
    setDebtAmount("");
    setDebtPerson("");
    setDebtNote("");
    setDebtDate(new Date().toISOString().split("T")[0]);
    setDebtSyncWallet(false);
    setShowDebtModal(true);
  };

  const handleCreateDebt = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(debtAmount);
    if (!amt || amt <= 0 || !debtPerson.trim() || !debtDate) return;
    const newDebt: DebtItem = {
      id: "debt_" + Date.now(),
      type: debtModalType,
      person: debtPerson.trim(),
      totalAmount: amt,
      remainingAmount: amt,
      note: debtNote.trim(),
      date: debtDate,
      settled: false
    };

    setState((prev) => {
      const nextTxs = [...prev.transactions];
      if (debtSyncWallet) {
        const isLending = debtModalType === "owed_to_me";
        nextTxs.push({
          id: "tx_debt_init_" + Date.now(),
          date: debtDate,
          monthKey: debtDate.slice(0, 7),
          type: isLending ? "expense" : "income",
          amount: amt,
          categoryId: isLending ? "cat_leisure" : "cat_extra",
          note: `${isLending ? "Emprestado a" : "Empréstimo de"} ${debtPerson.trim()}`
        });
      }
      return { ...prev, debts: [...prev.debts, newDebt], transactions: nextTxs };
    });
    setShowDebtModal(false);
  };

  const settleDebtAmount = (debt: DebtItem, isFull: boolean) => {
    let paid = debt.remainingAmount;
    if (!isFull) {
      const raw = window.prompt(
        debt.type === "owed_to_me"
          ? `Quanto é que ${debt.person} já te pagou (€)? (Falta ${debt.remainingAmount.toFixed(2)} €)`
          : `Quanto já pagaste a ${debt.person} (€)? (Falta ${debt.remainingAmount.toFixed(2)} €)`
      );
      if (!raw) return;
      const parsed = parseFloat(raw);
      if (isNaN(parsed) || parsed <= 0) return;
      paid = Math.min(debt.remainingAmount, parsed);
    }

    const syncToWallet =
      paid > 0 && window.confirm("Queres registar este acerto na Carteira do mês atual?");

    setState((prev) => {
      const nextDebts = prev.debts.map((d) => {
        if (d.id !== debt.id) return d;
        const rem = Math.max(0, +(d.remainingAmount - paid).toFixed(2));
        return { ...d, remainingAmount: rem, settled: rem === 0 };
      });
      const nextTxs = [...prev.transactions];
      if (syncToWallet) {
        const isInc = debt.type === "owed_to_me";
        nextTxs.push({
          id: "tx_debt_" + Date.now(),
          date: new Date().toISOString().split("T")[0],
          monthKey: mKey,
          type: isInc ? "income" : "expense",
          amount: paid,
          categoryId: isInc ? "cat_extra" : "cat_leisure",
          note: `${isInc ? "Recebido de" : "Pago a"} ${debt.person}`
        });
      }
      return { ...prev, debts: nextDebts, transactions: nextTxs };
    });
  };

  // Pots Handlers
  const handleCreatePot = (e: React.FormEvent) => {
    e.preventDefault();
    const tgt = parseFloat(potTarget);
    if (!potName.trim() || !tgt || tgt <= 0) return;
    setState((prev) => ({
      ...prev,
      pots: [
        ...prev.pots,
        { id: "pot_" + Date.now(), name: potName.trim(), target: tgt, current: 0, icon: potIcon }
      ]
    }));
    setPotName("");
    setPotTarget("");
    setShowPotModal(false);
  };

  const movePotMoney = (pot: PotItem, dir: "add" | "sub") => {
    const raw = window.prompt(
      dir === "add"
        ? `Quanto queres reforçar em "${pot.name}" (€)?`
        : `Quanto queres retirar de "${pot.name}" (€)?`
    );
    if (!raw) return;
    const amt = parseFloat(raw);
    if (isNaN(amt) || amt <= 0) return;
    setState((prev) => ({
      ...prev,
      pots: prev.pots.map((p) =>
        p.id === pot.id
          ? { ...p, current: dir === "add" ? p.current + amt : Math.max(0, p.current - amt) }
          : p
      )
    }));
  };

  // Backup & Demo
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monai-backup-${mKey}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result));
        if (!Array.isArray(imported.transactions)) throw new Error();
        setState({ ...createInitialState(), ...imported });
        setShowSettingsModal(false);
        alert("Backup restaurado com sucesso!");
      } catch {
        alert("Ficheiro JSON inválido.");
      }
    };
    reader.readAsText(file);
  };

  const loadDemoData = () => {
    const demo: AppState = createInitialState();
    demo.transactions = [
      { id: "d1", date: `${prevKey}-01`, monthKey: prevKey, type: "income", amount: 1450, categoryId: "cat_salary", note: "Salário Base" },
      { id: "d2", date: `${prevKey}-10`, monthKey: prevKey, type: "expense", amount: 890, categoryId: "cat_home", note: "Despesas Mês Anterior" },
      { id: "d5", date: `${mKey}-06`, monthKey: mKey, type: "expense", amount: 84.5, categoryId: "cat_food", note: "Supermercado Continente" },
      { id: "d6", date: `${mKey}-09`, monthKey: mKey, type: "expense", amount: 40, categoryId: "cat_trans", note: "Passe Andante" },
      { id: "d7", date: `${mKey}-12`, monthKey: mKey, type: "income", amount: 180, categoryId: "cat_extra", note: "Lucro Extra" }
    ];
    demo.fixedTemplates = [
      { id: "f_sal", type: "income", title: "Salário Mensal", amount: 1450, categoryId: "cat_salary", day: 1, startMonthKey: mKey, monthsCount: 0, active: true },
      { id: "f1", type: "expense", title: "Renda Casa", amount: 520, categoryId: "cat_home", day: 2, startMonthKey: mKey, monthsCount: 0, active: true },
      { id: "f2", type: "expense", title: "Ginásio", amount: 34.9, categoryId: "cat_health", day: 5, startMonthKey: mKey, monthsCount: 0, active: true },
      { id: "f3", type: "expense", title: "Internet & Telemóvel", amount: 29.99, categoryId: "cat_subs", day: 8, startMonthKey: mKey, monthsCount: 0, active: true }
    ];
    demo.debts = [
      { id: "db1", type: "owed_to_me", person: "João Silva", totalAmount: 45, remainingAmount: 45, note: "Jantar & Uber sexta", date: `${mKey}-10`, settled: false },
      { id: "db2", type: "i_owe", person: "Ana Costa", totalAmount: 25, remainingAmount: 25, note: "Bilhete Cinema", date: `${mKey}-14`, settled: false }
    ];
    demo.pots = [
      { id: "p1", name: "Fundo de Emergência", target: 3000, current: 1150, icon: "🛡️" },
      { id: "p2", name: "Férias 2027", target: 1200, current: 420, icon: "✈️" }
    ];
    setState(demo);
    setShowSettingsModal(false);
  };

  // Computed metrics for Fixed & Debts
  const activeFixedInMonth = state.fixedTemplates.filter((f) =>
    isTemplateApplicable(f, mKey, state.fixedSkipped)
  );
  const fixedIncTotal = activeFixedInMonth
    .filter((f) => f.type === "income")
    .reduce((s, f) => s + f.amount, 0);
  const fixedExpTotal = activeFixedInMonth
    .filter((f) => f.type === "expense")
    .reduce((s, f) => s + f.amount, 0);
  const fixedNetTotal = fixedIncTotal - fixedExpTotal;

  const pendingDebts = state.debts.filter((d) => !d.settled);
  const owedToMeTotal = pendingDebts
    .filter((d) => d.type === "owed_to_me")
    .reduce((s, d) => s + d.remainingAmount, 0);
  const iOweTotal = pendingDebts
    .filter((d) => d.type === "i_owe")
    .reduce((s, d) => s + d.remainingAmount, 0);
  const debtsNet = owedToMeTotal - iOweTotal;

  const potsGrandTotal = state.pots.reduce((s, p) => s + p.current, 0);
  const expenseRatio =
    monthSummary.income > 0
      ? Math.min(999, Math.round((monthSummary.expense / monthSummary.income) * 100))
      : monthSummary.expense > 0
      ? 100
      : 0;

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">€</div>
          <span className="brand-name">
            Mon<span className="brand-ai">AI</span>
          </span>
          <span className="live-dot" title="Memória Local Ativa" />
        </div>
        <div className="topbar-actions">
          <button
            className="icon-btn"
            title="Ocultar/Mostrar Valores"
            onClick={() =>
              setState((prev) => ({
                ...prev,
                settings: { ...prev.settings, privacy: !prev.settings.privacy }
              }))
            }
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <button
            className="icon-btn"
            title="Definições e Backup"
            onClick={() => setShowSettingsModal(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Month Navigator */}
      <nav className="month-bar" aria-label="Navegação Mensal">
        <button className="month-arrow" onClick={() => changeMonth(-1)}>‹</button>
        <button className="month-title" onClick={resetToToday} title="Voltar ao mês atual">
          {MONTHS_PT[selectedMonth]} {selectedYear}
        </button>
        <button className="month-arrow" onClick={() => changeMonth(1)}>›</button>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        {/* TAB 1: CARTEIRA */}
        {activeTab === "wallet" && (
          <>
            <div className="card hero-card">
              <div className="hero-top">
                <span className="label-muted">SALDO DISPONÍVEL DO MÊS</span>
                <span className={`pnl-badge ${pnlInfo.cls}`}>{pnlInfo.text}</span>
              </div>
              <div
                className="hero-balance mono"
                style={{ color: availableBalance < 0 ? "var(--red)" : "var(--text-main)" }}
              >
                {formatMoney(availableBalance)}
              </div>
              {state.settings.rollover && rollover !== 0 && (
                <div className="rollover-note">
                  Inclui <span className="mono">{formatMoney(rollover, true)}</span> transitado
                </div>
              )}

              <div className="summary-grid">
                <div className="summary-box">
                  <span className="summary-label">ENTRADAS</span>
                  <span className="summary-val green mono">{formatMoney(monthSummary.income, true)}</span>
                </div>
                <div className="summary-box">
                  <span className="summary-label">SAÍDAS</span>
                  <span className="summary-val red mono">{formatMoney(-monthSummary.expense)}</span>
                </div>
              </div>

              <div className="quick-actions">
                <button className="action-btn primary-glow" onClick={() => openTxModal("income")}>
                  <span className="action-icon">+</span>
                  <span>Entrada</span>
                </button>
                <button className="action-btn danger-outline" onClick={() => openTxModal("expense")}>
                  <span className="action-icon">−</span>
                  <span>Gasto</span>
                </button>
                <button className="action-btn" onClick={() => setActiveTab("fixed")}>
                  <span className="action-icon">⚡</span>
                  <span>Fixas</span>
                </button>
                <button className="action-btn" onClick={() => setActiveTab("debts")}>
                  <span className="action-icon">⇄</span>
                  <span>Dívidas</span>
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Evolução do Saldo Diário</h3>
                <span className="pill-tag">Fixas: {activeFixedInMonth.length} ativas</span>
              </div>
              <div className="canvas-wrap">
                <canvas ref={dailyCanvasRef} height={150} />
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Distribuição de Gastos</h3>
                <span className="pill-tag">{expenseRatio}% da receita</span>
              </div>
              <div className="donut-layout">
                <div className="donut-box">
                  <canvas ref={donutCanvasRef} width={130} height={130} />
                  <div className="donut-center">
                    <span className="donut-sub">TOTAL</span>
                    <span className="donut-val mono">
                      {state.settings.privacy ? "•••" : `${Math.round(monthSummary.expense)}€`}
                    </span>
                  </div>
                </div>
                <div className="category-legend">
                  {donutEntries.length === 0 ? (
                    <span className="sub-text">Sem despesas neste mês.</span>
                  ) : (
                    donutEntries.slice(0, 4).map(({ cat, amount }) => (
                      <div key={cat.id} className="legend-item">
                        <span className="legend-left">
                          <i className="legend-dot" style={{ background: cat.color }} />
                          <span>{cat.name}</span>
                        </span>
                        <span className="mono">
                          {Math.round((amount / monthSummary.expense) * 100)}%
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Livro de Movimentos</h3>
                <select
                  className="mini-select"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                >
                  <option value="ALL">Todas</option>
                  {state.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="search"
                className="search-input"
                placeholder="Pesquisar descrição ou valor..."
                value={searchTx}
                onChange={(e) => setSearchTx(e.target.value)}
              />
              <div className="tx-list">
                {filteredTransactions.length === 0 ? (
                  <div className="empty-state">Sem movimentos registados neste filtro.</div>
                ) : (
                  filteredTransactions.map((t) => {
                    const cat = findCategory(state.categories, t.categoryId);
                    const signVal = t.type === "income" ? t.amount : -t.amount;
                    const dayLabel = t.date.split("-").reverse().slice(0, 2).join("/");
                    return (
                      <div key={t.id} className="tx-item">
                        <div className="tx-left">
                          <div className="tx-icon">{cat.icon}</div>
                          <div className="tx-meta">
                            <div className="tx-title">{t.note || cat.name}</div>
                            <div className="tx-sub">
                              {cat.name} • {dayLabel}
                              {t.fixedId ? " • 🔄 Fixa" : ""}
                            </div>
                          </div>
                        </div>
                        <div className="tx-right">
                          <span className={`tx-amount mono ${t.type === "income" ? "green" : "red"}`}>
                            {formatMoney(signVal, true)}
                          </span>
                          <button className="del-btn" onClick={() => handleDeleteTx(t)} title="Eliminar">
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}

        {/* TAB 2: FIXAS & ORÇAMENTOS */}
        {activeTab === "fixed" && (
          <>
            <div className="card hero-card">
              <div className="hero-top">
                <span className="label-muted">BALANÇO FIXO MENSAL RECORRENTE</span>
                <span className="pill-tag blue-tag">Auto-Mensal</span>
              </div>
              <div
                className="hero-balance mono"
                style={{
                  color:
                    fixedNetTotal < 0
                      ? "var(--red)"
                      : fixedNetTotal > 0
                      ? "var(--green)"
                      : "var(--text-main)"
                }}
              >
                {formatMoney(fixedNetTotal, true)}
              </div>
              <div className="summary-grid" style={{ marginBottom: 0 }}>
                <div className="summary-box">
                  <span className="summary-label">ENTRADAS FIXAS</span>
                  <span className="summary-val green mono">{formatMoney(fixedIncTotal, true)}</span>
                </div>
                <div className="summary-box">
                  <span className="summary-label">SAÍDAS FIXAS</span>
                  <span className="summary-val red mono">{formatMoney(-fixedExpTotal)}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h3>Entradas & Saídas Fixas</h3>
                  <p className="sub-text">Mantêm-se automaticamente nos próximos meses</p>
                </div>
                <button className="btn-small" onClick={openFixedModal}>+ Nova Fixa</button>
              </div>

              <div className="filter-pills">
                {(["ALL", "income", "expense"] as const).map((fType) => (
                  <button
                    key={fType}
                    type="button"
                    className={`pill-filter ${fixedFilterType === fType ? "active" : ""}`}
                    onClick={() => setFixedFilterType(fType)}
                  >
                    {fType === "ALL" ? "Todas" : fType === "income" ? "Entradas" : "Saídas"}
                  </button>
                ))}
              </div>

              <div className="stack-list">
                {state.fixedTemplates.filter((f) => fixedFilterType === "ALL" || f.type === fixedFilterType)
                  .length === 0 ? (
                  <div className="empty-state">
                    Cria entradas fixas (Salário) ou saídas fixas (Renda, Ginásio) para ficarem guardadas nos próximos meses.
                  </div>
                ) : (
                  state.fixedTemplates
                    .filter((f) => fixedFilterType === "ALL" || f.type === fixedFilterType)
                    .map((f) => {
                      const cat = findCategory(state.categories, f.categoryId);
                      const isInc = f.type === "income";
                      const durationText =
                        f.monthsCount > 0
                          ? `${f.monthsCount} meses desde ${formatMonthShort(f.startMonthKey)}`
                          : `Contínuo desde ${formatMonthShort(f.startMonthKey)}`;
                      return (
                        <div key={f.id} className={`fixed-item ${!f.active ? "is-paused" : ""}`}>
                          <div className="tx-left">
                            <div className="tx-icon">{cat.icon}</div>
                            <div className="tx-meta">
                              <div className="tx-title">{f.title}</div>
                              <div className="tx-sub">
                                Dia {f.day} • {durationText}
                              </div>
                            </div>
                          </div>
                          <div className="tx-right">
                            <button
                              className={`del-btn mono ${isInc ? "green" : "red"}`}
                              style={{ fontWeight: 700, fontSize: 12 }}
                              onClick={() => editFixedAmount(f)}
                              title="Alterar valor"
                            >
                              {formatMoney(isInc ? f.amount : -f.amount, true)}
                            </button>
                            <button
                              className={`pay-toggle ${f.active ? "paid" : ""}`}
                              onClick={() => toggleFixedActive(f)}
                            >
                              {f.active ? "Ativa" : "Pausada"}
                            </button>
                            <button
                              className="del-btn"
                              onClick={() => deleteFixedTemplate(f.id)}
                              title="Eliminar fixa"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h3>Limites por Categoria</h3>
                  <p className="sub-text">Teto mensal definido para cada categoria</p>
                </div>
              </div>
              <div className="stack-list">
                {state.categories
                  .filter((c) => c.type === "expense")
                  .map((cat) => {
                    const spent = monthSummary.txs
                      .filter((t) => t.type === "expense" && t.categoryId === cat.id)
                      .reduce((s, t) => s + t.amount, 0);
                    const pct = cat.budget > 0 ? Math.min(100, Math.round((spent / cat.budget) * 100)) : 0;
                    const barCls =
                      cat.budget > 0 && spent > cat.budget ? "over" : pct >= 80 ? "warn" : "";
                    return (
                      <div key={cat.id} className="budget-item">
                        <div className="budget-top">
                          <span>
                            {cat.icon} <strong>{cat.name}</strong>
                          </span>
                          <span className="mono">
                            {formatMoney(spent)} /{" "}
                            <button
                              className="del-btn blue-text mono"
                              onClick={() => editCategoryBudget(cat)}
                            >
                              {cat.budget > 0 ? formatMoney(cat.budget) : "Definir"}
                            </button>
                          </span>
                        </div>
                        <div className="progress-track">
                          <div className={`progress-fill ${barCls}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </>
        )}

        {/* TAB 3: DÍVIDAS */}
        {activeTab === "debts" && (
          <>
            <div className="card hero-card">
              <div className="hero-top">
                <span className="label-muted">BALANÇO DE CRÉDITOS & DÍVIDAS</span>
                <span
                  className={`pnl-badge ${
                    debtsNet > 0 ? "positive" : debtsNet < 0 ? "negative" : "neutral"
                  }`}
                >
                  {formatMoney(debtsNet, true)}
                </span>
              </div>
              <div className="summary-grid" style={{ marginTop: 8, marginBottom: 12 }}>
                <div className="summary-box">
                  <span className="summary-label">DEVEM-ME (A RECEBER)</span>
                  <span className="summary-val green mono">{formatMoney(owedToMeTotal, true)}</span>
                </div>
                <div className="summary-box">
                  <span className="summary-label">DEVO (A PAGAR)</span>
                  <span className="summary-val red mono">{formatMoney(-iOweTotal)}</span>
                </div>
              </div>
              <button className="btn-full primary-glow" style={{ marginTop: 0 }} onClick={openDebtModal}>
                + Registar Pessoa / Valor
              </button>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Registo por Pessoa</h3>
                <div className="filter-pills" style={{ marginBottom: 0 }}>
                  <button
                    type="button"
                    className={`pill-filter ${debtFilterStatus === "pending" ? "active" : ""}`}
                    onClick={() => setDebtFilterStatus("pending")}
                  >
                    Pendentes
                  </button>
                  <button
                    type="button"
                    className={`pill-filter ${debtFilterStatus === "settled" ? "active" : ""}`}
                    onClick={() => setDebtFilterStatus("settled")}
                  >
                    Liquidados
                  </button>
                </div>
              </div>

              <div className="stack-list">
                {state.debts.filter((d) => (debtFilterStatus === "settled" ? d.settled : !d.settled))
                  .length === 0 ? (
                  <div className="empty-state">
                    {debtFilterStatus === "pending"
                      ? "Sem valores pendentes com ninguém neste momento."
                      : "Ainda não tens dívidas liquidadas no histórico."}
                  </div>
                ) : (
                  state.debts
                    .filter((d) => (debtFilterStatus === "settled" ? d.settled : !d.settled))
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((d) => {
                      const isOwedToMe = d.type === "owed_to_me";
                      const initials = d.person.trim().slice(0, 2).toUpperCase();
                      const dateLabel = d.date.split("-").reverse().join("/");
                      const partialInfo =
                        d.remainingAmount < d.totalAmount && !d.settled
                          ? ` (de ${formatMoney(d.totalAmount)})`
                          : "";
                      return (
                        <div key={d.id} className={`debt-card ${isOwedToMe ? "owed-to-me" : "i-owe"}`}>
                          <div className="debt-top">
                            <div className="tx-left">
                              <div className="person-avatar">{initials}</div>
                              <div className="tx-meta">
                                <div className="tx-title">
                                  {d.person}
                                  <span className={`debt-badge ${isOwedToMe ? "in" : "out"}`}>
                                    {isOwedToMe ? "Deve-me" : "Devo"}
                                  </span>
                                </div>
                                <div className="tx-sub">
                                  {d.note || "Sem nota"} • {dateLabel}
                                  {partialInfo}
                                </div>
                              </div>
                            </div>
                            <div className="tx-right">
                              <span className={`tx-amount mono ${isOwedToMe ? "green" : "red"}`}>
                                {formatMoney(d.settled ? d.totalAmount : d.remainingAmount)}
                              </span>
                              <button
                                className="del-btn"
                                onClick={() =>
                                  setState((prev) => ({
                                    ...prev,
                                    debts: prev.debts.filter((item) => item.id !== d.id)
                                  }))
                                }
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                          {!d.settled && (
                            <div className="debt-actions">
                              <button
                                className="btn-mini-action"
                                onClick={() => settleDebtAmount(d, false)}
                              >
                                Abater Parte
                              </button>
                              <button
                                className="btn-mini-action settle"
                                onClick={() => settleDebtAmount(d, true)}
                              >
                                ✓ Liquidar Tudo
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </>
        )}

        {/* TAB 4: COFRES */}
        {activeTab === "pots" && (
          <>
            <div className="card hero-card">
              <div className="hero-top">
                <span className="label-muted">TOTAL ACUMULADO EM COFRES</span>
                <span className="pill-tag blue-tag">Contínuo</span>
              </div>
              <div className="hero-balance mono">{formatMoney(potsGrandTotal)}</div>
              <button
                className="btn-full primary-glow"
                style={{ marginTop: 12 }}
                onClick={() => setShowPotModal(true)}
              >
                + Criar Novo Cofre
              </button>
            </div>

            <div className="stack-list">
              {state.pots.length === 0 ? (
                <div className="card empty-state">
                  Cria cofres contínuos (ex: Fundo de Emergência) que não fazem reset quando muda o mês.
                </div>
              ) : (
                state.pots.map((p) => {
                  const pct = p.target > 0 ? Math.min(100, Math.round((p.current / p.target) * 100)) : 0;
                  return (
                    <div key={p.id} className="pot-card">
                      <div className="card-header">
                        <div>
                          <h3>
                            {p.icon} {p.name}
                          </h3>
                          <p className="sub-text mono">
                            {formatMoney(p.current)} de {formatMoney(p.target)} ({pct}%)
                          </p>
                        </div>
                        <button
                          className="del-btn"
                          onClick={() =>
                            setState((prev) => ({
                              ...prev,
                              pots: prev.pots.filter((item) => item.id !== p.id)
                            }))
                          }
                        >
                          ✕
                        </button>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="pot-actions">
                        <button className="btn-outline" onClick={() => movePotMoney(p, "add")}>
                          + Reforçar
                        </button>
                        <button className="btn-outline" onClick={() => movePotMoney(p, "sub")}>
                          − Retirar
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* TAB 5: ANUAL */}
        {activeTab === "yearly" && (
          <>
            <div className="card">
              <div className="card-header">
                <h3>
                  Performance Anual <span className="blue-text">{selectedYear}</span>
                </h3>
                <span className={`pnl-badge ${yearlyData.yearNet >= 0 ? "positive" : "negative"}`}>
                  {formatMoney(yearlyData.yearNet, true)}
                </span>
              </div>
              <div className="canvas-wrap">
                <canvas ref={yearlyCanvasRef} height={190} />
              </div>
              <div className="legend-inline">
                <span>
                  <i className="dot green-bg" /> Entradas
                </span>
                <span>
                  <i className="dot red-bg" /> Saídas
                </span>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Resumo Mês a Mês</h3>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th>Entradas</th>
                      <th>Saídas</th>
                      <th>Balanço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyData.rows.map((row) => (
                      <tr key={row.month}>
                        <td>{row.month}</td>
                        <td className="green">{formatMoney(row.income)}</td>
                        <td className="red">{formatMoney(row.expense)}</td>
                        <td className={row.net >= 0 ? "green" : "red"}>
                          {formatMoney(row.net, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        <button
          className={`nav-item ${activeTab === "wallet" ? "active" : ""}`}
          onClick={() => setActiveTab("wallet")}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M16 12h.01" />
          </svg>
          <span>Carteira</span>
        </button>
        <button
          className={`nav-item ${activeTab === "fixed" ? "active" : ""}`}
          onClick={() => setActiveTab("fixed")}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span>Fixas</span>
        </button>
        <button
          className={`nav-item ${activeTab === "debts" ? "active" : ""}`}
          onClick={() => setActiveTab("debts")}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>Dívidas</span>
        </button>
        <button
          className={`nav-item ${activeTab === "pots" ? "active" : ""}`}
          onClick={() => setActiveTab("pots")}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Cofres</span>
        </button>
        <button
          className={`nav-item ${activeTab === "yearly" ? "active" : ""}`}
          onClick={() => setActiveTab("yearly")}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <span>Anual</span>
        </button>
      </nav>

      {/* MODAL: NOVO MOVIMENTO */}
      {showTxModal && (
        <div className="modal-backdrop">
          <div className="modal-sheet">
            <div className="modal-header">
              <h3>Novo Movimento</h3>
              <button className="close-modal" onClick={() => setShowTxModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateTx}>
              <div className="type-toggle">
                <button
                  type="button"
                  className={`type-btn ${modalTxType === "expense" ? "active-expense" : ""}`}
                  onClick={() => handleTxTypeSwitch("expense")}
                >
                  Despesa
                </button>
                <button
                  type="button"
                  className={`type-btn ${modalTxType === "income" ? "active-income" : ""}`}
                  onClick={() => handleTxTypeSwitch("income")}
                >
                  Receita
                </button>
              </div>

              <div className="amount-field">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  required
                  autoFocus
                />
                <span className="currency-suffix">€</span>
              </div>

              <label className="field-label">Categoria</label>
              <div className="cat-grid">
                {state.categories
                  .filter((c) => c.type === modalTxType)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`cat-chip ${c.id === txCategoryId ? "selected" : ""}`}
                      onClick={() => setTxCategoryId(c.id)}
                    >
                      {c.icon} {c.name}
                    </button>
                  ))}
              </div>

              <div className="form-row">
                <div>
                  <label className="field-label">Data</label>
                  <input
                    type="date"
                    className="text-input"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Descrição</label>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="Ex: Café, Salário..."
                    maxLength={45}
                    value={txNote}
                    onChange={(e) => setTxNote(e.target.value)}
                  />
                </div>
              </div>

              <button type="submit" className="btn-full primary-glow">
                Confirmar Ordem
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVA FIXA */}
      {showFixedModal && (
        <div className="modal-backdrop">
          <div className="modal-sheet">
            <div className="modal-header">
              <h3>Nova Entrada ou Saída Fixa</h3>
              <button className="close-modal" onClick={() => setShowFixedModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateFixed}>
              <div className="type-toggle">
                <button
                  type="button"
                  className={`type-btn ${fixedModalType === "expense" ? "active-expense" : ""}`}
                  onClick={() => handleFixedModalTypeChange("expense")}
                >
                  Saída Fixa
                </button>
                <button
                  type="button"
                  className={`type-btn ${fixedModalType === "income" ? "active-income" : ""}`}
                  onClick={() => handleFixedModalTypeChange("income")}
                >
                  Entrada Fixa
                </button>
              </div>

              <label className="field-label">Descrição</label>
              <input
                type="text"
                className="text-input"
                placeholder="Ex: Salário, Renda, Ginásio..."
                value={fixedTitle}
                onChange={(e) => setFixedTitle(e.target.value)}
                required
              />

              <div className="form-row">
                <div>
                  <label className="field-label">Valor Mensal (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="text-input mono"
                    placeholder="0.00"
                    value={fixedAmount}
                    onChange={(e) => setFixedAmount(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Categoria</label>
                  <select
                    className="text-input"
                    value={fixedCategory}
                    onChange={(e) => setFixedCategory(e.target.value)}
                  >
                    {state.categories
                      .filter((c) => c.type === fixedModalType)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.icon} {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label className="field-label">Dia do Mês (1-28)</label>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    className="text-input mono"
                    value={fixedDay}
                    onChange={(e) => setFixedDay(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Manter nos próximos meses</label>
                  <select
                    className="text-input"
                    value={fixedDuration}
                    onChange={(e) => setFixedDuration(e.target.value)}
                  >
                    <option value="0">Contínuo (Sem fim)</option>
                    <option value="3">Durante 3 meses</option>
                    <option value="6">Durante 6 meses</option>
                    <option value="12">Durante 12 meses</option>
                    <option value="24">Durante 24 meses</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="btn-full primary-glow">
                Ativar nos Próximos Meses
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVA DÍVIDA */}
      {showDebtModal && (
        <div className="modal-backdrop">
          <div className="modal-sheet">
            <div className="modal-header">
              <h3>Registar Dívida / Empréstimo</h3>
              <button className="close-modal" onClick={() => setShowDebtModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateDebt}>
              <div className="type-toggle">
                <button
                  type="button"
                  className={`type-btn ${debtModalType === "owed_to_me" ? "active-income" : ""}`}
                  onClick={() => setDebtModalType("owed_to_me")}
                >
                  Devem-me
                </button>
                <button
                  type="button"
                  className={`type-btn ${debtModalType === "i_owe" ? "active-expense" : ""}`}
                  onClick={() => setDebtModalType("i_owe")}
                >
                  Eu Devo
                </button>
              </div>

              <div className="amount-field">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={debtAmount}
                  onChange={(e) => setDebtAmount(e.target.value)}
                  required
                  autoFocus
                />
                <span className="currency-suffix">€</span>
              </div>

              <div className="form-row">
                <div>
                  <label className="field-label">Pessoa</label>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="Ex: João, Ana..."
                    maxLength={30}
                    value={debtPerson}
                    onChange={(e) => setDebtPerson(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Data</label>
                  <input
                    type="date"
                    className="text-input"
                    value={debtDate}
                    onChange={(e) => setDebtDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <label className="field-label">Motivo / Nota</label>
              <input
                type="text"
                className="text-input"
                placeholder="Ex: Jantar, Bilhete, Empréstimo..."
                maxLength={45}
                value={debtNote}
                onChange={(e) => setDebtNote(e.target.value)}
              />

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={debtSyncWallet}
                  onChange={(e) => setDebtSyncWallet(e.target.checked)}
                />
                <span>Refletir também já na Carteira do mês</span>
              </label>

              <button type="submit" className="btn-full primary-glow">
                Guardar Registo
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVO COFRE */}
      {showPotModal && (
        <div className="modal-backdrop">
          <div className="modal-sheet">
            <div className="modal-header">
              <h3>Novo Cofre de Poupança</h3>
              <button className="close-modal" onClick={() => setShowPotModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreatePot}>
              <label className="field-label">Objetivo</label>
              <input
                type="text"
                className="text-input"
                placeholder="Ex: Fundo de Emergência, Férias..."
                value={potName}
                onChange={(e) => setPotName(e.target.value)}
                required
              />

              <div className="form-row">
                <div>
                  <label className="field-label">Meta (€)</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    className="text-input mono"
                    placeholder="1000"
                    value={potTarget}
                    onChange={(e) => setPotTarget(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Ícone</label>
                  <select
                    className="text-input"
                    value={potIcon}
                    onChange={(e) => setPotIcon(e.target.value)}
                  >
                    <option value="🛡️">🛡️ Emergência</option>
                    <option value="✈️">✈️ Viagens</option>
                    <option value="💻">💻 Tech</option>
                    <option value="🚗">🚗 Carro</option>
                    <option value="🏠">🏠 Casa</option>
                    <option value="💎">💎 Investimento</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="btn-full primary-glow">
                Criar Cofre
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DEFINIÇÕES */}
      {showSettingsModal && (
        <div className="modal-backdrop">
          <div className="modal-sheet">
            <div className="modal-header">
              <h3>Definições & Dados Locais</h3>
              <button className="close-modal" onClick={() => setShowSettingsModal(false)}>✕</button>
            </div>

            <div className="setting-row">
              <div>
                <strong>Transitar Saldo entre Meses</strong>
                <p className="sub-text">O saldo que sobra passa para o início do mês seguinte</p>
              </div>
              <input
                type="checkbox"
                className="switch-input"
                checked={state.settings.rollover}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    settings: { ...prev.settings, rollover: e.target.checked }
                  }))
                }
              />
            </div>

            <div className="divider" />

            <p className="field-label">Cópia de Segurança (Telemóvel)</p>
            <div className="backup-grid">
              <button type="button" className="btn-outline" onClick={exportJson}>
                ⬇ Exportar JSON
              </button>
              <label className="btn-outline">
                ⬆ Importar JSON
                <input type="file" accept=".json" hidden onChange={importJson} />
              </label>
            </div>

            <div className="divider" />

            <div className="backup-grid">
              <button type="button" className="btn-outline" onClick={loadDemoData}>
                ⚡ Carregar Demo
              </button>
              <button
                type="button"
                className="btn-danger-soft"
                onClick={() => {
                  if (window.confirm("Tens a certeza que queres apagar todos os dados guardados?")) {
                    setState(createInitialState());
                    setShowSettingsModal(false);
                  }
                }}
              >
                🗑 Limpar Tudo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
