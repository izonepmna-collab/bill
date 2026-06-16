const fallbackData = [
  { "id": 1, "name": "A4 Black Single", "type": "slab", "prices": [ { "min": 1, "max": 20, "rate": 2 }, { "min": 21, "max": 50, "rate": 1.5 }, { "min": 51, "max": 99, "rate": 1.2 }, { "min": 100, "max": 100000, "rate": 1 } ] },
  { "id": 2, "name": "A4 Black Double", "type": "slab", "prices": [ { "min": 1, "max": 100, "rate": 1 }, { "min": 101, "max": 500, "rate": 0.8 }, { "min": 501, "max": 1000, "rate": 0.7 }, { "min": 1001, "max": 100000, "rate": 0.6 } ] },
  { "id": 3, "name": "A4 Color Single", "type": "fixed", "rate": 10 },
  { "id": 4, "name": "A4 Color Double", "type": "fixed", "rate": 20 },
  { "id": 5, "name": "Photostat Single", "type": "fixed", "rate": 2 },
  { "id": 6, "name": "Photostat Double", "type": "fixed", "rate": 3 },
  { "id": 7, "name": "DTP English", "type": "fixed", "rate": 50 },
  { "id": 8, "name": "DTP Malayalam", "type": "fixed", "rate": 80 },
  { "id": 9, "name": "Browsing (per hour)", "type": "fixed", "rate": 40 }
];

let itemsData = [];

async function fetchSettings() {
  try {
    const res = await fetch('http://localhost:3000/api/items');
    if (!res.ok) throw new Error('API Error');
    itemsData = await res.json();
  } catch (err) {
    console.warn("Using offline fallback data:", err);
    itemsData = fallbackData;
    const msg = document.createElement('div');
    msg.style.padding = '12px 16px';
    msg.style.background = '#fef3c7';
    msg.style.color = '#92400e';
    msg.style.borderLeft = '4px solid #f59e0b';
    msg.style.borderRadius = '4px';
    msg.style.marginBottom = '25px';
    msg.style.fontSize = '14px';
    msg.innerHTML = '<strong>Offline Mode Active:</strong> Could not connect to the local Node.js server. Changes will be saved in memory but will reset when you refresh the page. Start the Node.js backend to save changes permanently to the database.';
    document.querySelector('.settings-container').insertBefore(msg, document.getElementById('settings-list'));
  }
  renderSettings();
}

function renderSettings() {
  const container = document.getElementById('settings-list');
  container.innerHTML = '';
  
  itemsData.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'item-settings-card';
    
    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin:0; font-size: 16px;">${item.name}</h3>
        <span class="badge-item badge-black-ui" style="background:#e2e8f0;">${item.type.toUpperCase()} RATE</span>
      </div>
      <div style="margin-top: 15px;" id="config-${index}">`;
      
    if (item.type === 'fixed') {
      html += `
        <label>Rate (₹): </label>
        <input type="number" id="rate-${item.id}" value="${item.rate}" class="slab-input">
      `;
    } else {
      item.prices.forEach((slab, sIdx) => {
        html += `
          <div class="slab-row">
            <label>Min Qty:</label> <input type="number" id="min-${item.id}-${sIdx}" value="${slab.min}" class="slab-input" disabled style="background:#f1f5f9; cursor:not-allowed;">
            <label>Max Qty:</label> <input type="number" id="max-${item.id}-${sIdx}" value="${slab.max}" class="slab-input" disabled style="background:#f1f5f9; cursor:not-allowed;">
            <label>Rate (₹):</label> <input type="number" id="rate-${item.id}-${sIdx}" value="${slab.rate}" class="slab-input" step="0.1">
          </div>
        `;
      });
      html += '<div style="font-size: 12px; color: #64748b; margin-top: 8px;">Note: Boundaries are fixed logic bounds. Please only update the rates.</div>';
    }
    
    html += `</div>
      <div style="margin-top: 15px; text-align: right;">
        <button onclick="saveItem(${index})" class="btn" style="padding: 8px 16px; font-size: 13px; display:inline-flex;">Save Changes</button>
      </div>
    `;
    div.innerHTML = html;
    container.appendChild(div);
  });
}

async function saveItem(index) {
  const item = itemsData[index];
  let payload = { type: item.type };
  
  if (item.type === 'fixed') {
    payload.rate = parseFloat(document.getElementById(`rate-${item.id}`).value);
  } else {
    payload.prices = item.prices.map((slab, sIdx) => ({
      min: slab.min,
      max: slab.max,
      rate: parseFloat(document.getElementById(`rate-${item.id}-${sIdx}`).value)
    }));
  }
  
  try {
    const res = await fetch(`http://localhost:3000/api/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to save to backend');
    alert(item.name + ' updated successfully in the Database!');
  } catch (err) {
    if(payload.rate) item.rate = payload.rate;
    if(payload.prices) item.prices = payload.prices;
    console.warn("Offline edit simulated.", err);
    alert(item.name + ' updated! (Offline Mode - saved in memory but will reset on refresh)');
  }
}

fetchSettings();
