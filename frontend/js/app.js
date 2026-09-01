(() => {
  'use strict';

  // If the frontend is deployed separately from the backend on Render,
  // set window.API_BASE (e.g. in a small inline script before this file)
  // to the backend's URL, such as "https://ks-associates-api.onrender.com".
  const API_BASE = window.API_BASE || '';
  const TOKEN_KEY = 'ks_admin_token';

  const PROTECTED_COLUMNS = new Set(['id', 'created_at', 'updated_at']);
  const COLUMN_TYPES = ['TEXT', 'INTEGER', 'NUMERIC', 'BOOLEAN', 'DATE', 'TIMESTAMPTZ'];

  const el = (id) => document.getElementById(id);

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    sqlToken: null, // deliberately NOT persisted - re-enter SQL key each session
    tables: [],
    currentTable: null,
    columns: [],
    page: 1,
    pageSize: 25,
    total: 0,
    search: '',
    sort: null,
    dir: 'asc',
    searchDebounce: null,
  };

  // ---------- API helper ----------
  async function api(path, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const authToken = token || state.token;
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      // no body
    }

    if (res.status === 401) {
      if (!token) {
        // Only the base admin session triggers a full logout. A 401 on a
        // request using an explicit (SQL) token just means that elevated
        // token expired - the caller handles re-locking the SQL console.
        handleLogout(false);
      }
      throw new Error(data.error || 'Session expired. Please log in again.');
    }
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(message, type = 'info') {
    const t = el('toast');
    t.textContent = message;
    t.className = `toast ${type}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------- Auth ----------
  function showLogin() {
    el('loginScreen').hidden = false;
    el('dashboard').hidden = true;
  }

  function showDashboard() {
    el('loginScreen').hidden = true;
    el('dashboard').hidden = false;
    loadTables();
  }

  el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const adminKey = el('adminKeyInput').value.trim();
    const btn = el('loginBtn');
    const errorEl = el('loginError');
    errorEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Verifying\u2026';
    try {
      const data = await api('/api/admin/login', { method: 'POST', body: { adminKey } });
      state.token = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      el('adminKeyInput').value = '';
      showDashboard();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock Dashboard';
    }
  });

  function handleLogout(showMsg = true) {
    state.token = null;
    state.sqlToken = null;
    localStorage.removeItem(TOKEN_KEY);
    state.currentTable = null;
    el('sqlPanel').hidden = true;
    showLogin();
    if (showMsg) toast('Logged out.', 'info');
  }
  el('logoutBtn').addEventListener('click', () => handleLogout(true));

  // ---------- Tables (datasets) ----------
  async function loadTables() {
    try {
      const data = await api('/api/tables');
      state.tables = data.tables;
      renderTableList();
      if (!state.currentTable && state.tables.length > 0) {
        selectTable(state.tables[0].table_name);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderTableList() {
    const list = el('tableList');
    list.innerHTML = '';
    state.tables.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'table-list-item' + (t.table_name === state.currentTable ? ' active' : '');
      li.innerHTML = `
        <span class="table-list-name">${escapeHtml(t.label || t.table_name)}</span>
        <span class="table-list-count">${t.column_count} field${t.column_count === '1' ? '' : 's'}</span>
      `;
      li.addEventListener('click', () => selectTable(t.table_name));
      list.appendChild(li);
    });
  }

  function selectTable(tableName) {
    state.currentTable = tableName;
    state.page = 1;
    state.search = '';
    state.sort = null;
    el('searchInput').value = '';
    renderTableList();
    el('emptyState').hidden = true;
    el('tableView').hidden = false;
    loadRows();
  }

  // ---------- Rows ----------
  async function loadRows() {
    if (!state.currentTable) return;
    const params = new URLSearchParams({
      page: state.page,
      pageSize: state.pageSize,
    });
    if (state.search) params.set('search', state.search);
    if (state.sort) { params.set('sort', state.sort); params.set('dir', state.dir); }

    try {
      const data = await api(`/api/data/${state.currentTable}/rows?${params.toString()}`);
      state.columns = data.columns;
      state.total = data.total;
      renderTableMeta();
      renderTable(data.columns, data.rows);
      renderPagination();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderTableMeta() {
    const meta = state.tables.find((t) => t.table_name === state.currentTable);
    el('tableTitle').textContent = meta ? (meta.label || meta.table_name) : state.currentTable;
    el('tableMeta').textContent = `${state.total} record${state.total === 1 ? '' : 's'}`;
  }

  function renderTable(columns, rows) {
    const head = el('dataTableHead');
    const body = el('dataTableBody');
    head.innerHTML = '';
    body.innerHTML = '';

    const headRow = document.createElement('tr');
    columns.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c.column_name;
      th.style.cursor = 'pointer';
      th.title = 'Click to sort';
      th.addEventListener('click', () => {
        if (state.sort === c.column_name) {
          state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = c.column_name;
          state.dir = 'asc';
        }
        loadRows();
      });
      headRow.appendChild(th);
    });
    const thActions = document.createElement('th');
    thActions.textContent = 'Actions';
    thActions.className = 'actions-col';
    headRow.appendChild(thActions);
    head.appendChild(headRow);

    if (rows.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'table-empty-row';
      const td = document.createElement('td');
      td.colSpan = columns.length + 1;
      td.textContent = 'No records yet. Click "Add Record" to create the first one.';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement('tr');
      columns.forEach((c) => {
        const td = document.createElement('td');
        const val = row[c.column_name];
        td.textContent = val === null || val === undefined ? '\u2014' : String(val);
        td.title = td.textContent;
        tr.appendChild(td);
      });
      const tdActions = document.createElement('td');
      tdActions.className = 'row-actions actions-col';
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openRowModal(row));
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => confirmDeleteRow(row.id));
      tdActions.appendChild(editBtn);
      tdActions.appendChild(delBtn);
      tr.appendChild(tdActions);
      body.appendChild(tr);
    });
  }

  function renderPagination() {
    const totalPages = Math.max(Math.ceil(state.total / state.pageSize), 1);
    el('pageInfo').textContent = `Page ${state.page} of ${totalPages}`;
    el('prevPageBtn').disabled = state.page <= 1;
    el('nextPageBtn').disabled = state.page >= totalPages;
  }

  el('prevPageBtn').addEventListener('click', () => {
    if (state.page > 1) { state.page -= 1; loadRows(); }
  });
  el('nextPageBtn').addEventListener('click', () => {
    state.page += 1; loadRows();
  });

  el('searchInput').addEventListener('input', (e) => {
    clearTimeout(state.searchDebounce);
    const val = e.target.value;
    state.searchDebounce = setTimeout(() => {
      state.search = val;
      state.page = 1;
      loadRows();
    }, 350);
  });

  async function confirmDeleteRow(id) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return;
    try {
      await api(`/api/data/${state.currentTable}/rows/${id}`, { method: 'DELETE' });
      toast('Record deleted.', 'success');
      loadRows();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- Modal helper ----------
  function openModal(html, onMount) {
    el('modalBox').innerHTML = html;
    el('modalOverlay').hidden = false;
    if (onMount) onMount(el('modalBox'));
  }
  function closeModal() {
    el('modalOverlay').hidden = true;
    el('modalBox').innerHTML = '';
  }
  el('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  // ---------- Add / Edit row modal ----------
  el('addRowBtn').addEventListener('click', () => openRowModal(null));

  function openRowModal(existingRow) {
    const editable = state.columns.filter((c) => !PROTECTED_COLUMNS.has(c.column_name));
    const isEdit = !!existingRow;

    const fieldsHtml = editable.map((c) => `
      <div class="field-group">
        <label for="field_${c.column_name}">${c.column_name} <span class="muted">(${c.data_type})</span></label>
        <input
          id="field_${c.column_name}"
          name="${c.column_name}"
          type="${inputTypeFor(c.data_type)}"
          value="${isEdit && existingRow[c.column_name] != null ? escapeHtml(String(existingRow[c.column_name])) : ''}"
        />
      </div>
    `).join('');

    openModal(`
      <h3>${isEdit ? 'Edit Record' : 'Add Record'}</h3>
      <form id="rowForm">
        ${fieldsHtml || '<p class="muted">This table has no editable fields yet. Add a field first.</p>'}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancelRowBtn">Cancel</button>
          <button type="submit" class="btn btn-brass">${isEdit ? 'Save Changes' : 'Create Record'}</button>
        </div>
      </form>
    `, (box) => {
      box.querySelector('#cancelRowBtn').addEventListener('click', closeModal);
      box.querySelector('#rowForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {};
        editable.forEach((c) => {
          const raw = box.querySelector(`#field_${c.column_name}`).value;
          payload[c.column_name] = raw === '' ? null : raw;
        });
        try {
          if (isEdit) {
            await api(`/api/data/${state.currentTable}/rows/${existingRow.id}`, { method: 'PUT', body: payload });
            toast('Record updated.', 'success');
          } else {
            await api(`/api/data/${state.currentTable}/rows`, { method: 'POST', body: payload });
            toast('Record created.', 'success');
          }
          closeModal();
          loadRows();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  function inputTypeFor(dataType) {
    const t = dataType.toLowerCase();
    if (t.includes('int') || t.includes('numeric') || t.includes('double')) return 'number';
    if (t.includes('date') && !t.includes('time')) return 'date';
    if (t.includes('bool')) return 'text';
    return 'text';
  }

  // ---------- Create table modal ----------
  el('newTableBtn').addEventListener('click', openCreateTableModal);

  function openCreateTableModal() {
    openModal(`
      <h3>Create New Dataset</h3>
      <form id="createTableForm">
        <div class="field-group">
          <label for="newTableName">Table Name</label>
          <input id="newTableName" placeholder="e.g. clients" required pattern="[A-Za-z_][A-Za-z0-9_]*" />
        </div>
        <div class="field-group">
          <label for="newTableLabel">Display Label</label>
          <input id="newTableLabel" placeholder="e.g. Clients" />
        </div>
        <label style="font-size:12px;font-weight:600;color:var(--ink);text-transform:uppercase;letter-spacing:0.5px;">Fields</label>
        <div id="columnRows"></div>
        <button type="button" id="addColumnRowBtn" class="btn btn-small btn-ghost" style="margin-top:6px;">+ Add Field</button>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancelCreateTableBtn">Cancel</button>
          <button type="submit" class="btn btn-brass">Create Dataset</button>
        </div>
      </form>
    `, (box) => {
      const columnRows = box.querySelector('#columnRows');
      const addColumnRow = () => {
        const row = document.createElement('div');
        row.className = 'dynamic-row';
        row.innerHTML = `
          <input placeholder="field name" class="col-name" pattern="[A-Za-z_][A-Za-z0-9_]*" required />
          <select class="col-type">${COLUMN_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
          <button type="button" class="remove-row-btn" title="Remove">&times;</button>
        `;
        row.querySelector('.remove-row-btn').addEventListener('click', () => row.remove());
        columnRows.appendChild(row);
      };
      addColumnRow();
      box.querySelector('#addColumnRowBtn').addEventListener('click', addColumnRow);
      box.querySelector('#cancelCreateTableBtn').addEventListener('click', closeModal);

      box.querySelector('#createTableForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tableName = box.querySelector('#newTableName').value.trim();
        const label = box.querySelector('#newTableLabel').value.trim();
        const columns = Array.from(columnRows.querySelectorAll('.dynamic-row')).map((row) => ({
          name: row.querySelector('.col-name').value.trim(),
          type: row.querySelector('.col-type').value,
        })).filter((c) => c.name);

        if (columns.length === 0) {
          toast('Add at least one field.', 'error');
          return;
        }
        try {
          await api('/api/tables', { method: 'POST', body: { tableName, label, columns } });
          toast('Dataset created.', 'success');
          closeModal();
          await loadTables();
          selectTable(tableName);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  // ---------- Add column modal ----------
  el('addColumnBtn').addEventListener('click', () => {
    openModal(`
      <h3>Add Field to "${escapeHtml(state.currentTable)}"</h3>
      <form id="addColumnForm">
        <div class="field-group">
          <label for="colName">Field Name</label>
          <input id="colName" pattern="[A-Za-z_][A-Za-z0-9_]*" required />
        </div>
        <div class="field-group">
          <label for="colType">Field Type</label>
          <select id="colType">${COLUMN_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancelAddColBtn">Cancel</button>
          <button type="submit" class="btn btn-brass">Add Field</button>
        </div>
      </form>
    `, (box) => {
      box.querySelector('#cancelAddColBtn').addEventListener('click', closeModal);
      box.querySelector('#addColumnForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = box.querySelector('#colName').value.trim();
        const type = box.querySelector('#colType').value;
        try {
          await api(`/api/tables/${state.currentTable}/columns`, { method: 'POST', body: { name, type } });
          toast('Field added.', 'success');
          closeModal();
          await loadTables();
          loadRows();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  });

  // ---------- Delete table ----------
  el('deleteTableBtn').addEventListener('click', async () => {
    if (!state.currentTable) return;
    if (!window.confirm(`Permanently delete the "${state.currentTable}" dataset and all its records?`)) return;
    try {
      await api(`/api/tables/${state.currentTable}`, { method: 'DELETE' });
      toast('Dataset deleted.', 'success');
      state.currentTable = null;
      el('tableView').hidden = true;
      el('emptyState').hidden = false;
      loadTables();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ---------- SQL View ----------
  el('sqlViewBtn').addEventListener('click', openSqlPanel);
  el('sqlBackBtn').addEventListener('click', closeSqlPanel);

  function openSqlPanel() {
    el('dashboard').hidden = true;
    el('sqlPanel').hidden = false;
    if (state.sqlToken) {
      el('sqlGate').hidden = true;
      el('sqlConsole').hidden = false;
    } else {
      el('sqlGate').hidden = false;
      el('sqlConsole').hidden = true;
      el('sqlKeyInput').value = '';
      el('sqlUnlockError').hidden = true;
    }
  }

  function closeSqlPanel() {
    el('sqlPanel').hidden = true;
    el('dashboard').hidden = false;
  }

  el('sqlUnlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sqlKey = el('sqlKeyInput').value.trim();
    const btn = el('sqlUnlockBtn');
    const errorEl = el('sqlUnlockError');
    errorEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Verifying\u2026';
    try {
      const data = await api('/api/admin/sql-unlock', { method: 'POST', body: { sqlKey } });
      state.sqlToken = data.token; // memory only - not persisted
      el('sqlKeyInput').value = '';
      el('sqlGate').hidden = true;
      el('sqlConsole').hidden = false;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock SQL Console';
    }
  });

  el('runSqlBtn').addEventListener('click', runSqlQuery);
  el('sqlQueryInput').addEventListener('keydown', (e) => {
    // Cmd/Ctrl+Enter runs the query, matching most SQL console conventions.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runSqlQuery();
    }
  });

  const DESTRUCTIVE_RE = /\b(DROP|DELETE|TRUNCATE|ALTER)\b/i;

  async function runSqlQuery() {
    const query = el('sqlQueryInput').value;
    const statusEl = el('sqlStatus');
    const errorEl = el('sqlError');
    const runBtn = el('runSqlBtn');

    if (!query.trim()) {
      toast('Enter a query first.', 'error');
      return;
    }
    if (DESTRUCTIVE_RE.test(query) && !window.confirm(
      'This query looks like it may DROP, DELETE, TRUNCATE, or ALTER data. This cannot be undone. Continue?'
    )) {
      return;
    }

    errorEl.hidden = true;
    statusEl.textContent = 'Running\u2026';
    runBtn.disabled = true;

    try {
      const data = await api('/api/sql', { method: 'POST', body: { query }, token: state.sqlToken });
      renderSqlResults(data);
      const rowWord = data.rowCount === 1 ? 'row' : 'rows';
      statusEl.textContent = `${data.command || 'OK'} \u00b7 ${data.rowCount ?? 0} ${rowWord} \u00b7 ${data.durationMs}ms`;
    } catch (err) {
      // If the elevated SQL token itself expired, drop back to the gate
      // rather than silently failing.
      if (/session expired/i.test(err.message) || /locked/i.test(err.message)) {
        state.sqlToken = null;
        el('sqlConsole').hidden = true;
        el('sqlGate').hidden = false;
      }
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      statusEl.textContent = '';
    } finally {
      runBtn.disabled = false;
    }
  }

  function renderSqlResults(data) {
    const head = el('sqlResultsHead');
    const body = el('sqlResultsBody');
    head.innerHTML = '';
    body.innerHTML = '';

    const fields = data.fields || [];
    if (fields.length === 0) {
      return; // e.g. CREATE TABLE / UPDATE with no RETURNING - nothing to show
    }

    const headRow = document.createElement('tr');
    fields.forEach((f) => {
      const th = document.createElement('th');
      th.textContent = f;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);

    if (data.rows.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'table-empty-row';
      const td = document.createElement('td');
      td.colSpan = fields.length;
      td.textContent = 'Query returned no rows.';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    data.rows.forEach((row) => {
      const tr = document.createElement('tr');
      fields.forEach((f) => {
        const td = document.createElement('td');
        const val = row[f];
        td.textContent = val === null || val === undefined ? '\u2014' : String(val);
        td.title = td.textContent;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  // ---------- Utils ----------
  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }

  // ---------- Init ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('modalOverlay').hidden) closeModal();
  });

  if (state.token) {
    showDashboard();
  } else {
    showLogin();
  }
})();
