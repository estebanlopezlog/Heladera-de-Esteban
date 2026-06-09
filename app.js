'use strict';

// ════════════════════════════════════════════════════════════
//  Constants
// ════════════════════════════════════════════════════════════

const STORAGE_KEY = 'heladera-esteban-v1';

const CATEGORIES = [
  { id: 'lacteos',     label: 'Lácteos',     emoji: '🥛' },
  { id: 'carnes',      label: 'Carnes',       emoji: '🥩' },
  { id: 'verduras',    label: 'Verduras',     emoji: '🥦' },
  { id: 'frutas',      label: 'Frutas',       emoji: '🍎' },
  { id: 'bebidas',     label: 'Bebidas',      emoji: '🧃' },
  { id: 'condimentos', label: 'Condimentos',  emoji: '🧂' },
  { id: 'fiambres',    label: 'Fiambres',     emoji: '🍖' },
  { id: 'huevos',      label: 'Huevos',       emoji: '🥚' },
  { id: 'postres',     label: 'Postres',      emoji: '🍮' },
  { id: 'otros',       label: 'Otros',        emoji: '📦' },
];

// Days threshold to flag "about to expire"
const EXPIRY_WARN_DAYS = 3;

// ════════════════════════════════════════════════════════════
//  Storage
// ════════════════════════════════════════════════════════════

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedData();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.items || [];
  } catch {
    return [];
  }
}

function saveItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ════════════════════════════════════════════════════════════
//  Seed / demo data (shown on first visit)
// ════════════════════════════════════════════════════════════

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seedData() {
  const items = [
    { id: generateId(), name: 'Leche entera',    quantity: 1.5, unit: 'litros',   category: 'lacteos',     expiryDate: offsetDate(5),   minQuantity: 0.5, addedDate: offsetDate(0) },
    { id: generateId(), name: 'Yogur natural',   quantity: 3,   unit: 'unidades', category: 'lacteos',     expiryDate: offsetDate(2),   minQuantity: 0,   addedDate: offsetDate(0) },
    { id: generateId(), name: 'Queso cremoso',   quantity: 0.3, unit: 'kg',       category: 'lacteos',     expiryDate: offsetDate(10),  minQuantity: 0.1, addedDate: offsetDate(0) },
    { id: generateId(), name: 'Huevos',          quantity: 6,   unit: 'unidades', category: 'huevos',      expiryDate: offsetDate(18),  minQuantity: 4,   addedDate: offsetDate(0) },
    { id: generateId(), name: 'Pollo',           quantity: 0.5, unit: 'kg',       category: 'carnes',      expiryDate: offsetDate(-1),  minQuantity: 0,   addedDate: offsetDate(0) },
    { id: generateId(), name: 'Tomate',          quantity: 4,   unit: 'unidades', category: 'verduras',    expiryDate: null,            minQuantity: 0,   addedDate: offsetDate(0) },
    { id: generateId(), name: 'Manzana',         quantity: 3,   unit: 'unidades', category: 'frutas',      expiryDate: offsetDate(7),   minQuantity: 0,   addedDate: offsetDate(0) },
    { id: generateId(), name: 'Jugo de naranja', quantity: 0.4, unit: 'litros',   category: 'bebidas',     expiryDate: offsetDate(8),   minQuantity: 1,   addedDate: offsetDate(0) },
    { id: generateId(), name: 'Ketchup',         quantity: 1,   unit: 'unidades', category: 'condimentos', expiryDate: null,            minQuantity: 0,   addedDate: offsetDate(0) },
    { id: generateId(), name: 'Jamón cocido',    quantity: 0.15, unit: 'kg',      category: 'fiambres',    expiryDate: offsetDate(3),   minQuantity: 0,   addedDate: offsetDate(0) },
  ];
  saveItems(items);
  return items;
}

// ════════════════════════════════════════════════════════════
//  Date helpers  (avoids UTC vs local timezone bugs)
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
//  Business logic
// ════════════════════════════════════════════════════════════

function getItemStatus(item) {
  if (!item.expiryDate) return 'ok';
  const d = daysUntil(item.expiryDate);
  if (d < 0) return 'expired';
  if (d <= EXPIRY_WARN_DAYS) return 'expiring';
  return 'ok';
}

function isLow(item) {
  return item.minQuantity > 0 && item.quantity <= item.minQuantity;
}

function getAlerts(items) {
  const alerts = [];
  items.forEach(item => {
    const status = getItemStatus(item);
    if (status === 'expired')   alerts.push({ type: 'expired',   item, days: daysUntil(item.expiryDate) });
    if (status === 'expiring')  alerts.push({ type: 'expiring',  item, days: daysUntil(item.expiryDate) });
    if (isLow(item))            alerts.push({ type: 'low',       item });
  });
  return alerts;
}

// ── Recipe parsing ──────────────────────────────────────────

function parseRecipeIngredients(text) {
  const ingredients = [];
  const lines = text.split('\n');

  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;

    // Patterns: "2 huevos", "500g harina", "1.5 litros leche", "sal"
    const m = line.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]*)\s+(.+)$/);
    if (m) {
      const qty  = parseFloat(m[1].replace(',', '.'));
      const unit = m[2].toLowerCase() || 'unidades';
      const name = m[3].toLowerCase().trim();
      ingredients.push({ name, quantity: qty, unit });
    } else {
      ingredients.push({ name: line.toLowerCase().trim(), quantity: null, unit: null });
    }
  }
  return ingredients;
}

function checkRecipe(recipeIngredients, inventoryItems) {
  return recipeIngredients.map(needed => {
    const found = inventoryItems.find(item => {
      const a = item.name.toLowerCase();
      const b = needed.name.toLowerCase();
      return a.includes(b) || b.includes(a);
    });

    if (!found) return { ...needed, status: 'missing',      inventoryItem: null };
    if (!needed.quantity) return { ...needed, status: 'available',   inventoryItem: found };
    if (found.quantity >= needed.quantity) return { ...needed, status: 'available',    inventoryItem: found };
    return { ...needed, status: 'insufficient', inventoryItem: found };
  });
}

// ════════════════════════════════════════════════════════════
//  App state
// ════════════════════════════════════════════════════════════

const state = {
  items:          loadItems(),
  activeTab:      'inventory',
  filterCategory: 'all',
  editingItem:    null,
  recipeText:     '',
  recipeResults:  null,
};

// ════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════

function catInfo(id) {
  return CATEGORIES.find(c => c.id === id) || { label: 'Otro', emoji: '📦' };
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ════════════════════════════════════════════════════════════
//  Render
// ════════════════════════════════════════════════════════════

function renderApp() {
  const alerts = getAlerts(state.items);

  // Alert badge
  const badge = document.getElementById('alert-badge');
  badge.textContent = alerts.length;
  badge.style.display = alerts.length > 0 ? 'flex' : 'none';

  // Active tab
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });

  const tabs = { inventory: 'tab-inventory', alerts: 'tab-alerts', recipes: 'tab-recipes' };
  Object.entries(tabs).forEach(([key, id]) => {
    document.getElementById(id).style.display = state.activeTab === key ? 'block' : 'none';
  });

  if (state.activeTab === 'inventory') renderInventory(alerts);
  if (state.activeTab === 'alerts')    renderAlerts(alerts);
  if (state.activeTab === 'recipes')   renderRecipeResults();
}

// ── Inventory ───────────────────────────────────────────────

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
  const chips = [
    `<button class="filter-chip ${state.filterCategory === 'all' ? 'active' : ''}" data-filter="all">Todo</button>`,
    ...usedCats.map(id => {
      const c = catInfo(id);
      return `<button class="filter-chip ${state.filterCategory === id ? 'active' : ''}" data-filter="${id}">${c.emoji} ${c.label}</button>`;
    }),
  ];
  document.getElementById('category-filters').innerHTML = chips.join('');
}

function renderItemsList() {
  const filtered = state.filterCategory === 'all'
    ? state.items
    : state.items.filter(i => i.category === state.filterCategory);

  const ORDER = { expired: 0, expiring: 1, ok: 2 };
  const sorted = [...filtered].sort((a, b) => {
    const diff = ORDER[getItemStatus(a)] - ORDER[getItemStatus(b)];
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'es');
  });

  const list = document.getElementById('items-list');
  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🧊</div>
        <p>No hay nada en la heladera todavía</p>
        <p class="empty-hint">Agregá tu primer producto con el botón +</p>
      </div>`;
    return;
  }

  list.innerHTML = sorted.map(itemCardHtml).join('');
}

function itemCardHtml(item) {
  const cat    = catInfo(item.category);
  const status = getItemStatus(item);
  const low    = isLow(item);

  let cardClass = 'item-card';
  if (status === 'expired')  cardClass += ' item-card--expired';
  else if (status === 'expiring') cardClass += ' item-card--expiring';
  else if (low)              cardClass += ' item-card--low';

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

  const lowBadge = low ? `<span class="badge badge-low">Stock bajo</span>` : '';

  return `
    <div class="${cardClass}">
      <div class="item-emoji">${cat.emoji}</div>
      <div class="item-info">
        <div class="item-name">${escHtml(item.name)}</div>
        <div class="item-meta">
          <span class="item-quantity">${item.quantity} ${item.unit}</span>
          <span class="item-category">${cat.label}</span>
        </div>
        <div class="item-badges">${expiryBadge}${lowBadge}</div>
      </div>
      <div class="item-actions">
        <button class="btn-icon btn-edit" data-id="${item.id}" title="Editar">✏️</button>
        <button class="btn-icon btn-delete" data-id="${item.id}" title="Eliminar">🗑️</button>
      </div>
    </div>`;
}

// ── Alerts ──────────────────────────────────────────────────

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

  if (expired.length) {
    html += `<div class="alert-section">
      <div class="alert-section-title alert-section-title--expired">🚨 Vencidos (${expired.length})</div>
      ${expired.map(alertCardHtml).join('')}
    </div>`;
  }
  if (expiring.length) {
    html += `<div class="alert-section">
      <div class="alert-section-title alert-section-title--expiring">⚠️ Por vencer (${expiring.length})</div>
      ${expiring.map(alertCardHtml).join('')}
    </div>`;
  }
  if (low.length) {
    html += `<div class="alert-section">
      <div class="alert-section-title alert-section-title--low">📉 Stock bajo (${low.length})</div>
      ${low.map(alertCardHtml).join('')}
    </div>`;
  }

  el.innerHTML = html;
}

function alertCardHtml(alert) {
  const cat = catInfo(alert.item.category);
  let desc = '';
  if (alert.type === 'expired') {
    desc = `Venció hace ${Math.abs(alert.days)} día${Math.abs(alert.days) !== 1 ? 's' : ''}`;
  } else if (alert.type === 'expiring') {
    desc = alert.days === 0 ? 'Vence hoy' : `Vence en ${alert.days} día${alert.days !== 1 ? 's' : ''}`;
  } else {
    desc = `Quedan ${alert.item.quantity} ${alert.item.unit} — mínimo: ${alert.item.minQuantity}`;
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

// ── Recipes ─────────────────────────────────────────────────

function renderRecipeResults() {
  const el = document.getElementById('recipe-results');
  if (!state.recipeResults || state.recipeResults.length === 0) {
    el.innerHTML = '';
    return;
  }

  const missing      = state.recipeResults.filter(r => r.status === 'missing');
  const insufficient = state.recipeResults.filter(r => r.status === 'insufficient');
  const canCook      = missing.length === 0 && insufficient.length === 0;

  const rows = state.recipeResults.map(r => {
    const icon = r.status === 'available' ? '✅' : r.status === 'missing' ? '❌' : '⚠️';
    const needed = r.quantity ? `${r.quantity} ${r.unit}` : 'alguna cantidad';
    const have   = r.inventoryItem
      ? `Tenés: ${r.inventoryItem.quantity} ${r.inventoryItem.unit}`
      : 'No está en la heladera';

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

  el.innerHTML = `
    <div class="recipe-result">
      <div class="recipe-verdict recipe-verdict--${canCook ? 'yes' : 'no'}">
        ${canCook ? '✅ ¡Podés prepararlo!' : '❌ Te faltan o no alcanza algún ingrediente'}
      </div>
      <div class="recipe-table">${rows}</div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  Modal
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

function handleFormSubmit(e) {
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

  if (state.editingItem) {
    const idx = state.items.findIndex(i => i.id === state.editingItem.id);
    if (idx !== -1) state.items[idx] = { ...state.items[idx], ...itemData };
  } else {
    state.items.push({
      id:        generateId(),
      addedDate: new Date().toISOString().slice(0, 10),
      ...itemData,
    });
  }

  saveItems(state.items);
  closeModal();
  renderApp();
}

function deleteItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`¿Eliminás "${item.name}" de la heladera?`)) return;
  state.items = state.items.filter(i => i.id !== id);
  saveItems(state.items);
  renderApp();
}

// ════════════════════════════════════════════════════════════
//  Events
// ════════════════════════════════════════════════════════════

function setupEvents() {
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      renderApp();
    });
  });

  // Add button
  document.getElementById('btn-add').addEventListener('click', () => openModal());

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);

  // Form
  document.getElementById('item-form').addEventListener('submit', handleFormSubmit);

  // Item actions (event delegation)
  document.getElementById('items-list').addEventListener('click', e => {
    const edit = e.target.closest('.btn-edit');
    const del  = e.target.closest('.btn-delete');
    if (edit) {
      const item = state.items.find(i => i.id === edit.dataset.id);
      if (item) openModal(item);
    }
    if (del) deleteItem(del.dataset.id);
  });

  // Category filter
  document.getElementById('category-filters').addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (chip) {
      state.filterCategory = chip.dataset.filter;
      renderApp();
    }
  });

  // Recipe check
  document.getElementById('btn-check-recipe').addEventListener('click', () => {
    const text = document.getElementById('recipe-input').value;
    if (!text.trim()) return;
    const ingredients = parseRecipeIngredients(text);
    state.recipeResults = checkRecipe(ingredients, state.items);
    renderRecipeResults();
  });

  document.getElementById('btn-clear-recipe').addEventListener('click', () => {
    document.getElementById('recipe-input').value = '';
    state.recipeResults = null;
    renderRecipeResults();
  });

  // Close modal on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

// ════════════════════════════════════════════════════════════
//  Init
// ════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  renderApp();
});
