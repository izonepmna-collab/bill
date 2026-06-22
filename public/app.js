/* ── State ── */
let itemsData    = [];
let shopSettings = {};
let cart         = [];
let currentInvoice = '';
let selectedItem   = null;
let selectedVariant   = null;
let pendingVariantItem = null;

/* ══════════════════════════════════
   BOOT & AUTH
══════════════════════════════════ */
const token = localStorage.getItem('token');
const role  = localStorage.getItem('role');

async function init() {
  if (!token) {
    window.location.href = 'login.html';
    return;
  }
  
  applyRoleUI();

  await Promise.all([fetchSettings(), fetchItems()]);
  await loadNextInvoice();
  setDate();
}

function applyRoleUI() {
  if (role === 'Staff') {
    // Hide restricted links
    const links = document.querySelectorAll('.nav-link');
    links.forEach(l => {
      if (l.textContent.includes('Products') || l.textContent.includes('Settings') || l.textContent.includes('Bills') || l.textContent.includes('Users')) {
        l.style.display = 'none';
      }
    });
  }
}

function logout() {
  localStorage.clear();
  window.location.href = 'login.html';
}

function setDate() {
  document.getElementById('bill-date').textContent =
    new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

/* ══════════════════════════════════
   SHOP SETTINGS
══════════════════════════════════ */
async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    shopSettings = await res.json();
  } catch {
    shopSettings = { shop_name:'I ZONE', tagline:'Printing & Services', address:'', phone:'', email:'', gstin:'', logo_base64:'', bill_prefix:'INV' };
  }
  applyShopHeader();
}

function applyShopHeader() {
  const s = shopSettings;
  setText('bill-shop-name', s.shop_name || 'I ZONE');
  setText('bill-tagline',   s.tagline   || '');

  const addr = [s.address, s.city].filter(Boolean).join(', ');
  setText('bill-address', addr);

  const contact = [s.phone, s.email].filter(Boolean).join('  |  ');
  setText('bill-contact', contact);

  if (s.gstin) {
    setText('bill-gstin', 'GSTIN: ' + s.gstin);
    show('bill-gstin');
  } else hide('bill-gstin');

  if (s.logo_base64) {
    document.getElementById('bill-logo').src = s.logo_base64;
    show('bill-logo-wrap');
  } else hide('bill-logo-wrap');

  // page title
  document.title = (s.shop_name || 'I Zone') + ' – Billing';
}

/* ══════════════════════════════════
   INVOICE NUMBER
══════════════════════════════════ */
async function loadNextInvoice() {
  try {
    const res = await fetch('/api/bills/next-invoice', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    currentInvoice = data.invoice;
  } catch {
    const prefix = shopSettings.bill_prefix || 'INV';
    currentInvoice = `${prefix}-${String(Date.now()).slice(-4)}`;
  }
  document.getElementById('bill-no').textContent = currentInvoice;
}

/* ══════════════════════════════════
   ITEMS
══════════════════════════════════ */
async function fetchItems() {
  try {
    const res = await fetch('/api/items', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return logout();
      throw new Error();
    }
    itemsData = await res.json();
  } catch {
    itemsData = FALLBACK;
  }
  renderItemsList();
}

function renderItemsList(filter = '') {
  const container = document.getElementById('item-selector');
  container.innerHTML = '';

  const q = filter.trim().toLowerCase();
  const filtered = itemsData.filter(i =>
    i.name.toLowerCase().includes(q) || (i.category||'').toLowerCase().includes(q)
  );

  if (!filtered.length) {
    container.innerHTML = '<div class="loading-msg">No items found.</div>';
    return;
  }

  const groups = {};
  filtered.forEach(item => {
    const cat = item.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  Object.entries(groups).forEach(([cat, items]) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'category-group';

    const catTitle = document.createElement('div');
    catTitle.className = 'category-title';
    catTitle.textContent = cat;
    groupEl.appendChild(catTitle);

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.id = 'item-' + item.id;

      const badge = getBadge(item);
      const sub   = item.type === 'variants'
        ? `${(item.variants||[]).length} option${(item.variants||[]).length !== 1 ? 's' : ''}`
        : item.type === 'slab' ? 'Slab pricing'
        : `₹${item.rate} fixed`;

      card.innerHTML = `
        <div>
          <div class="item-name">${item.name}</div>
          <div class="item-sub">${sub}</div>
        </div>
        ${badge}
      `;
      card.addEventListener('click', () => onItemClick(item));
      groupEl.appendChild(card);
    });
    container.appendChild(groupEl);
  });
}

function getBadge(item) {
  const cat  = (item.category||'').toLowerCase();
  const name = item.name.toLowerCase();
  if (item.type === 'variants')           return '<span class="badge badge-variants">Options</span>';
  if (cat.includes('color')||name.includes('color')) return '<span class="badge badge-color">Color</span>';
  if (cat.includes('black')||name.includes('black')) return '<span class="badge badge-black">Black</span>';
  if (cat.includes('dtp')  ||name.includes('dtp'))   return '<span class="badge badge-dtp">DTP</span>';
  return '<span class="badge badge-other">Service</span>';
}

function onItemClick(item) {
  document.querySelectorAll('.item-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('item-' + item.id)?.classList.add('selected');
  if (item.type === 'variants') {
    openVariantModal(item);
  } else {
    selectedItem   = item;
    selectedVariant = null;
    document.getElementById('qty').focus();
  }
}

function filterItems() {
  renderItemsList(document.getElementById('search-input').value);
}

/* ══════════════════════════════════
   VARIANT MODAL
══════════════════════════════════ */
function openVariantModal(item) {
  pendingVariantItem = item;
  selectedVariant    = null;
  document.getElementById('modal-title').textContent = item.name;
  document.getElementById('modal-qty').value = 1;

  const grid = document.getElementById('variant-options');
  grid.innerHTML = '';
  (item.variants || []).forEach((v, idx) => {
    const el = document.createElement('div');
    el.className = 'variant-option';
    el.id = `vopt-${idx}`;
    el.innerHTML = `<div class="v-name">${v.name}</div><div class="v-rate">₹${v.rate}</div>`;
    el.addEventListener('click', () => {
      document.querySelectorAll('.variant-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      selectedVariant = v;
    });
    grid.appendChild(el);
  });

  document.getElementById('variant-overlay').style.display = 'flex';
}

function closeVariantModal() {
  document.getElementById('variant-overlay').style.display = 'none';
  pendingVariantItem = null;
  selectedVariant    = null;
}

document.getElementById('variant-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeVariantModal();
});

function addVariantToCart() {
  if (!selectedVariant) { alert('Please select an option.'); return; }
  const qty  = parseInt(document.getElementById('modal-qty').value) || 1;
  const rate = Number(selectedVariant.rate);
  cart.push({ name:`${pendingVariantItem.name} – ${selectedVariant.name}`, qty, rate, total: rate * qty });
  renderBill();
  closeVariantModal();
}

/* ══════════════════════════════════
   ADD (slab / fixed)
══════════════════════════════════ */
document.getElementById('add-btn').addEventListener('click', () => {
  if (!selectedItem) { alert('Please select an item.'); return; }
  const qty  = parseInt(document.getElementById('qty').value) || 1;
  
  let rate = 0;
  let total = 0;

  if (selectedItem.type === 'fixed') {
    rate = Number(selectedItem.rate);
    total = rate * qty;
  } else if (selectedItem.type === 'slab') {
    rate = calculateRate(selectedItem, qty);
    total = rate * qty;

    // Minimum charge protection: prevent "cliff" where buying more is cheaper
    let prevMaxCost = 0;
    for (const s of selectedItem.prices) {
      if (s.max < qty) {
        const costAtMax = s.max * Number(s.rate);
        if (costAtMax > prevMaxCost) prevMaxCost = costAtMax;
      }
    }
    
    // If the calculated total drops below the highest cost of any previous slab, bump it up
    if (total < prevMaxCost) {
      total = prevMaxCost;
    }
  }

  cart.push({ name: selectedItem.name, qty, rate, total });
  document.getElementById('qty').value = 1;
  renderBill();
});

function calculateRate(item, qty) {
  if (item.type === 'slab') {
    for (const s of item.prices) {
      if (qty >= s.min && qty <= s.max) return Number(s.rate);
    }
    return Number(item.prices[item.prices.length - 1].rate);
  }
  return 0;
}

/* ══════════════════════════════════
   SAVE BILL
══════════════════════════════════ */
document.getElementById('save-btn').addEventListener('click', async () => {
  if (!cart.length) { alert('Add items to the bill first.'); return; }

  const total  = cart.reduce((s, i) => s + i.total, 0);
  const date   = document.getElementById('bill-date').textContent;
  const invNo  = currentInvoice;

  try {
    const res = await fetch('/api/bills', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body:    JSON.stringify({ invoice_no: invNo, date, items: cart, total })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    showToast(`✅ Bill ${invNo} saved!`);

    // Start a fresh bill
    cart = [];
    selectedItem = null;
    renderBill();
    await loadNextInvoice();

  } catch (err) {
    showToast('❌ Save failed: ' + err.message, 'error');
  }
});

/* ══════════════════════════════════
   CLEAR
══════════════════════════════════ */
document.getElementById('clear-btn').addEventListener('click', () => {
  if (cart.length && !confirm('Start a new bill? Current items will be lost.')) return;
  cart = [];
  selectedItem = null;
  renderBill();
  loadNextInvoice();
  setDate();
});

/* ══════════════════════════════════
   RENDER BILL
══════════════════════════════════ */
function removeFromCart(idx) { cart.splice(idx, 1); renderBill(); }

function renderBill() {
  const tbody = document.getElementById('bill-body');
  tbody.innerHTML = '';
  let total = 0;

  if (!cart.length) {
    tbody.innerHTML = `<tr id="empty-row"><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px 0;font-size:14px;">No items added yet.</td></tr>`;
    document.getElementById('grand-total').textContent = '0.00';
    return;
  }

  cart.forEach((item, idx) => {
    total += item.total;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:#94a3b8;font-size:12px;">${idx+1}</td>
      <td style="font-weight:600;">${item.name}</td>
      <td class="num">${item.qty}</td>
      <td class="num">${item.rate.toFixed(2)}</td>
      <td class="num" style="font-weight:700;">${item.total.toFixed(2)}</td>
      <td class="no-print" style="text-align:right;">
        <button class="item-delete-btn" onclick="removeFromCart(${idx})">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('grand-total').textContent = total.toFixed(2);
}

/* ══════════════════════════════════
   TOAST
══════════════════════════════════ */
function showToast(msg, type = 'success') {
  const old = document.getElementById('app-toast');
  if (old) old.remove();
  const colors = { success:'#10b981', warn:'#f59e0b', error:'#ef4444' };
  const t = document.createElement('div');
  t.id = 'app-toast';
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;background:${colors[type]||colors.success};
    color:white;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;
    font-family:Inter,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.4);animation:fadeInUp 0.3s ease;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ══════════════════════════════════
   HELPERS
══════════════════════════════════ */
function setText(id, val) { const el=document.getElementById(id); if(el) el.textContent=val||''; }
function show(id) { const el=document.getElementById(id); if(el) el.style.display=''; }
function hide(id) { const el=document.getElementById(id); if(el) el.style.display='none'; }

/* ══════════════════════════════════
   FALLBACK DATA
══════════════════════════════════ */
const FALLBACK = [
  { id:1, name:'A4 Black Single', category:'Black Print', type:'slab', prices:[{min:1,max:20,rate:2},{min:21,max:50,rate:1.5},{min:51,max:99,rate:1.2},{min:100,max:100000,rate:1}] },
  { id:2, name:'A4 Black Double', category:'Black Print', type:'slab', prices:[{min:1,max:100,rate:1},{min:101,max:500,rate:0.8},{min:501,max:1000,rate:0.7},{min:1001,max:100000,rate:0.6}] },
  { id:3, name:'Color Print',     category:'Color Print', type:'variants', variants:[{name:'A4 Single Side',rate:10},{name:'A4 Double Side',rate:20}] },
  { id:4, name:'Photostat',       category:'Photostat',   type:'variants', variants:[{name:'Single Side',rate:2},{name:'Double Side',rate:3}] },
  { id:5, name:'DTP',             category:'DTP',         type:'variants', variants:[{name:'English (per page)',rate:50},{name:'Malayalam (per page)',rate:80}] },
  { id:6, name:'Browsing',        category:'Browsing',    type:'fixed', rate:40 }
];

const style = document.createElement('style');
style.textContent = `@keyframes fadeInUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`;
document.head.appendChild(style);

init();
