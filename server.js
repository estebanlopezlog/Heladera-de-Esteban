'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const { SheetTable } = require('./lib/sheets');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const itemsTable = new SheetTable('Items', [
  'id', 'name', 'quantity', 'unit', 'category', 'expiryDate', 'minQuantity', 'addedDate', 'location',
]);
const recipesTable = new SheetTable('Recipes', ['id', 'name', 'notes', 'steps', 'servings', 'createdDate', 'sourceUrl']);
const ingredientsTable = new SheetTable('RecipeIngredients', ['recipeId', 'name', 'quantity', 'unit']);
const movementsTable = new SheetTable('Movements', ['id', 'date', 'type', 'name', 'quantity', 'unit', 'category']);
const extrasTable = new SheetTable('ShoppingExtras', ['id', 'name']);

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function toItemDTO(row) {
  return {
    id: row.id,
    name: row.name,
    quantity: parseFloat(row.quantity) || 0,
    unit: row.unit,
    category: row.category,
    expiryDate: row.expiryDate || null,
    minQuantity: parseFloat(row.minQuantity) || 0,
    addedDate: row.addedDate,
    location: row.location || 'heladera',
  };
}

// ════════════════════════════════════════════════════════════
//  Items
// ════════════════════════════════════════════════════════════

app.get('/api/items', async (req, res) => {
  try {
    const rows = await itemsTable.getAll();
    res.json(rows.map(toItemDTO));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items', async (req, res) => {
  try {
    const item = {
      id: generateId(),
      addedDate: new Date().toISOString().slice(0, 10),
      ...req.body,
    };
    await itemsTable.append(item);
    res.status(201).json(toItemDTO(item));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/items/:id', async (req, res) => {
  try {
    await itemsTable.update(req.params.id, { ...req.body, id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    await itemsTable.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  Recipes (+ ingredients in a separate sheet tab)
// ════════════════════════════════════════════════════════════

app.get('/api/recipes', async (req, res) => {
  try {
    const [recipes, ingredients] = await Promise.all([recipesTable.getAll(), ingredientsTable.getAll()]);
    const result = recipes.map(r => ({
      id: r.id,
      name: r.name,
      notes: r.notes || '',
      steps: r.steps || '',
      servings: parseInt(r.servings, 10) || 1,
      createdDate: r.createdDate,
      sourceUrl: r.sourceUrl || '',
      ingredients: ingredients
        .filter(ing => ing.recipeId === r.id)
        .map(ing => ({
          name: ing.name,
          quantity: ing.quantity !== '' ? parseFloat(ing.quantity) : null,
          unit: ing.unit || null,
        })),
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recipes', async (req, res) => {
  try {
    const id = generateId();
    const recipe = {
      id,
      name: req.body.name,
      notes: req.body.notes || '',
      steps: req.body.steps || '',
      servings: req.body.servings || 1,
      createdDate: new Date().toISOString().slice(0, 10),
      sourceUrl: req.body.sourceUrl || '',
    };
    await recipesTable.append(recipe);
    for (const ing of req.body.ingredients || []) {
      await ingredientsTable.append({
        recipeId: id, name: ing.name, quantity: ing.quantity ?? '', unit: ing.unit || '',
      });
    }
    res.status(201).json({ ...recipe, ingredients: req.body.ingredients || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/recipes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await recipesTable.update(id, {
      id,
      name: req.body.name,
      notes: req.body.notes || '',
      steps: req.body.steps || '',
      servings: req.body.servings || 1,
      createdDate: req.body.createdDate || '',
      sourceUrl: req.body.sourceUrl || '',
    });
    await ingredientsTable.deleteWhere('recipeId', id);
    for (const ing of req.body.ingredients || []) {
      await ingredientsTable.append({
        recipeId: id, name: ing.name, quantity: ing.quantity ?? '', unit: ing.unit || '',
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/recipes/:id', async (req, res) => {
  try {
    await recipesTable.delete(req.params.id);
    await ingredientsTable.deleteWhere('recipeId', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  Movements (historial de consumo/reposición para estadísticas)
// ════════════════════════════════════════════════════════════

app.get('/api/movements', async (req, res) => {
  try {
    const rows = await movementsTable.getAll();
    res.json(rows.map(m => ({
      id: m.id,
      date: m.date,
      type: m.type,
      name: m.name,
      quantity: parseFloat(m.quantity) || 0,
      unit: m.unit || '',
      category: m.category || '',
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/movements', async (req, res) => {
  try {
    const list = Array.isArray(req.body) ? req.body : [req.body];
    const rows = list.map(m => ({
      id: generateId(),
      date: new Date().toISOString().slice(0, 10),
      type: m.type,
      name: m.name,
      quantity: m.quantity ?? '',
      unit: m.unit || '',
      category: m.category || '',
    }));
    await movementsTable.appendMany(rows);
    res.status(201).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  Shopping extras (items manuales de la lista de compras)
// ════════════════════════════════════════════════════════════

app.get('/api/shopping-extras', async (req, res) => {
  try {
    res.json(await extrasTable.getAll());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shopping-extras', async (req, res) => {
  try {
    const extra = { id: generateId(), name: req.body.name };
    await extrasTable.append(extra);
    res.status(201).json(extra);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/shopping-extras/:id', async (req, res) => {
  try {
    await extrasTable.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Heladera de Esteban escuchando en puerto ${PORT}`));
