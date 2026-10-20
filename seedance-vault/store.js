(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), root);
  else root.VaultStore = factory(root.VaultCore, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, root) {
  'use strict';
  const DATABASE = 'seedance-prompt-vault';
  let opening = null;
  let database = null;

  function open() {
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('此浏览器不支持 IndexedDB，无法保存。请使用最新版 Chrome、Edge、Firefox 或 Safari。')); return; }
      let settled = false;
      let request;
      try { request = root.indexedDB.open(DATABASE, 1); }
      catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      };
      request.onblocked = () => { settled = true; reject(new Error('数据库升级被其他标签页阻止，请关闭本应用的其他标签页后重试。')); };
      request.onerror = () => { settled = true; reject(request.error || new Error('无法打开浏览器数据库')); };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        database = request.result;
        const opened = database;
        opened.onversionchange = () => { opened.close(); if (database === opened) { database = null; opening = null; } };
        opened.onclose = () => { if (database === opened) { database = null; opening = null; } };
        resolve(database);
      };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function all() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readonly');
      const request = transaction.objectStore('records').getAll();
      let values;
      request.onsuccess = () => { values = request.result; };
      transaction.oncomplete = () => resolve(values || []);
      transaction.onerror = () => reject(transaction.error || request.error || new Error('读取失败'));
      transaction.onabort = () => reject(transaction.error || new Error('读取已中止'));
    });
  }
  async function save(input) {
    const record = Core.validateRecord(input);
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      const request = transaction.objectStore('records').put(record);
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () => reject(transaction.error || request.error || new Error('保存失败，请检查浏览器存储空间'));
      transaction.onabort = () => reject(transaction.error || request.error || new Error('保存已中止，原记录未更改'));
    });
  }
  async function importRecords(input) {
    if (!Array.isArray(input)) throw new Error('导入记录必须是数组');
    const incoming = input.map(Core.validateRecord);
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      const request = store.getAll();
      let result;
      let validationError;
      request.onsuccess = () => {
        try {
          result = Core.prepareImport(request.result, incoming);
          for (const record of result.records) store.add(record);
        } catch (error) { validationError = error; try { transaction.abort(); } catch (_) {} }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(validationError || transaction.error || request.error || new Error('导入失败，现有数据未更改'));
      transaction.onabort = () => reject(validationError || transaction.error || new Error('导入已中止，现有数据未更改'));
    });
  }
  return Object.freeze({ open, all, save, importRecords });
});
