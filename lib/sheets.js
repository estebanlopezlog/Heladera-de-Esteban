'use strict';

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

let sheetsClientPromise = null;

function getSheetsClient() {
  if (!sheetsClientPromise) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClientPromise = auth.getClient().then(authClient =>
      google.sheets({ version: 'v4', auth: authClient })
    );
  }
  return sheetsClientPromise;
}

function colLetter(index) {
  // 0-based column index -> spreadsheet column letter (supports up to 26 columns)
  return String.fromCharCode(65 + index);
}

/**
 * Treats a single sheet tab as a simple table addressed by row "id".
 * `columns` must list the column keys in the exact order they appear
 * in the sheet, with the first column being the row's unique id.
 */
class SheetTable {
  constructor(sheetName, columns) {
    this.sheetName = sheetName;
    this.columns = columns;
    this.lastCol = colLetter(columns.length - 1);
  }

  rowToObject(row) {
    const obj = {};
    this.columns.forEach((col, i) => { obj[col] = row[i] ?? ''; });
    return obj;
  }

  objectToRow(obj) {
    return this.columns.map(col => (obj[col] === undefined || obj[col] === null) ? '' : obj[col]);
  }

  async getAll() {
    const sheets = await getSheetsClient();
    const range = `${this.sheetName}!A2:${this.lastCol}`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
    return (res.data.values || []).map(row => this.rowToObject(row));
  }

  async append(obj) {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${this.sheetName}!A:${this.lastCol}`,
      valueInputOption: 'RAW',
      requestBody: { values: [this.objectToRow(obj)] },
    });
    return obj;
  }

  async _findRowNumber(id) {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${this.sheetName}!A2:A`,
    });
    const ids = (res.data.values || []).map(r => r[0]);
    const idx = ids.indexOf(id);
    return idx === -1 ? -1 : idx + 2; // +2: 1-based, plus header row
  }

  async _getSheetId() {
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheet = meta.data.sheets.find(s => s.properties.title === this.sheetName);
    if (!sheet) throw new Error(`Sheet tab "${this.sheetName}" not found`);
    return sheet.properties.sheetId;
  }

  async update(id, obj) {
    const rowNum = await this._findRowNumber(id);
    if (rowNum === -1) throw new Error(`Row with id "${id}" not found in ${this.sheetName}`);
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${this.sheetName}!A${rowNum}:${this.lastCol}${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [this.objectToRow({ ...obj, id })] },
    });
  }

  async delete(id) {
    const rowNum = await this._findRowNumber(id);
    if (rowNum === -1) return;
    await this._deleteRows([rowNum]);
  }

  /** Deletes every row whose `column` equals `value` (e.g. all ingredients of a recipe). */
  async deleteWhere(column, value) {
    const colIdx = this.columns.indexOf(column);
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${this.sheetName}!A2:${this.lastCol}`,
    });
    const rows = res.data.values || [];
    const rowNumbers = [];
    rows.forEach((row, i) => { if (row[colIdx] === value) rowNumbers.push(i + 2); });
    if (rowNumbers.length) await this._deleteRows(rowNumbers);
  }

  async _deleteRows(rowNumbers) {
    const sheets = await getSheetsClient();
    const sheetId = await this._getSheetId();
    // Delete from bottom to top so earlier deletions don't shift later row indices.
    const requests = [...rowNumbers].sort((a, b) => b - a).map(rowNum => ({
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowNum - 1, endIndex: rowNum },
      },
    }));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    });
  }
}

module.exports = { SheetTable };
