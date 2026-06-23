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

function reportError(err) {
  console.error(err);
  alert(`Hubo un problema: ${err.message}`);
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
//  Inventory business logic
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
    if (status === 'expired')  alerts.push({ type: 'expired',  item, days: daysUntil(item.expiryDate) });
    if (status === 'expiring') alerts.push({ type: 'expiring', item, days: daysUntil(item.expiryDate) });
    if (isLow(item))           alerts.push({ type: 'low',      item });
  });
  return alerts;
}

function nonExpiredItems() {
  return state.items.filter(i => getItemStatus(i) !== 'expired');
}

// ════════════════════════════════════════════════════════════
//  Recipe checker
// ════════════════════════════════════════════════════════════

function checkRecipeAgainstStock(recipe, inventoryItems) {
  return recipe.ingredients.map(needed => {
    const found = inventoryItems.find(item => {
      const a = item.name.toLowerCase();
      const b = needed.name.toLowerCase();
      return a.includes(b) || b.includes(a);
    });

    if (!found)               return { ...needed, status: 'missing',      inventoryItem: null };
    if (!needed.quantity)     return { ...needed, status: 'available',    inventoryItem: found };
    if (found.quantity >= needed.quantity)
                              return { ...needed, status: 'available',    inventoryItem: found };
    return                           { ...needed, status: 'insufficient', inventoryItem: found };
  });
}

// ════════════════════════════════════════════════════════════
//  App state
// ════════════════════════════════════════════════════════════

const state = {
  // inventory
  items:          [],
  activeTab:      'inventory',
  filterCategory: 'all',
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

  const tabIds = { inventory: 'tab-inventory', alerts: 'tab-alerts', recipes: 'tab-recipes' };
  Object.entries(tabIds).forEach(([key, id]) => {
    document.getElementById(id).style.display = state.activeTab === key ? 'block' : 'none';
  });

  if (state.activeTab === 'inventory') renderInventory(alerts);
  if (state.activeTab === 'alerts')    renderAlerts(alerts);
  if (state.activeTab === 'recipes')   renderRecipeBook();
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

  let cardCls = 'item-card';
  if (status === 'expired')       cardCls += ' item-card--expired';
  else if (status === 'expiring') cardCls += ' item-card--expiring';
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
  const lowBadge = low ? `<span class="badge badge-low">Stock bajo</span>` : '';

  return `
    <div class="${cardCls}">
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
        <button class="btn-icon btn-edit"   data-id="${item.id}" title="Editar">✏️</button>
        <button class="btn-icon btn-delete" data-id="${item.id}" title="Eliminar">🗑️</button>
      </div>
    </div>`;
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
  if (alert.type === 'low')      desc = `Quedan ${alert.item.quantity} ${alert.item.unit} — mínimo: ${alert.item.minQuantity}`;

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
  el.innerHTML = state.recipes.map(recipeCardHtml).join('');
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
  const notes = recipe.notes ? `<div class="recipe-book-notes">${escHtml(recipe.notes)}</div>` : '';
  return `
    <div class="recipe-book-card recipe-book-card--${stockStatus}">
      <div class="recipe-book-icon">🍽️</div>
      <div class="recipe-book-info">
        <div class="recipe-book-name">${escHtml(recipe.name)}</div>
        <div class="recipe-book-meta">${count} ingrediente${count !== 1 ? 's' : ''}</div>
        <span class="recipe-stock-pill recipe-stock-pill--${stockStatus}">${RECIPE_STATUS_LABEL[stockStatus]}</span>
        ${notes}
      </div>
      <div class="recipe-book-actions">
        <button class="btn-verify" data-id="${recipe.id}">🔍 Verificar</button>
        <div style="display:flex;gap:2px">
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

  const notesHtml = recipe.notes
    ? `<p class="check-recipe-notes">${escHtml(recipe.notes)}</p>` : '';

  const rows = results.map(r => {
    const icon   = r.status === 'available' ? '✅' : r.status === 'missing' ? '❌' : '⚠️';
    const needed = r.quantity ? `${r.quantity} ${r.unit || ''}`.trim() : 'alguna cantidad';
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
    <h2 class="check-recipe-title">${escHtml(recipe.name)}</h2>
    ${notesHtml}
    <div class="recipe-result">
      <div class="recipe-verdict recipe-verdict--${canCook ? 'yes' : 'no'}">
        ${canCook
          ? '✅ ¡Podés prepararlo! Tenés todo lo necesario'
          : `❌ Faltan ${missing.length + insuf.length} ingrediente${missing.length + insuf.length !== 1 ? 's'  : ''}`}
      </div>
      <div class="recipe-table">${rows}</div>
    </div>`;
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
      await api.updateItem(state.editingItem.id, itemData);
    } else {
      await api.createItem(itemData);
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
  const title     = document.getElementById('recipe-modal-title');
  const nameInput = document.getElementById('recipe-field-name');
  const notesEl   = document.getElementById('recipe-field-notes');
  const container = document.getElementById('ingredients-container');

  container.innerHTML = '';

  if (recipe) {
    title.textContent   = 'Editar receta';
    nameInput.value     = recipe.name;
    notesEl.value       = recipe.notes || '';
    recipe.ingredients.forEach(ing => addIngredientRow(container, ing));
  } else {
    title.textContent = 'Nueva receta';
    nameInput.value   = '';
    notesEl.value     = '';
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
    alert('Agregá al menos un ingrediente.');
    return;
  }

  const recipeData = {
    name,
    ingredients,
    notes: document.getElementById('recipe-field-notes').value.trim(),
  };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (state.editingRecipe) {
      await api.updateRecipe(state.editingRecipe.id, recipeData);
    } else {
      await api.createRecipe(recipeData);
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

  // ── Inventory modal ──
  document.getElementById('btn-add').addEventListener('click', () => openModal());
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('item-form').addEventListener('submit', handleFormSubmit);

  // ── Inventory item actions (delegation) ──
  document.getElementById('items-list').addEventListener('click', e => {
    const edit = e.target.closest('.btn-edit');
    const del  = e.target.closest('.btn-delete');
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
