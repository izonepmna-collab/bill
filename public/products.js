let allProducts = [];
let editingId = null;   // null = adding new, number = editing existing

/* ══════════════════════════════════
   FETCH & RENDER
══════════════════════════════════ */
async function fetchProducts() {
  try {
    const res = await fetch('/api/items');
    if (!res.ok) throw new Error();
    allProducts = await res.json();
  } catch {
    allProducts = [];
    showToast('⚠️ Could not connect to server. Running offline.', 'warn');
  }
  renderProducts();
  populateCategoryList();
}

function renderProducts() {
  const container = document.getElementById('products-list');
  if (!allProducts.length) {
    container.innerHTML = `<div style="color:#94a3b8;padding:20px 0;">No products yet. Add one above.</div>`;
    return;
  }

  // Group by category
  const groups = {};
  allProducts.forEach(p => {
    const cat = p.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });

  container.innerHTML = '';
  Object.entries(groups).forEach(([cat, products]) => {
    const section = document.createElement('div');
    section.style.marginBottom = '24px';

    const title = document.createElement('div');
    title.className = 'category-title';
    title.style.cssText = 'font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:10px;';
    title.textContent = cat;
    section.appendChild(title);

    products.forEach(p => {
      const row = document.createElement('div');
      row.className = 'product-row';

      let variantHtml = '';
      if (p.type === 'variants' && p.variants) {
        variantHtml = p.variants.map(v =>
          `<span class="variant-chip"><strong>${v.name}</strong> — ₹${v.rate}</span>`
        ).join('');
      } else if (p.type === 'slab' && p.prices) {
        variantHtml = p.prices.map(s =>
          `<span class="variant-chip">${s.min}–${s.max} qty: <strong>₹${s.rate}</strong></span>`
        ).join('');
      } else if (p.type === 'fixed') {
        variantHtml = `<span class="variant-chip">Fixed: <strong>₹${p.rate}</strong></span>`;
      }

      row.innerHTML = `
        <div class="product-info">
          <div class="product-name">${p.name}</div>
          <div class="product-cat">${p.category || '—'} · ${p.type}</div>
          <div class="variants-preview">${variantHtml}</div>
        </div>
        <div class="product-actions">
          <button class="btn btn-outline btn-sm" onclick="startEdit(${p.id})">✏️ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id}, '${p.name.replace(/'/g,"\\'")}')">🗑️</button>
        </div>
      `;
      section.appendChild(row);
    });

    container.appendChild(section);
  });
}

function populateCategoryList() {
  const dl = document.getElementById('cat-list');
  const cats = [...new Set(allProducts.map(p => p.category).filter(Boolean))];
  dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
}

/* ══════════════════════════════════
   FORM – TYPE CHANGE
══════════════════════════════════ */
function onTypeChange() {
  const type = document.getElementById('p-type').value;
  document.getElementById('variants-section').style.display = type === 'variants' ? 'block' : 'none';
  document.getElementById('slab-section').style.display     = type === 'slab'     ? 'block' : 'none';
  document.getElementById('fixed-rate-wrap').style.display  = type === 'fixed'    ? 'block' : 'none';
}

/* ══════════════════════════════════
   VARIANT ROWS
══════════════════════════════════ */
function addVariantRow(name = '', rate = '') {
  const list = document.getElementById('variants-list');
  const row = document.createElement('div');
  row.className = 'variant-row-edit';
  row.innerHTML = `
    <input type="text"   placeholder="Option name (e.g. A4 Glossy)" value="${name}" class="v-name-input">
    <span>₹</span>
    <input type="number" placeholder="Rate" value="${rate}" min="0" step="0.5" class="v-rate-input" style="max-width:90px;">
    <button class="remove-variant-btn" onclick="this.parentElement.remove()" title="Remove">✕</button>
  `;
  list.appendChild(row);
}

/* ══════════════════════════════════
   SLAB ROWS
══════════════════════════════════ */
function addSlabRow(min = '', max = '', rate = '') {
  const list = document.getElementById('slab-list');
  const row = document.createElement('div');
  row.className = 'variant-row-edit';
  row.innerHTML = `
    <span>Min</span>
    <input type="number" placeholder="1"   value="${min}" min="0" class="s-min-input" style="max-width:70px;">
    <span>Max</span>
    <input type="number" placeholder="100" value="${max}" min="0" class="s-max-input" style="max-width:70px;">
    <span>₹</span>
    <input type="number" placeholder="Rate" value="${rate}" min="0" step="0.1" class="s-rate-input" style="max-width:80px;">
    <button class="remove-variant-btn" onclick="this.parentElement.remove()" title="Remove">✕</button>
  `;
  list.appendChild(row);
}

/* ══════════════════════════════════
   SAVE PRODUCT (add or update)
══════════════════════════════════ */
async function saveProduct() {
  const name     = document.getElementById('p-name').value.trim();
  const category = document.getElementById('p-category').value.trim();
  const type     = document.getElementById('p-type').value;

  if (!name) { alert('Please enter a product name.'); return; }

  let payload = { name, category, type };

  if (type === 'fixed') {
    const rate = parseFloat(document.getElementById('p-rate').value);
    if (isNaN(rate)) { alert('Please enter a valid rate.'); return; }
    payload.rate = rate;

  } else if (type === 'variants') {
    const rows = document.querySelectorAll('#variants-list .variant-row-edit');
    if (!rows.length) { alert('Please add at least one option.'); return; }
    payload.variants = [...rows].map(r => ({
      name: r.querySelector('.v-name-input').value.trim(),
      rate: parseFloat(r.querySelector('.v-rate-input').value)
    })).filter(v => v.name && !isNaN(v.rate));
    if (!payload.variants.length) { alert('Please fill in option names and rates.'); return; }

  } else if (type === 'slab') {
    const rows = document.querySelectorAll('#slab-list .variant-row-edit');
    if (!rows.length) { alert('Please add at least one slab range.'); return; }
    payload.prices = [...rows].map(r => ({
      min:  parseInt(r.querySelector('.s-min-input').value),
      max:  parseInt(r.querySelector('.s-max-input').value),
      rate: parseFloat(r.querySelector('.s-rate-input').value)
    })).filter(s => !isNaN(s.min) && !isNaN(s.max) && !isNaN(s.rate));
    if (!payload.prices.length) { alert('Please fill in all slab values.'); return; }
  }

  try {
    let res;
    if (editingId) {
      res = await fetch(`/api/items/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Unknown error');
    }

    showToast(editingId ? '✅ Product updated!' : '✅ Product added!');
    cancelEdit();
    fetchProducts();

  } catch (err) {
    showToast('❌ Error: ' + err.message, 'error');
  }
}

/* ══════════════════════════════════
   EDIT
══════════════════════════════════ */
function startEdit(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;

  editingId = id;
  document.getElementById('form-title').textContent = '✏️ Edit Product';
  document.getElementById('p-name').value     = p.name;
  document.getElementById('p-category').value = p.category || '';
  document.getElementById('p-type').value     = p.type;
  onTypeChange();

  if (p.type === 'fixed') {
    document.getElementById('p-rate').value = p.rate;

  } else if (p.type === 'variants') {
    document.getElementById('variants-list').innerHTML = '';
    (p.variants || []).forEach(v => addVariantRow(v.name, v.rate));

  } else if (p.type === 'slab') {
    document.getElementById('slab-list').innerHTML = '';
    (p.prices || []).forEach(s => addSlabRow(s.min, s.max, s.rate));
  }

  // Scroll form into view
  document.getElementById('add-form-panel').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingId = null;
  document.getElementById('form-title').textContent = '➕ Add New Product';
  document.getElementById('p-name').value     = '';
  document.getElementById('p-category').value = '';
  document.getElementById('p-type').value     = 'variants';
  document.getElementById('p-rate').value     = '';
  document.getElementById('variants-list').innerHTML = '';
  document.getElementById('slab-list').innerHTML     = '';
  onTypeChange();
}

/* ══════════════════════════════════
   DELETE
══════════════════════════════════ */
async function deleteProduct(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast(`🗑️ "${name}" deleted.`);
    fetchProducts();
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
}

/* ══════════════════════════════════
   TOAST NOTIFICATIONS
══════════════════════════════════ */
function showToast(msg, type = 'success') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  const colors = { success:'#10b981', warn:'#f59e0b', error:'#ef4444' };
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    background:${colors[type] || colors.success}; color:white;
    padding:14px 20px; border-radius:10px;
    font-size:14px; font-weight:600; font-family:Inter,sans-serif;
    box-shadow:0 8px 24px rgba(0,0,0,0.4);
    animation: fadeInUp 0.3s ease;
  `;

  const style = document.createElement('style');
  style.textContent = `@keyframes fadeInUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`;
  document.head.appendChild(style);

  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* ══════════════════════════════════
   INIT — add 2 default variant rows
══════════════════════════════════ */
addVariantRow();
addVariantRow();
fetchProducts();
