'use strict';

// ════════════════════════════════════════════════════════════
//  Constants
// ════════════════════════════════════════════════════════════

const CATEGORIES = [
  { id: 'lacteos',     label: 'Lácteos',     emoji: '🥛' },
  { id: 'carnes',      label: 'Carnes',       emoji: '🥩' },
  { id: 'verduras',    label: 'Verduras',     emoji: '🥦' },
  { id: 'frutas',      label: 'Frutas',       emoji: '🍎' },
  { id: 'bebidas',     label: 'Bebidas',      emoji: '🧃' },
  { id: 'condimentos', label: 'Condimentos',  emoji: '🧂' },
  { id: 'especias',    label: 'Especias',     emoji: '🌿' },
  { id: 'fiambres',    label: 'Fiambres',     emoji: '🍖' },
  { id: 'huevos',      label: 'Huevos',       emoji: '🥚' },
  { id: 'postres',     label: 'Postres',      emoji: '🍮' },
  { id: 'otros',       label: 'Otros',        emoji: '📦' },
];

const UNITS = ['unidades', 'kg', 'g', 'litros', 'ml', 'porciones', 'fetas', 'tazas'];

const EXPIRY_WARN_DAYS = 3;

// ════════════════════════════════════════════════════════════
//  API client
// ════════════════════════════════════════════════════════════

const API_BASE = '/api';

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try { message = (await res.json()).error || message; } catch {}
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

const api = {
  getItems:    ()       => apiRequest('/items'),
  createItem:  (item)   => apiRequest('/items', { method: 'POST', body: JSON.stringify(item) }),
  updateItem:  (id, item) => apiRequest(`/items/${id}`, { method: 'PUT', body: JSON.stringify(item) }),
  deleteItem:  (id)     => apiRequest(`/items/${id}`, { method: 'DELETE' }),

  getRecipes:    ()         => apiRequest('/recipes'),
  createRecipe:  (recipe)   => apiRequest('/recipes', { method: 'POST', body: JSON.stringify(recipe) }),
  updateRecipe:  (id, recipe) => apiRequest(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(recipe) }),
  deleteRecipe:  (id)       => apiRequest(`/recipes/${id}`, { method: 'DELETE' }),
};

// ════════════════════════════════════════════════════════════
//  Toasts (notificaciones no intrusivas)
// ════════════════════════════════════════════════════════════

function toast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 350);
  }, 2800);
}

function reportError(err) {
  console.error(err);
  toast(`⚠️ ${err.message}`, 'error');
}

// ════════════════════════════════════════════════════════════
//  Date helpers
// ════════════════════════════════════════════════════════════

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function localToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function daysUntil(dateStr) {
  return Math.round((parseLocalDate(dateStr) - localToday()) / 86400000);
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ════════════════════════════════════════════════════════════
//  Number helpers
// ════════════════════════════════════════════════════════════

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Paso de ajuste rápido según la unidad del producto. */
function unitStep(unit) {
  if (unit === 'kg' || unit === 'litros') return 0.25;
  if (unit === 'g'  || unit === 'ml')     return 100;
  return 1;
}

// ════════════════════════════════════════════════════════════
//  Inventory business logic
// ════════════════════════════════════════════════════════════

function getItemStatus(item) {
  if (!item.expiryDate) return 'ok';
  const d = daysUntil(item.expiryDate);
  if (d < 0) return 'expired';
  if (d <= EXPIRY_WARN_DAYS) return 'expiring';
  return 'ok';
}

function isOut(item) {
  return item.quantity <= 0;
}

function isLow(item) {
  return !isOut(item) && item.minQuantity > 0 && item.quantity <= item.minQuantity;
}

function getAlerts(items) {
  const alerts = [];
  items.forEach(item => {
    const status = getItemStatus(item);
    if (status === 'expired')  alerts.push({ type: 'expired',  item, days: daysUntil(item.expiryDate) });
    if (status === 'expiring') alerts.push({ type: 'expiring', item, days: daysUntil(item.expiryDate) });
    if (isOut(item))           alerts.push({ type: 'low',      item, out: true });
    else if (isLow(item))      alerts.push({ type: 'low',      item, out: false });
  });
  return alerts;
}

function nonExpiredItems() {
  return state.items.filter(i => getItemStatus(i) !== 'expired');
}

// ════════════════════════════════════════════════════════════
//  Recipe checker
// ════════════════════════════════════════════════════════════

function matchesIngredient(item, neededName) {
  const a = item.name.toLowerCase();
  const b = neededName.toLowerCase();
  return a.includes(b) || b.includes(a);
}

/** Ordena lotes por vencimiento: lo que vence antes va primero (FEFO); sin fecha, al final. */
function sortFEFO(items) {
  return [...items].sort((x, y) => {
    if (!x.expiryDate && !y.expiryDate) return 0;
    if (!x.expiryDate) return 1;
    if (!y.expiryDate) return -1;
    return x.expiryDate.localeCompare(y.expiryDate);
  });
}

function checkRecipeAgainstStock(recipe, inventoryItems) {
  return recipe.ingredients.map(needed => {
    // Todos los lotes con stock que matchean el ingrediente, ordenados FEFO.
    const lots  = sortFEFO(inventoryItems.filter(i => matchesIngredient(i, needed.name) && i.quantity > 0));
    const total = round2(lots.reduce((sum, i) => sum + i.quantity, 0));

    if (lots.length === 0) {
      const empty = inventoryItems.find(i => matchesIngredient(i, needed.name));
      return { ...needed, status: 'missing', inventoryItem: empty || null, lots: [], totalAvailable: 0 };
    }

    const base = { ...needed, inventoryItem: lots[0], lots, totalAvailable: total };
    if (!needed.quantity)          return { ...base, status: 'available' };
    if (total >= needed.quantity)  return { ...base, status: 'available' };
    return                                { ...base, status: 'insufficient' };
  });
}

/** Cuántos platos se pueden cocinar de esta receta con el stock disponible. */
function computeMaxPlates(recipe, inventoryItems) {
  const results = checkRecipeAgainstStock(recipe, inventoryItems);
  if (results.some(r => r.status === 'missing')) return 0;

  const measured = results.filter(r => r.quantity);
  const maxBatches = measured.length === 0
    ? 1
    : Math.min(...measured.map(r => Math.floor(r.totalAvailable / r.quantity)));

  return Math.max(0, maxBatches) * (recipe.servings || 1);
}

// ════════════════════════════════════════════════════════════
//  App state
// ════════════════════════════════════════════════════════════

const state = {
  // inventory
  items:          [],
  activeTab:      'inventory',
  filterCategory: 'all',
  searchQuery:    '',
  editingItem:    null,
  // recipe book
  recipes:           [],
  recipesView:       'list',   // 'list' | 'check'
  checkingRecipeId:  null,
  editingRecipe:     null,
  // loading
  loading: true,
};

// ════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════

function catInfo(id) {
  return CATEGORIES.find(c => c.id === id) || { label: 'Otro', emoji: '📦' };
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unitOptions(selected) {
  return UNITS.map(u =>
    `<option value="${u}"${u === selected ? ' selected' : ''}>${u}</option>`
  ).join('');
}

/** Payload completo de un item para PUT (preserva addedDate). */
function itemPayload(item, overrides = {}) {
  return {
    name:        item.name,
    quantity:    item.quantity,
    unit:        item.unit,
    category:    item.category,
    expiryDate:  item.expiryDate,
    minQuantity: item.minQuantity,
    addedDate:   item.addedDate,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
//  Render — top level
// ════════════════════════════════════════════════════════════

function renderApp() {
  if (state.loading) {
    document.getElementById('app-loading').style.display = 'flex';
    document.getElementById('app-main').style.display = 'none';
    return;
  }
  document.getElementById('app-loading').style.display = 'none';
  document.getElementById('app-main').style.display = 'block';

  const alerts = getAlerts(state.items);

  const badge = document.getElementById('alert-badge');
  badge.textContent = alerts.length;
  badge.style.display = alerts.length > 0 ? 'flex' : 'none';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });

  const tabIds = { inventory: 'tab-inventory', alerts: 'tab-alerts', recipes: 'tab-recipes', resumen: 'tab-resumen' };
  Object.entries(tabIds).forEach(([key, id]) => {
    document.getElementById(id).style.display = state.activeTab === key ? 'block' : 'none';
  });

  if (state.activeTab === 'inventory') renderInventory(alerts);
  if (state.activeTab === 'alerts')    renderAlerts(alerts);
  if (state.activeTab === 'recipes')   renderRecipeBook();
  if (state.activeTab === 'resumen')   renderResumen(alerts);
}

// ════════════════════════════════════════════════════════════
//  Render — Inventory
// ════════════════════════════════════════════════════════════

function renderInventory(alerts) {
  const expCount = alerts.filter(a => a.type === 'expired' || a.type === 'expiring').length;
  const lowCount = alerts.filter(a => a.type === 'low').length;
  document.getElementById('stat-total').textContent    = state.items.length;
  document.getElementById('stat-expiring').textContent = expCount;
  document.getElementById('stat-low').textContent      = lowCount;
  renderCategoryFilters();
  renderItemsList();
}

function renderCategoryFilters() {
  const usedCats = [...new Set(state.items.map(i => i.category))];
  document.getElementById('category-filters').innerHTML = [
    `<button class="filter-chip ${state.filterCategory === 'all' ? 'active' : ''}" data-filter="all">Todo</button>`,
    ...usedCats.map(id => {
      const c = catInfo(id);
      return `<button class="filter-chip ${state.filterCategory === id ? 'active' : ''}" data-filter="${id}">${c.emoji} ${c.label}</button>`;
    }),
  ].join('');
}

function renderItemsList() {
  let filtered = state.filterCategory === 'all'
    ? state.items
    : state.items.filter(i => i.category === state.filterCategory);

  const q = state.searchQuery.trim().toLowerCase();
  if (q) filtered = filtered.filter(i => i.name.toLowerCase().includes(q));

  const ORDER = { expired: 0, expiring: 1, ok: 2 };
  const sorted = [...filtered].sort((a, b) => {
    const diff = ORDER[getItemStatus(a)] - ORDER[getItemStatus(b)];
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'es');
  });

  const list = document.getElementById('items-list');
  if (sorted.length === 0) {
    list.innerHTML = q
      ? `<div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>No encontré nada con "${escHtml(state.searchQuery)}"</p>
          <p class="empty-hint">Probá con otro nombre</p>
        </div>`
      : `<div class="empty-state">
          <div class="empty-icon">🧊</div>
          <p>No hay nada en la heladera todavía</p>
          <p class="empty-hint">Agregá tu primer producto con el botón +</p>
        </div>`;
    return;
  }
  list.innerHTML = sorted.map(itemCardHtml).join('');
}

function fmtQty(item) {
  return `${item.quantity} ${item.unit}`;
}

function itemCardHtml(item) {
  const cat    = catInfo(item.category);
  const status = getItemStatus(item);
  const out    = isOut(item);
  const low    = isLow(item);

  let cardCls = 'item-card';
  if (status === 'expired')       cardCls += ' item-card--expired';
  else if (status === 'expiring') cardCls += ' item-card--expiring';
  else if (out)                   cardCls += ' item-card--out';
  else if (low)                   cardCls += ' item-card--low';

  let expiryBadge = '';
  if (item.expiryDate) {
    const d = daysUntil(item.expiryDate);
    if (status === 'expired') {
      expiryBadge = `<span class="badge badge-expired">Vencido hace ${Math.abs(d)} día${Math.abs(d) !== 1 ? 's' : ''}</span>`;
    } else if (status === 'expiring') {
      expiryBadge = d === 0
        ? `<span class="badge badge-expiring">Vence hoy</span>`
        : `<span class="badge badge-expiring">Vence en ${d} día${d !== 1 ? 's' : ''}</span>`;
    } else {
      expiryBadge = `<span class="badge badge-ok">Vence ${fmtDate(item.expiryDate)}</span>`;
    }
  }
  const outBadge = out ? `<span class="badge badge-out">Sin stock</span>` : '';
  const lowBadge = low ? `<span class="badge badge-low">Stock bajo</span>` : '';

  return `
    <div class="${cardCls}">
      <div class="item-emoji"><span>${cat.emoji}</span></div>
      <div class="item-info">
        <div class="item-name">${escHtml(item.name)}</div>
        <div class="item-meta">
          <span class="item-category">${cat.label}</span>
        </div>
        <div class="item-badges">${expiryBadge}${outBadge}${lowBadge}</div>
      </div>
      <div class="item-side">
        <div class="qty-stepper">
          <button class="qty-btn qty-minus" data-id="${item.id}" title="Descontar ${unitStep(item.unit)} ${item.unit}" ${out ? 'disabled' : ''}>−</button>
          <span class="qty-value">${fmtQty(item)}</span>
          <button class="qty-btn qty-plus" data-id="${item.id}" title="Sumar ${unitStep(item.unit)} ${item.unit}">+</button>
        </div>
        <div class="item-actions">
          <button class="btn-icon btn-edit"   data-id="${item.id}" title="Editar">✏️</button>
          <button class="btn-icon btn-delete" data-id="${item.id}" title="Eliminar">🗑️</button>
        </div>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  Quantity adjustment (descuento / suma rápida de stock)
// ════════════════════════════════════════════════════════════

const pendingSaves = new Map(); // itemId -> timeout

function adjustQuantity(id, dir) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  const newQty = Math.max(0, round2(item.quantity + dir * unitStep(item.unit)));
  if (newQty === item.quantity) return;
  item.quantity = newQty;
  renderApp();

  // Debounce: espera a que el usuario termine de tocar +/− y guarda una sola vez.
  clearTimeout(pendingSaves.get(id));
  pendingSaves.set(id, setTimeout(async () => {
    pendingSaves.delete(id);
    try {
      await api.updateItem(id, itemPayload(item));
    } catch (err) {
      reportError(err);
      try {
        state.items = await api.getItems();
        renderApp();
      } catch { /* la próxima acción reintenta */ }
    }
  }, 600));
}

// ════════════════════════════════════════════════════════════
//  Render — Alerts
// ════════════════════════════════════════════════════════════

function renderAlerts(alerts) {
  const el = document.getElementById('alerts-content');
  if (alerts.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <p>¡Todo está en orden!</p>
        <p class="empty-hint">No hay alertas en este momento</p>
      </div>`;
    return;
  }

  const expired  = alerts.filter(a => a.type === 'expired');
  const expiring = alerts.filter(a => a.type === 'expiring');
  const low      = alerts.filter(a => a.type === 'low');
  let html = '';

  if (expired.length)  html += alertSectionHtml('expired',  `🚨 Vencidos (${expired.length})`,    expired);
  if (expiring.length) html += alertSectionHtml('expiring', `⚠️ Por vencer (${expiring.length})`,  expiring);
  if (low.length)      html += alertSectionHtml('low',      `📉 Stock bajo (${low.length})`,       low);

  el.innerHTML = html;
}

function alertSectionHtml(type, title, alerts) {
  return `
    <div class="alert-section">
      <div class="alert-section-title alert-section-title--${type}">${title}</div>
      ${alerts.map(alertCardHtml).join('')}
    </div>`;
}

function alertCardHtml(alert) {
  const cat = catInfo(alert.item.category);
  let desc = '';
  if (alert.type === 'expired')  desc = `Venció hace ${Math.abs(alert.days)} día${Math.abs(alert.days) !== 1 ? 's' : ''}`;
  if (alert.type === 'expiring') desc = alert.days === 0 ? 'Vence hoy' : `Vence en ${alert.days} día${alert.days !== 1 ? 's' : ''}`;
  if (alert.type === 'low') {
    desc = alert.out
      ? 'Sin stock — hay que reponer'
      : `Quedan ${alert.item.quantity} ${alert.item.unit} — mínimo: ${alert.item.minQuantity}`;
  }

  return `
    <div class="alert-card alert-card--${alert.type}">
      <span class="alert-emoji">${cat.emoji}</span>
      <div class="alert-info">
        <span class="alert-name">${escHtml(alert.item.name)}</span>
        <span class="alert-desc">${desc}</span>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  Render — Recipe Book
// ════════════════════════════════════════════════════════════

function renderRecipeBook() {
  const listView  = document.getElementById('recipes-list-view');
  const checkView = document.getElementById('recipes-check-view');

  if (state.recipesView === 'list') {
    listView.style.display  = 'block';
    checkView.style.display = 'none';
    renderRecipeList();
  } else {
    listView.style.display  = 'none';
    checkView.style.display = 'block';
    renderRecipeCheckView();
  }
}

function renderRecipeList() {
  const el = document.getElementById('recipes-list');
  if (state.recipes.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📖</div>
        <p>No tenés recetas guardadas todavía</p>
        <p class="empty-hint">Creá tu primera receta con el botón +</p>
      </div>`;
    return;
  }
  const ORDER = { green: 0, yellow: 1, red: 2 };
  const sorted = [...state.recipes].sort((a, b) => {
    const diff = ORDER[getRecipeStockStatus(a)] - ORDER[getRecipeStockStatus(b)];
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'es');
  });
  el.innerHTML = sorted.map(recipeCardHtml).join('');
}

function getRecipeStockStatus(recipe) {
  if (recipe.ingredients.length === 0) return 'green';
  const results    = checkRecipeAgainstStock(recipe, nonExpiredItems());
  const nAvailable = results.filter(r => r.status === 'available').length;
  const nMissing   = results.filter(r => r.status === 'missing').length;
  if (nAvailable === results.length) return 'green';
  if (nMissing   === results.length) return 'red';
  return 'yellow';
}

const RECIPE_STATUS_LABEL = {
  green:  'Listo para cocinar',
  yellow: 'Ingredientes incompletos',
  red:    'Sin ingredientes en stock',
};

function recipeCardHtml(recipe) {
  const stockStatus = getRecipeStockStatus(recipe);
  const count = recipe.ingredients.length;
  const plates = stockStatus === 'green' ? computeMaxPlates(recipe, nonExpiredItems()) : 0;
  const platesInfo = plates > 0 ? ` · rinde ${plates} plato${plates !== 1 ? 's' : ''}` : '';
  const notes = recipe.notes ? `<div class="recipe-book-notes">${escHtml(recipe.notes)}</div>` : '';
  return `
    <div class="recipe-book-card recipe-book-card--${stockStatus}">
      <div class="recipe-book-icon"><span>🍽️</span></div>
      <div class="recipe-book-info">
        <div class="recipe-book-name">${escHtml(recipe.name)}</div>
        <div class="recipe-book-meta">${count} ingrediente${count !== 1 ? 's' : ''}${platesInfo}</div>
        <span class="recipe-stock-pill recipe-stock-pill--${stockStatus}">${RECIPE_STATUS_LABEL[stockStatus]}</span>
        ${notes}
      </div>
      <div class="recipe-book-actions">
        <button class="btn-verify" data-id="${recipe.id}">🔍 Ver</button>
        <div class="recipe-book-icons">
          <button class="btn-icon btn-edit-recipe"   data-id="${recipe.id}" title="Editar">✏️</button>
          <button class="btn-icon btn-delete-recipe" data-id="${recipe.id}" title="Eliminar">🗑️</button>
        </div>
      </div>
    </div>`;
}

function renderRecipeCheckView() {
  const recipe = state.recipes.find(r => r.id === state.checkingRecipeId);
  const el     = document.getElementById('recipe-check-content');
  if (!recipe) { el.innerHTML = ''; return; }

  const results  = checkRecipeAgainstStock(recipe, nonExpiredItems());
  const missing  = results.filter(r => r.status === 'missing');
  const insuf    = results.filter(r => r.status === 'insufficient');
  const canCook  = missing.length === 0 && insuf.length === 0;
  const plates   = computeMaxPlates(recipe, nonExpiredItems());

  const notesHtml = recipe.notes
    ? `<p class="check-recipe-notes">${escHtml(recipe.notes)}</p>` : '';
  const stepsHtml = recipe.steps
    ? `<div class="check-recipe-steps"><h3>👨‍🍳 Pasos</h3><p>${escHtml(recipe.steps)}</p></div>` : '';

  const rows = results.map(r => {
    const icon   = r.status === 'available' ? '✅' : r.status === 'missing' ? '❌' : '⚠️';
    const needed = r.quantity ? `${r.quantity} ${r.unit || ''}`.trim() : 'alguna cantidad';
    let have;
    if (r.totalAvailable > 0) {
      const lotInfo = r.lots.length > 1 ? ` en ${r.lots.length} lotes` : '';
      have = `Tenés: ${r.totalAvailable} ${r.lots[0].unit}${lotInfo}`;
    } else if (r.inventoryItem) {
      have = `Tenés: 0 ${r.inventoryItem.unit}`;
    } else {
      have = 'No está en la heladera';
    }
    return `
      <div class="recipe-row recipe-row--${r.status}">
        <span class="recipe-status-icon">${icon}</span>
        <div class="recipe-ingredient-info">
          <span class="recipe-ingredient">${escHtml(r.name)}</span>
          <span class="recipe-details">
            <span>Necesitás: ${escHtml(needed)}</span>
            <span>${have}</span>
          </span>
        </div>
      </div>`;
  }).join('');

  const cookBtn = canCook
    ? `<button class="btn-cook" data-id="${recipe.id}">🍳 Cocinar y descontar stock</button>`
    : '';

  el.innerHTML = `
    <h2 class="check-recipe-title">${escHtml(recipe.name)}</h2>
    ${notesHtml}
    <div class="recipe-result">
      <div class="recipe-verdict recipe-verdict--${canCook ? 'yes' : 'no'}">
        ${canCook
          ? `✅ ¡Podés prepararlo! Te alcanza para ${plates} plato${plates !== 1 ? 's' : ''}`
          : `❌ Faltan ${missing.length + insuf.length} ingrediente${missing.length + insuf.length !== 1 ? 's'  : ''}`}
      </div>
      ${cookBtn}
      <div class="recipe-table">${rows}</div>
      ${stepsHtml}
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  Cocinar receta → descuenta ingredientes del stock
// ════════════════════════════════════════════════════════════

async function cookRecipe(id) {
  const recipe = state.recipes.find(r => r.id === id);
  if (!recipe) return;

  const results = checkRecipeAgainstStock(recipe, nonExpiredItems());
  if (results.some(r => r.status !== 'available')) {
    toast('Te faltan ingredientes para esta receta', 'error');
    return;
  }

  // Reparto FEFO: cada ingrediente consume primero el lote que vence antes,
  // y sigue con el siguiente si no alcanza. `avail` evita descontar dos veces
  // el mismo lote cuando dos ingredientes matchean el mismo producto.
  const avail = new Map();
  const deductions = new Map();
  results.forEach(r => {
    if (!r.quantity) return;
    let remaining = r.quantity;
    for (const lot of r.lots) {
      if (remaining <= 0) break;
      if (!avail.has(lot.id)) avail.set(lot.id, lot.quantity);
      const take = Math.min(avail.get(lot.id), remaining);
      if (take <= 0) continue;
      avail.set(lot.id, round2(avail.get(lot.id) - take));
      deductions.set(lot.id, round2((deductions.get(lot.id) || 0) + take));
      remaining = round2(remaining - take);
    }
  });

  const summary = [...deductions].map(([itemId, qty]) => {
    const item = state.items.find(i => i.id === itemId);
    const vto = item.expiryDate ? ` (vence ${fmtDate(item.expiryDate)})` : '';
    return `• ${item.name}${vto}: −${qty} ${item.unit}`;
  }).join('\n');
  const msg = summary
    ? `¿Cocinás "${recipe.name}"?\n\nSe descuenta del stock (primero lo que vence antes):\n${summary}`
    : `¿Cocinás "${recipe.name}"?\n\n(Ningún ingrediente tiene cantidad definida, no se descuenta stock.)`;
  if (!confirm(msg)) return;

  const btn = document.querySelector('.btn-cook');
  if (btn) { btn.disabled = true; btn.textContent = 'Descontando...'; }

  try {
    await Promise.all([...deductions].map(([itemId, qty]) => {
      const item = state.items.find(i => i.id === itemId);
      return api.updateItem(itemId, itemPayload(item, { quantity: Math.max(0, round2(item.quantity - qty)) }));
    }));
    state.items = await api.getItems();
    toast(`🍳 ¡A cocinar ${recipe.name}! Stock descontado`);
    renderApp();
  } catch (err) {
    reportError(err);
    if (btn) { btn.disabled = false; btn.textContent = '🍳 Cocinar y descontar stock'; }
  }
}

// ════════════════════════════════════════════════════════════
//  Render — Resumen
// ════════════════════════════════════════════════════════════

function renderResumen(alerts) {
  const critical = alerts.filter(a => a.type === 'expired' || a.type === 'expiring' || a.type === 'low');
  const stock = nonExpiredItems();

  const cookable = state.recipes
    .map(recipe => ({ recipe, plates: computeMaxPlates(recipe, stock) }))
    .sort((a, b) => b.plates - a.plates);

  const criticalHtml = critical.length === 0
    ? `<p class="resumen-empty">No hay productos en estado crítico. 👍</p>`
    : critical.map(a => {
        const cat = catInfo(a.item.category);
        let desc = '';
        if (a.type === 'expired')  desc = `Vencido hace ${Math.abs(a.days)} día${Math.abs(a.days) !== 1 ? 's' : ''}`;
        if (a.type === 'expiring') desc = a.days === 0 ? 'Vence hoy' : `Vence en ${a.days} día${a.days !== 1 ? 's' : ''}`;
        if (a.type === 'low')      desc = a.out ? 'Sin stock — hay que reponer' : `Quedan ${a.item.quantity} ${a.item.unit} — mínimo: ${a.item.minQuantity}`;
        return `
          <div class="alert-card alert-card--${a.type}">
            <span class="alert-emoji">${cat.emoji}</span>
            <div class="alert-info">
              <span class="alert-name">${escHtml(a.item.name)}</span>
              <span class="alert-desc">${desc}</span>
            </div>
          </div>`;
      }).join('');

  const cookableHtml = cookable.length === 0
    ? `<p class="resumen-empty">No tenés recetas creadas todavía.</p>`
    : cookable.map(({ recipe, plates }) => `
        <div class="plates-card ${plates > 0 ? 'plates-card--yes' : 'plates-card--no'}" data-id="${recipe.id}">
          <div class="plates-card-name">${escHtml(recipe.name)}</div>
          <div class="plates-card-count">
            ${plates > 0 ? `🍽️ ${plates} plato${plates !== 1 ? 's' : ''}` : 'Sin stock suficiente'}
          </div>
        </div>`).join('');

  document.getElementById('resumen-content').innerHTML = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-number">${state.items.length}</div>
        <div class="stat-label">Productos</div>
      </div>
      <div class="stat-card stat-card--purple">
        <div class="stat-number">${critical.length}</div>
        <div class="stat-label">Stock crítico</div>
      </div>
      <div class="stat-card stat-card--warning">
        <div class="stat-number">${cookable.filter(c => c.plates > 0).length}</div>
        <div class="stat-label">Recetas listas</div>
      </div>
    </div>

    <h3 class="resumen-section-title">⚠️ Stock crítico</h3>
    <div class="resumen-section">${criticalHtml}</div>

    <h3 class="resumen-section-title">🍽️ ¿Qué puedo cocinar?</h3>
    <div class="resumen-section">${cookableHtml}</div>
  `;
}

// ════════════════════════════════════════════════════════════
//  Inventory modal
// ════════════════════════════════════════════════════════════

function openModal(item = null) {
  state.editingItem = item;
  const form  = document.getElementById('item-form');
  const title = document.getElementById('modal-title');

  if (item) {
    title.textContent = 'Editar producto';
    form.elements['name'].value     = item.name;
    form.elements['quantity'].value = item.quantity;
    form.elements['unit'].value     = item.unit;
    form.elements['category'].value = item.category;
    form.elements['expiry'].value   = item.expiryDate || '';
    form.elements['minQty'].value   = item.minQuantity > 0 ? item.minQuantity : '';
  } else {
    title.textContent = 'Agregar producto';
    form.reset();
  }

  document.getElementById('modal').classList.add('modal--open');
  form.elements['name'].focus();
}

function closeModal() {
  document.getElementById('modal').classList.remove('modal--open');
  state.editingItem = null;
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = fd.get('name').trim();
  if (!name) return;

  const itemData = {
    name,
    quantity:    parseFloat(fd.get('quantity')) || 0,
    unit:        fd.get('unit'),
    category:    fd.get('category'),
    expiryDate:  fd.get('expiry') || null,
    minQuantity: parseFloat(fd.get('minQty')) || 0,
  };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (state.editingItem) {
      await api.updateItem(state.editingItem.id, { ...itemData, addedDate: state.editingItem.addedDate });
      toast(`✏️ ${name} actualizado`);
    } else {
      await api.createItem(itemData);
      toast(`✅ ${name} agregado a la heladera`);
    }
    state.items = await api.getItems();
    closeModal();
    renderApp();
  } catch (err) {
    reportError(err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function deleteItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item || !confirm(`¿Eliminás "${item.name}" de la heladera?`)) return;
  try {
    await api.deleteItem(id);
    state.items = await api.getItems();
    toast(`🗑️ ${item.name} eliminado`);
    renderApp();
  } catch (err) {
    reportError(err);
  }
}

// ════════════════════════════════════════════════════════════
//  Recipe modal
// ════════════════════════════════════════════════════════════

function openRecipeModal(recipe = null) {
  state.editingRecipe = recipe;
  const title       = document.getElementById('recipe-modal-title');
  const nameInput   = document.getElementById('recipe-field-name');
  const notesEl     = document.getElementById('recipe-field-notes');
  const stepsEl     = document.getElementById('recipe-field-steps');
  const servingsEl  = document.getElementById('recipe-field-servings');
  const container   = document.getElementById('ingredients-container');

  container.innerHTML = '';

  if (recipe) {
    title.textContent   = 'Editar receta';
    nameInput.value     = recipe.name;
    notesEl.value       = recipe.notes || '';
    stepsEl.value       = recipe.steps || '';
    servingsEl.value    = recipe.servings || 1;
    recipe.ingredients.forEach(ing => addIngredientRow(container, ing));
  } else {
    title.textContent = 'Nueva receta';
    nameInput.value   = '';
    notesEl.value     = '';
    stepsEl.value     = '';
    servingsEl.value  = 1;
    addIngredientRow(container);
  }

  document.getElementById('recipe-modal').classList.add('modal--open');
  nameInput.focus();
}

function closeRecipeModal() {
  document.getElementById('recipe-modal').classList.remove('modal--open');
  state.editingRecipe = null;
}

function addIngredientRow(container, ingredient = null) {
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  row.innerHTML = `
    <input type="text"   class="ing-name" placeholder="Ingrediente"
      value="${ingredient ? escHtml(ingredient.name) : ''}" autocomplete="off">
    <input type="number" class="ing-qty"  placeholder="Cant."
      min="0" step="any" value="${ingredient && ingredient.quantity != null ? ingredient.quantity : ''}">
    <select class="ing-unit">${unitOptions(ingredient ? ingredient.unit : 'unidades')}</select>
    <button type="button" class="btn-remove-ing" title="Quitar">✕</button>`;

  row.querySelector('.btn-remove-ing').addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}

function getIngredientsFromForm() {
  const rows = document.querySelectorAll('#ingredients-container .ingredient-row');
  const ingredients = [];
  rows.forEach(row => {
    const name = row.querySelector('.ing-name').value.trim();
    if (!name) return;
    const qtyVal = row.querySelector('.ing-qty').value;
    ingredients.push({
      name,
      quantity: qtyVal !== '' ? parseFloat(qtyVal) : null,
      unit:     row.querySelector('.ing-unit').value,
    });
  });
  return ingredients;
}

async function handleRecipeFormSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('recipe-field-name').value.trim();
  if (!name) return;

  const ingredients = getIngredientsFromForm();
  if (ingredients.length === 0) {
    toast('Agregá al menos un ingrediente', 'error');
    return;
  }

  const recipeData = {
    name,
    ingredients,
    notes: document.getElementById('recipe-field-notes').value.trim(),
    steps: document.getElementById('recipe-field-steps').value.trim(),
    servings: parseInt(document.getElementById('recipe-field-servings').value, 10) || 1,
  };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (state.editingRecipe) {
      await api.updateRecipe(state.editingRecipe.id, { ...recipeData, createdDate: state.editingRecipe.createdDate });
      toast(`✏️ Receta "${name}" actualizada`);
    } else {
      await api.createRecipe(recipeData);
      toast(`📖 Receta "${name}" guardada`);
    }
    state.recipes = await api.getRecipes();
    closeRecipeModal();
    renderApp();
  } catch (err) {
    reportError(err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function deleteRecipe(id) {
  const recipe = state.recipes.find(r => r.id === id);
  if (!recipe || !confirm(`¿Eliminás la receta "${recipe.name}"?`)) return;
  try {
    await api.deleteRecipe(id);
    state.recipes = await api.getRecipes();
    toast(`🗑️ Receta "${recipe.name}" eliminada`);
    renderApp();
  } catch (err) {
    reportError(err);
  }
}

// ════════════════════════════════════════════════════════════
//  Events
// ════════════════════════════════════════════════════════════

function setupEvents() {
  // ── Tabs ──
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      // Reset recipe sub-view when switching away and back
      if (btn.dataset.tab !== 'recipes') state.recipesView = 'list';
      renderApp();
    });
  });

  // ── Search ──
  document.getElementById('search-input').addEventListener('input', e => {
    state.searchQuery = e.target.value;
    renderItemsList();
  });

  // ── Inventory modal ──
  document.getElementById('btn-add').addEventListener('click', () => openModal());
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('item-form').addEventListener('submit', handleFormSubmit);

  // ── Inventory item actions (delegation) ──
  document.getElementById('items-list').addEventListener('click', e => {
    const minus = e.target.closest('.qty-minus');
    const plus  = e.target.closest('.qty-plus');
    const edit  = e.target.closest('.btn-edit');
    const del   = e.target.closest('.btn-delete');
    if (minus) adjustQuantity(minus.dataset.id, -1);
    if (plus)  adjustQuantity(plus.dataset.id, +1);
    if (edit) { const item = state.items.find(i => i.id === edit.dataset.id); if (item) openModal(item); }
    if (del)  deleteItem(del.dataset.id);
  });

  // ── Category filter ──
  document.getElementById('category-filters').addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (chip) { state.filterCategory = chip.dataset.filter; renderApp(); }
  });

  // ── Recipe modal ──
  document.getElementById('btn-add-recipe').addEventListener('click', () => openRecipeModal());
  document.getElementById('recipe-modal-close').addEventListener('click', closeRecipeModal);
  document.getElementById('recipe-modal-overlay').addEventListener('click', closeRecipeModal);
  document.getElementById('btn-cancel-recipe').addEventListener('click', closeRecipeModal);
  document.getElementById('recipe-form').addEventListener('submit', handleRecipeFormSubmit);
  document.getElementById('btn-add-ingredient').addEventListener('click', () => {
    addIngredientRow(document.getElementById('ingredients-container'));
  });

  // ── Recipe list actions (delegation) ──
  document.getElementById('recipes-list').addEventListener('click', e => {
    const verify = e.target.closest('.btn-verify');
    const edit   = e.target.closest('.btn-edit-recipe');
    const del    = e.target.closest('.btn-delete-recipe');

    if (verify) {
      state.checkingRecipeId = verify.dataset.id;
      state.recipesView = 'check';
      renderApp();
    }
    if (edit) {
      const recipe = state.recipes.find(r => r.id === edit.dataset.id);
      if (recipe) openRecipeModal(recipe);
    }
    if (del) deleteRecipe(del.dataset.id);
  });

  // ── Cocinar (en la vista de verificación) ──
  document.getElementById('recipe-check-content').addEventListener('click', e => {
    const cook = e.target.closest('.btn-cook');
    if (cook) cookRecipe(cook.dataset.id);
  });

  // ── Resumen: tocar una receta te lleva a verificarla ──
  document.getElementById('resumen-content').addEventListener('click', e => {
    const card = e.target.closest('.plates-card');
    if (card) {
      state.activeTab = 'recipes';
      state.recipesView = 'check';
      state.checkingRecipeId = card.dataset.id;
      renderApp();
    }
  });

  // ── Back button in check view ──
  document.getElementById('btn-back-recipes').addEventListener('click', () => {
    state.recipesView = 'list';
    renderApp();
  });

  // ── Close modals on Escape ──
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeRecipeModal(); }
  });
}

// ════════════════════════════════════════════════════════════
//  Init
// ════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  setupEvents();
  renderApp();

  try {
    const [items, recipes] = await Promise.all([api.getItems(), api.getRecipes()]);
    state.items = items;
    state.recipes = recipes;
  } catch (err) {
    reportError(err);
  } finally {
    state.loading = false;
    renderApp();
  }
});
