const MEMBERS = ['Phi', 'An'];
const HOLDER = 'An';
const FIELDS = { tien: 'Số tiền', ngay: 'Ngày', noi_dung: 'Nội dung', loai: 'Loại chi', nguoi: 'Người góp', ung: 'Người ứng' };
const MENU_BUTTON = { keyboard: [[{ text: '☰ Menu' }]], resize_keyboard: true, is_persistent: true };

export function money(value) { return Number(value).toLocaleString('vi-VN') + 'đ'; }
export function amount(raw) {
  let text = String(raw || '').trim().toLowerCase().replace(/\s/g, '');
  let factor = 1;
  if (text.endsWith('tr')) { factor = 1000000; text = text.slice(0, -2); }
  else if (text.endsWith('k')) { factor = 1000; text = text.slice(0, -1); }
  if (factor === 1) {
    if (!/^\d{1,3}([.,]\d{3})+$/.test(text) && !/^\d+$/.test(text)) throw new UserError('Số tiền không hợp lệ. Ví dụ: 50000, 50k, 1.000.000.');
    text = text.replace(/[.,]/g, '');
  } else text = text.replace(',', '.');
  const value = Number(text) * factor;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 10000000000) throw new UserError('Số tiền phải là số đồng nguyên, lớn hơn 0 và không quá 10 tỷ.');
  return value;
}
class UserError extends Error {}
const button = (label, data) => ({ text: label, callback_data: data });
const keyboard = rows => ({ inline_keyboard: rows });
const back = () => keyboard([[button('‹ Menu', 'm')]]);
const other = member => member === 'Phi' ? 'An' : 'Phi';
function menu() {
  return keyboard([
    [button('➕ Góp quỹ', 'new:contribution'), button('➖ Chi từ quỹ', 'new:expense')],
    [button('💳 Tôi ứng tiền', 'new:advance'), button('💰 Số dư', 'balance')],
    [button('⏳ Chờ tôi duyệt', 'pending'), button('🔄 Cần hoàn', 'due')],
    [button('📋 Giao dịch', 'history'), button('📊 Tháng này', 'report')],
    [button('📤 Xuất CSV', 'export')]
  ]);
}
function vnToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function validDate(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw || '') || Number.isNaN(Date.parse(raw + 'T00:00:00Z')) || new Date(raw + 'T00:00:00Z').toISOString().slice(0, 10) !== raw) throw new UserError('Ngày cần theo dạng YYYY-MM-DD.');
  return raw;
}
function positiveId(raw) {
  if (!/^[1-9]\d*$/.test(String(raw || '')) || !Number.isSafeInteger(Number(raw))) throw new UserError('Giao dịch không hợp lệ.');
  return Number(raw);
}
function sql(db, query, ...args) { return db.prepare(query).bind(...args); }
async function first(db, query, ...args) { return sql(db, query, ...args).first(); }
async function all(db, query, ...args) { return (await sql(db, query, ...args).all()).results; }
async function commit(db, updateId, statements) {
  await db.batch([sql(db, 'INSERT INTO processed_updates(update_id) VALUES(?)', updateId), ...statements]);
}
async function mark(db, updateId) { await sql(db, 'INSERT OR IGNORE INTO processed_updates(update_id) VALUES(?)', updateId).run(); }
function audit(db, txId, action, actor, before, after) {
  return sql(db, 'INSERT INTO audit(transaction_id,action,actor_id,before_json,after_json) VALUES(?,?,?,?,?)', txId, action, actor, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);
}
function queue(db, member, event, referenceId) {
  return sql(db, 'INSERT INTO notification_outbox(recipient_member,event,reference_id) VALUES(?,?,?)', member, event, referenceId);
}
function normalizedUsername(value) { return String(value || '').trim().replace(/^@/, '').toLowerCase(); }
export function allowedMember(env, user) {
  const phi = normalizedUsername(env.PHI_USERNAME);
  const an = normalizedUsername(env.AN_USERNAME);
  if (!phi || !an || phi === an) throw Error('Configure two distinct Telegram usernames.');
  const name = normalizedUsername(user?.username);
  if (name === phi) return 'Phi';
  if (name === an) return 'An';
  return null;
}
async function authorize(db, env, user) {
  const member = allowedMember(env, user);
  if (!member || !Number.isSafeInteger(user?.id)) return null;
  const existing = await first(db, 'SELECT telegram_id FROM users WHERE member=?', member);
  if (existing && existing.telegram_id !== user.id) return null;
  const byId = await first(db, 'SELECT member FROM users WHERE telegram_id=?', user.id);
  if (byId && byId.member !== member) return null;
  if (!existing) await sql(db, 'INSERT OR IGNORE INTO users(telegram_id,member) VALUES(?,?)', user.id, member).run();
  return member;
}
function rowText(row) {
  let label = row.kind === 'contribution' ? 'Góp quỹ · ' + row.member : (row.paid_by ? 'Ứng tiền · ' + row.paid_by : 'Chi từ quỹ');
  if (row.status === 'pending') label += ' · chờ duyệt';
  return '#' + row.id + ' · ' + (row.occurred_on || 'chưa rõ ngày') + '\n' + label + ' · ' + money(row.amount_vnd) + '\n' + row.description;
}
async function transaction(db, txId) {
  const row = await first(db, 'SELECT * FROM transactions WHERE id=? AND deleted_at IS NULL', txId);
  if (!row) throw new UserError('Không tìm thấy giao dịch.');
  return row;
}
function transactionButtons(row, member, userId) {
  const rows = [];
  if (row.status === 'pending' && row.created_by !== userId) rows.push([button('✅ Duyệt', 'approve:' + row.id), button('❌ Từ chối', 'reject:' + row.id)]);
  if (row.status === 'confirmed' && row.paid_by && Number(row.reimbursed_vnd) < Number(row.amount_vnd) && member === HOLDER) rows.push([button('↩️ Đã chuyển tiền hoàn', 'send:' + row.id)]);
  rows.push([button('✏️ Sửa', 'edit:' + row.id), button('🗑 Hủy', 'delete:' + row.id)]);
  rows.push([button('🕘 Nhật ký', 'audit:' + row.id), button('‹ Menu', 'm')]);
  return keyboard(rows);
}
async function summary(db) {
  const totals = await first(db, "SELECT COALESCE(SUM(CASE WHEN kind='contribution' THEN amount_vnd ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN kind='expense' THEN amount_vnd ELSE 0 END),0) expense,COALESCE(SUM(CASE WHEN kind='expense' AND paid_by IS NOT NULL THEN amount_vnd-reimbursed_vnd ELSE 0 END),0) due FROM transactions WHERE status='confirmed' AND deleted_at IS NULL");
  const members = await all(db, "SELECT member,SUM(amount_vnd) total FROM transactions WHERE kind='contribution' AND status='confirmed' AND deleted_at IS NULL GROUP BY member");
  return { ...totals, balance: totals.income - totals.expense, byMember: Object.fromEntries(members.map(row => [row.member, row.total])) };
}
async function telegram(env, method, body) {
  const form = body instanceof FormData;
  const response = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'POST', body: form ? body : JSON.stringify(body), headers: form ? {} : { 'content-type': 'application/json' }
  });
  const json = await response.json();
  if (!json.ok) throw Error('Telegram ' + method + ': ' + (json.description || response.status));
  return json.result;
}
async function send(env, chatId, message, markup) {
  return telegram(env, 'sendMessage', { chat_id: chatId, text: message.slice(0, 4000), ...(markup ? { reply_markup: markup } : {}) });
}
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
async function sendCsv(env, db, chatId) {
  const rows = await all(db, 'SELECT * FROM transactions ORDER BY id');
  const columns = ['id','occurred_on','kind','amount_vnd','member','description','category','paid_by','reimbursed_vnd','status','note','deleted_at','source_sheet','source_row'];
  const headers = ['ID','Ngày','Loại','Số tiền VND','Thành viên góp','Nội dung','Nhóm chi','Người ứng','Đã hoàn VND','Trạng thái','Ghi chú','Đã hủy','Nguồn','Dòng nguồn'];
  const body = '\ufeff' + [headers.join(','), ...rows.map(row => columns.map(key => csvCell(key === 'kind' ? (row.kind === 'contribution' ? 'Thu' : 'Chi') : row[key])).join(','))].join('\r\n');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([body], { type: 'text/csv;charset=utf-8' }), 'quy_phong.csv');
  await telegram(env, 'sendDocument', form);
}
function entryFromReply(message) {
  if (!message?.reply_to_message?.from?.is_bot || !message.text || message.text.startsWith('/')) return null;
  const prompt = message.reply_to_message.text || '';
  if (prompt.startsWith('Nhập khoản góp\n')) return { kind: 'contribution', value: message.text };
  if (prompt.startsWith('Nhập khoản chi\n')) return { kind: 'expense', value: message.text };
  if (prompt.startsWith('Nhập khoản ứng\n')) return { kind: 'advance', value: message.text };
  const edit = /^Sửa #([1-9]\d*) · (Số tiền|Ngày|Nội dung|Loại chi|Người góp|Người ứng)\n/.exec(prompt);
  if (edit) return { kind: 'edit', txId: Number(edit[1]), field: Object.keys(FIELDS).find(key => FIELDS[key] === edit[2]), value: message.text };
  return null;
}
function parseEntry(text) {
  const parts = String(text || '').trim().split(/\s+/);
  if (parts.length < 2) throw new UserError('Hãy nhập số tiền và nội dung, ví dụ: 50k mua rau.');
  const value = amount(parts.shift());
  const description = parts.join(' ').trim();
  if (!description || description.length > 1000) throw new UserError('Nội dung phải có từ 1 đến 1000 ký tự.');
  return { value, description };
}
function parseEdit(field, value, row) {
  const text = String(value || '').trim();
  if (field === 'tien') {
    const parsed = amount(text);
    if (parsed < Number(row.reimbursed_vnd)) throw new UserError('Số tiền mới nhỏ hơn khoản đã hoàn.');
    return parsed;
  }
  if (field === 'ngay') return validDate(text);
  if (field === 'noi_dung') {
    if (!text || text.length > 1000) throw new UserError('Nội dung phải có từ 1 đến 1000 ký tự.');
    return text;
  }
  if (field === 'loai') {
    if (row.kind !== 'expense' || !text || text.length > 100) throw new UserError('Loại chi không hợp lệ.');
    return text;
  }
  if (field === 'nguoi') {
    if (row.kind !== 'contribution' || !MEMBERS.includes(text)) throw new UserError('Người góp phải là Phi hoặc An.');
    return text;
  }
  if (field === 'ung') {
    if (row.kind !== 'expense') throw new UserError('Chỉ khoản chi mới có người ứng.');
    const parsed = text.toLowerCase() === 'quy' ? null : text;
    if (parsed !== null && !MEMBERS.includes(parsed)) throw new UserError('Người ứng phải là Phi, An hoặc quy.');
    if (Number(row.reimbursed_vnd) && parsed !== row.paid_by) throw new UserError('Khoản đã hoàn không thể đổi người ứng.');
    return parsed;
  }
  throw new UserError('Mục sửa không hợp lệ.');
}
async function openReimbursement(db, txId) {
  return first(db, "SELECT * FROM reimbursement_requests WHERE transaction_id=? AND status='sent'", txId);
}
async function makeNotification(db, item) {
  if (item.event === 'review_tx') {
    const row = await first(db, 'SELECT * FROM transactions WHERE id=?', item.reference_id);
    if (!row || row.status !== 'pending' || row.deleted_at) return null;
    return { text: 'Khoản mới cần bạn duyệt:\n' + rowText(row), markup: keyboard([[button('✅ Duyệt', 'approve:' + row.id), button('❌ Từ chối', 'reject:' + row.id)], [button('Xem chi tiết', 'tx:' + row.id)]]) };
  }
  if (item.event === 'review_change') {
    const change = await first(db, 'SELECT * FROM change_requests WHERE id=?', item.reference_id);
    if (!change || change.status !== 'pending') return null;
    const text = change.action === 'delete' ? 'Yêu cầu hủy giao dịch #' + change.transaction_id : 'Yêu cầu sửa ' + FIELDS[change.field] + ' của giao dịch #' + change.transaction_id + ' thành: ' + (change.proposed_value ?? 'quy');
    return { text, markup: keyboard([[button('✅ Duyệt', 'change:approve:' + change.id), button('❌ Từ chối', 'change:reject:' + change.id)]]) };
  }
  if (item.event === 'receive_reimbursement') {
    const request = await first(db, 'SELECT r.*,t.paid_by FROM reimbursement_requests r JOIN transactions t ON t.id=r.transaction_id WHERE r.id=?', item.reference_id);
    if (!request || request.status !== 'sent') return null;
    const text = request.paid_by === HOLDER
      ? 'An đã ghi nhận lấy ' + money(request.amount_vnd) + ' từ quỹ để hoàn ứng #' + request.transaction_id + '. Phi xác nhận giúp.'
      : 'An đã đánh dấu chuyển ' + money(request.amount_vnd) + ' để hoàn ứng #' + request.transaction_id + '. Phi đã nhận được tiền chưa?';
    return { text, markup: keyboard([[button('✅ Đã nhận / xác nhận', 'receive:' + request.id), button('❌ Chưa nhận', 'not_received:' + request.id)]]) };
  }
  if (item.event === 'approved_change' || item.event === 'rejected_change') {
    const change = await first(db, 'SELECT * FROM change_requests WHERE id=?', item.reference_id);
    if (!change) return null;
    return { text: item.event === 'approved_change'
      ? 'Yêu cầu sửa/hủy giao dịch #' + change.transaction_id + ' đã được duyệt.'
      : 'Yêu cầu sửa/hủy giao dịch #' + change.transaction_id + ' đã bị từ chối.', markup: back() };
  }
  const row = await first(db, 'SELECT * FROM transactions WHERE id=?', item.reference_id);
  if (!row) return null;
  const labels = {
    approved_tx: 'Giao dịch #' + row.id + ' đã được duyệt.',
    rejected_tx: 'Giao dịch #' + row.id + ' đã bị từ chối.',
    received_reimbursement: 'Khoản hoàn ứng #' + row.id + ' đã được xác nhận.',
    not_received_reimbursement: 'Khoản hoàn ứng #' + row.id + ' chưa được xác nhận đã nhận.'
  };
  if (labels[item.event]) return { text: labels[item.event], markup: back() };
  return null;
}
async function flushOutbox(env) {
  const items = await all(env.DB, 'SELECT * FROM notification_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 20');
  for (const item of items) {
    const recipient = await first(env.DB, 'SELECT telegram_id FROM users WHERE member=?', item.recipient_member);
    if (!recipient) continue;
    const notice = await makeNotification(env.DB, item);
    if (notice) await send(env, recipient.telegram_id, notice.text, notice.markup);
    await sql(env.DB, 'UPDATE notification_outbox SET sent_at=CURRENT_TIMESTAMP WHERE id=? AND sent_at IS NULL', item.id).run();
  }
}
async function createTransaction(db, updateId, userId, member, kind, text) {
  const { value, description } = parseEntry(text);
  const contribution = kind === 'contribution';
  const advance = kind === 'advance';
  const category = contribution ? null : (/tiền phòng|tiền trọ/i.test(description) ? 'Tiền phòng' : 'Sinh hoạt');
  await commit(db, updateId, [
    sql(db, 'INSERT INTO transactions(occurred_on,kind,amount_vnd,description,member,category,paid_by,status,created_by,source_update_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
      vnToday(), contribution ? 'contribution' : 'expense', value, description, contribution ? member : null, category, advance ? member : null, 'pending', userId, updateId),
    sql(db, "INSERT INTO audit(transaction_id,action,actor_id,after_json) SELECT id,'create',?,json_object('amount_vnd',amount_vnd,'occurred_on',occurred_on,'description',description,'member',member,'category',category,'paid_by',paid_by,'status',status) FROM transactions WHERE source_update_id=?", userId, updateId),
    sql(db, "INSERT INTO notification_outbox(recipient_member,event,reference_id) SELECT ?,'review_tx',id FROM transactions WHERE source_update_id=?", other(member), updateId)
  ]);
  const row = await first(db, 'SELECT * FROM transactions WHERE source_update_id=?', updateId);
  return { reply: 'Đã gửi ' + other(member) + ' duyệt. Quỹ chỉ thay đổi sau khi được duyệt.\n\n' + rowText(row), markup: transactionButtons(row, member, userId), committed: true };
}
async function applyEdit(db, updateId, userId, member, txId, field, value) {
  const before = await transaction(db, txId);
  const parsed = parseEdit(field, value, before);
  if (before.status === 'pending') {
    const column = { tien: 'amount_vnd', ngay: 'occurred_on', noi_dung: 'description', loai: 'category', nguoi: 'member', ung: 'paid_by' }[field];
    const after = { ...before, [column]: parsed };
    await commit(db, updateId, [sql(db, 'UPDATE transactions SET ' + column + '=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', parsed, txId), audit(db, txId, 'edit:' + field, userId, before, after)]);
    return { reply: 'Đã sửa khoản đang chờ duyệt:\n' + rowText(after), markup: transactionButtons(after, member, userId), committed: true };
  }
  if (await openReimbursement(db, txId) && ['tien','ung'].includes(field)) throw new UserError('Khoản này đang chờ xác nhận hoàn ứng; hãy xử lý khoản hoàn trước khi sửa số tiền hoặc người ứng.');
  if (await first(db, "SELECT id FROM change_requests WHERE transaction_id=? AND status='pending'", txId)) throw new UserError('Giao dịch đã có yêu cầu sửa hoặc hủy đang chờ duyệt.');
  await commit(db, updateId, [
    sql(db, "INSERT INTO change_requests(transaction_id,action,field,proposed_value,requested_by,status) VALUES(?,'edit',?,?,?,'pending')", txId, field, parsed === null ? null : String(parsed), userId),
    sql(db, "INSERT INTO notification_outbox(recipient_member,event,reference_id) SELECT ?,'review_change',id FROM change_requests WHERE transaction_id=? AND status='pending'", other(member), txId)
  ]);
  return { reply: 'Đã gửi ' + other(member) + ' duyệt thay đổi. Giao dịch hiện tại chưa đổi.', markup: back(), committed: true };
}
async function handle(db, env, event, updateId) {
  const member = await authorize(db, env, event.from);
  if (!member) return { reply: 'Bot chỉ dành cho @' + normalizedUsername(env.PHI_USERNAME) + ' và @' + normalizedUsername(env.AN_USERNAME) + '.' };
  if (event.chat?.type !== 'private') return { reply: null };
  const userId = event.from.id;
  const action = event.action || (event.text === '/start' || event.text === '☰ Menu' ? 'm' : null);
  const input = entryFromReply(event);
  if (input) {
    if (input.kind === 'edit') return applyEdit(db, updateId, userId, member, input.txId, input.field, input.value);
    return createTransaction(db, updateId, userId, member, input.kind, input.value);
  }
  if (event.text === '/start') return { reply: 'Chào ' + member + '! Bấm ☰ Menu để ghi quỹ phòng. Mọi giao dịch mới sẽ được người còn lại duyệt.', markup: MENU_BUTTON };
  if (action === 'm') return { reply: 'Bạn muốn làm gì?', markup: menu() };
  if (action === 'balance') {
    const data = await summary(db);
    return { reply: 'Quỹ còn: ' + money(data.balance) + '\nPhi đã góp: ' + money(data.byMember.Phi || 0) + '\nAn đã góp: ' + money(data.byMember.An || 0) + '\nTổng chi: ' + money(data.expense) + '\nCần hoàn ứng: ' + money(data.due), markup: back() };
  }
  if (['new:contribution','new:expense','new:advance'].includes(action)) {
    const prompts = {
      'new:contribution': 'Nhập khoản góp\nGửi số tiền và nội dung, ví dụ: 1000k góp quỹ.',
      'new:expense': 'Nhập khoản chi\nGửi số tiền và nội dung, ví dụ: 50k mua nước từ quỹ.',
      'new:advance': 'Nhập khoản ứng\nGửi số tiền và nội dung, ví dụ: 20k mua rau bằng tiền cá nhân.'
    };
    return { reply: prompts[action], markup: { force_reply: true, input_field_placeholder: 'Số tiền và nội dung' } };
  }
  if (action === 'pending') {
    const tx = await all(db, "SELECT * FROM transactions WHERE status='pending' AND deleted_at IS NULL AND (created_by IS NULL OR created_by<>?) ORDER BY id DESC LIMIT 10", userId);
    const changes = await all(db, "SELECT * FROM change_requests WHERE status='pending' AND requested_by<>? ORDER BY id DESC LIMIT 10", userId);
    const reimbursements = member === 'Phi' ? await all(db, "SELECT * FROM reimbursement_requests WHERE status='sent' ORDER BY id DESC LIMIT 10") : [];
    const rows = [
      ...tx.map(row => [button('#' + row.id + ' · ' + (row.kind === 'contribution' ? 'Góp' : 'Chi') + ' ' + money(row.amount_vnd), 'tx:' + row.id)]),
      ...changes.map(row => [button('Sửa/hủy #' + row.transaction_id, 'change:view:' + row.id)]),
      ...reimbursements.map(row => [button('Hoàn ứng #' + row.transaction_id + ' · ' + money(row.amount_vnd), 'reimbursement:view:' + row.id)]),
      [button('‹ Menu', 'm')]
    ];
    return { reply: rows.length === 1 ? 'Không có việc nào chờ bạn xác nhận.' : 'Các việc đang chờ bạn xác nhận:', markup: keyboard(rows) };
  }
  if (action === 'history') {
    const rows = await all(db, 'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 10');
    return { reply: rows.length ? 'Giao dịch gần đây:\n' + rows.map(rowText).join('\n\n') : 'Chưa có giao dịch.', markup: keyboard([...rows.map(row => [button('#' + row.id + ' · ' + money(row.amount_vnd), 'tx:' + row.id)]), [button('‹ Menu', 'm')]]) };
  }
  if (action === 'due') {
    const rows = await all(db, "SELECT * FROM transactions WHERE kind='expense' AND status='confirmed' AND paid_by IS NOT NULL AND reimbursed_vnd<amount_vnd AND deleted_at IS NULL ORDER BY id DESC LIMIT 20");
    return { reply: rows.length ? 'Các khoản cần hoàn:\n' + rows.map(row => '#' + row.id + ' · ' + row.paid_by + ' · còn ' + money(row.amount_vnd - row.reimbursed_vnd)).join('\n') : 'Không có khoản nào cần hoàn.', markup: keyboard([...rows.map(row => [button('#' + row.id + ' · ' + money(row.amount_vnd - row.reimbursed_vnd), 'tx:' + row.id)]), [button('‹ Menu', 'm')]]) };
  }
  if (action === 'report') {
    const month = vnToday().slice(0, 7);
    const rows = await all(db, "SELECT kind,category,amount_vnd FROM transactions WHERE status='confirmed' AND deleted_at IS NULL AND occurred_on LIKE ?", month + '-%');
    const income = rows.filter(row => row.kind === 'contribution').reduce((sum, row) => sum + row.amount_vnd, 0);
    const expense = rows.filter(row => row.kind === 'expense').reduce((sum, row) => sum + row.amount_vnd, 0);
    const rent = rows.filter(row => row.kind === 'expense' && row.category === 'Tiền phòng').reduce((sum, row) => sum + row.amount_vnd, 0);
    return { reply: 'Tháng ' + month + '\nGóp quỹ: ' + money(income) + '\nChi: ' + money(expense) + '\nTiền phòng: ' + money(rent) + '\nMỗi người chịu: ' + money(Math.floor(expense / 2)) + (expense % 2 ? ' (còn lẻ 1đ)' : ''), markup: back() };
  }
  if (action === 'export') return { reply: 'Đang gửi bản sao CSV.', csv: true, markup: back() };
  let match = /^tx:([1-9]\d*)$/.exec(action || '');
  if (match) {
    const row = await transaction(db, positiveId(match[1]));
    return { reply: rowText(row) + (row.paid_by ? '\nCần hoàn: ' + money(row.amount_vnd - row.reimbursed_vnd) : ''), markup: transactionButtons(row, member, userId) };
  }
  match = /^(approve|reject):([1-9]\d*)$/.exec(action || '');
  if (match) {
    const row = await transaction(db, positiveId(match[2]));
    if (row.status !== 'pending') throw new UserError('Khoản này đã được xử lý.');
    if (row.created_by === userId) throw new UserError('Người nhập không thể tự duyệt.');
    const approved = match[1] === 'approve';
    const after = { ...row, status: approved ? 'confirmed' : row.status, deleted_at: approved ? row.deleted_at : new Date().toISOString() };
    const creator = await first(db, 'SELECT member FROM users WHERE telegram_id=?', row.created_by);
    const statements = [
      approved
        ? sql(db, "UPDATE transactions SET status='confirmed',confirmed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'", userId, row.id)
        : sql(db, "UPDATE transactions SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'", row.id),
      audit(db, row.id, approved ? 'approve' : 'reject', userId, row, after)
    ];
    if (creator) statements.push(queue(db, creator.member, approved ? 'approved_tx' : 'rejected_tx', row.id));
    await commit(db, updateId, statements);
    return { reply: approved ? 'Đã duyệt. Quỹ đã được cập nhật.\n' + rowText(after) : 'Đã từ chối giao dịch #' + row.id + '.', markup: back(), committed: true };
  }
  match = /^edit:([1-9]\d*)$/.exec(action || '');
  if (match) {
    const row = await transaction(db, positiveId(match[1]));
    const fields = row.kind === 'contribution' ? ['tien','ngay','noi_dung','nguoi'] : ['tien','ngay','noi_dung','loai','ung'];
    return { reply: 'Chọn mục cần sửa của giao dịch #' + row.id + ':', markup: keyboard([...fields.map(field => [button(FIELDS[field], 'edit_field:' + row.id + ':' + field)]), [button('‹ Giao dịch', 'tx:' + row.id)]]) };
  }
  match = /^edit_field:([1-9]\d*):(tien|ngay|noi_dung|loai|nguoi|ung)$/.exec(action || '');
  if (match) {
    const row = await transaction(db, positiveId(match[1]));
    const field = match[2];
    if ((row.kind === 'contribution' && ['loai','ung'].includes(field)) || (row.kind === 'expense' && field === 'nguoi')) throw new UserError('Mục sửa không phù hợp với giao dịch.');
    const hints = { tien: '50k', ngay: '2026-09-29', noi_dung: 'Nội dung mới', loai: 'Tiền phòng', nguoi: 'Phi hoặc An', ung: 'Phi, An hoặc quy' };
    return { reply: 'Sửa #' + row.id + ' · ' + FIELDS[field] + '\nNhập giá trị mới, ví dụ: ' + hints[field] + '.', markup: { force_reply: true, input_field_placeholder: hints[field] } };
  }
  match = /^delete:([1-9]\d*)$/.exec(action || '');
  if (match) {
    const row = await transaction(db, positiveId(match[1]));
    return { reply: 'Bạn muốn hủy giao dịch này?\n' + rowText(row), markup: keyboard([[button('🗑 Xác nhận hủy', 'delete_yes:' + row.id)], [button('Giữ lại', 'tx:' + row.id)]]) };
  }
  match = /^delete_yes:([1-9]\d*)$/.exec(action || '');
  if (match) {
    const row = await transaction(db, positiveId(match[1]));
    if (row.status === 'pending') {
      await commit(db, updateId, [sql(db, 'UPDATE transactions SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?', row.id), audit(db, row.id, 'delete', userId, row, { ...row, deleted_at: new Date().toISOString() })]);
      return { reply: 'Đã hủy giao dịch #' + row.id + '.', markup: back(), committed: true };
    }
    if (await first(db, "SELECT id FROM change_requests WHERE transaction_id=? AND status='pending'", row.id)) throw new UserError('Giao dịch đã có yêu cầu sửa hoặc hủy đang chờ duyệt.');
    if (await openReimbursement(db, row.id)) throw new UserError('Khoản này đang chờ xác nhận hoàn ứng; hãy xử lý khoản hoàn trước khi hủy.');
    await commit(db, updateId, [
      sql(db, "INSERT INTO change_requests(transaction_id,action,requested_by,status) VALUES(?,'delete',?,'pending')", row.id, userId),
      sql(db, "INSERT INTO notification_outbox(recipient_member,event,reference_id) SELECT ?,'review_change',id FROM change_requests WHERE transaction_id=? AND status='pending'", other(member), row.id)
    ]);
    return { reply: 'Đã gửi ' + other(member) + ' duyệt yêu cầu hủy. Giao dịch hiện tại chưa đổi.', markup: back(), committed: true };
  }
  match = /^change:view:([1-9]\d*)$/.exec(action || '');
  if (match) {
    const change = await first(db, 'SELECT * FROM change_requests WHERE id=?', positiveId(match[1]));
    if (!change || change.status !== 'pending') throw new UserError('Yêu cầu này đã được xử lý.');
    if (change.requested_by === userId) throw new UserError('Bạn không thể tự duyệt yêu cầu của mình.');
    return { reply: change.action === 'delete' ? 'Yêu cầu hủy giao dịch #' + change.transaction_id : 'Yêu cầu sửa ' + FIELDS[change.field] + ' của giao dịch #' + change.transaction_id + ' thành: ' + (change.proposed_value ?? 'quy'), markup: keyboard([[button('✅ Duyệt', 'change:approve:' + change.id), button('❌ Từ chối', 'change:reject:' + change.id)]]) };
  }
  match = /^change:(approve|reject):([1-9]\d*)$/.exec(action || '');
  if (match) {
    const change = await first(db, 'SELECT * FROM change_requests WHERE id=?', positiveId(match[2]));
    if (!change || change.status !== 'pending') throw new UserError('Yêu cầu này đã được xử lý.');
    if (change.requested_by === userId) throw new UserError('Bạn không thể tự duyệt yêu cầu của mình.');
    const row = await transaction(db, change.transaction_id);
    const approved = match[1] === 'approve';
    const statements = [];
    if (approved) {
      if (await openReimbursement(db, row.id) && (change.action === 'delete' || ['tien','ung'].includes(change.field))) throw new UserError('Khoản này đang chờ xác nhận hoàn ứng; hãy xử lý khoản hoàn trước.');
      if (change.action === 'delete') {
        statements.push(sql(db, 'UPDATE transactions SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?', row.id));
        statements.push(audit(db, row.id, 'delete', userId, row, { ...row, deleted_at: new Date().toISOString() }));
      } else {
        const parsed = parseEdit(change.field, change.proposed_value === null ? 'quy' : change.proposed_value, row);
        const column = { tien: 'amount_vnd', ngay: 'occurred_on', noi_dung: 'description', loai: 'category', nguoi: 'member', ung: 'paid_by' }[change.field];
        statements.push(sql(db, 'UPDATE transactions SET ' + column + '=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', parsed, row.id));
        statements.push(audit(db, row.id, 'edit:' + change.field, userId, row, { ...row, [column]: parsed }));
      }
    }
    statements.push(sql(db, 'UPDATE change_requests SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status=?', approved ? 'approved' : 'rejected', userId, change.id, 'pending'));
    const requester = await first(db, 'SELECT member FROM users WHERE telegram_id=?', change.requested_by);
    if (requester) statements.push(queue(db, requester.member, approved ? 'approved_change' : 'rejected_change', change.id));
    await commit(db, updateId, statements);
    return { reply: approved ? 'Đã duyệt thay đổi cho giao dịch #' + row.id + '.' : 'Đã từ chối yêu cầu sửa/hủy #' + row.id + '.', markup: back(), committed: true };
  }
  match = /^send:([1-9]\d*)$/.exec(action || '');
  if (match) {
    if (member !== HOLDER) throw new UserError('Chỉ An, người giữ quỹ, đánh dấu đã chuyển tiền hoàn.');
    const row = await transaction(db, positiveId(match[1]));
    if (row.kind !== 'expense' || row.status !== 'confirmed' || !row.paid_by || row.reimbursed_vnd >= row.amount_vnd) throw new UserError('Khoản này không còn cần hoàn ứng.');
    if (await openReimbursement(db, row.id)) throw new UserError('Khoản hoàn này đang chờ Phi xác nhận.');
    if (await first(db, "SELECT id FROM change_requests WHERE transaction_id=? AND status='pending'", row.id)) throw new UserError('Giao dịch đang chờ duyệt sửa/hủy; hãy xử lý yêu cầu đó trước.');
    const remaining = row.amount_vnd - row.reimbursed_vnd;
    await commit(db, updateId, [
      sql(db, "INSERT INTO reimbursement_requests(transaction_id,amount_vnd,status,sent_by) VALUES(?,?,'sent',?)", row.id, remaining, userId),
      sql(db, "INSERT INTO notification_outbox(recipient_member,event,reference_id) SELECT 'Phi','receive_reimbursement',id FROM reimbursement_requests WHERE transaction_id=? AND status='sent'", row.id)
    ]);
    return { reply: 'Đã báo Phi xác nhận ' + money(remaining) + '. Khoản cần hoàn vẫn còn cho đến khi Phi bấm đã nhận.', markup: back(), committed: true };
  }
  match = /^reimbursement:view:([1-9]\d*)$/.exec(action || '');
  if (match) {
    const request = await first(db, 'SELECT * FROM reimbursement_requests WHERE id=?', positiveId(match[1]));
    if (!request || request.status !== 'sent') throw new UserError('Khoản này đã được xử lý.');
    if (member !== 'Phi') throw new UserError('Chỉ Phi có thể xác nhận khoản hoàn này.');
    return { reply: 'An đã đánh dấu chuyển ' + money(request.amount_vnd) + ' cho khoản #' + request.transaction_id + '. Bạn đã nhận chưa?', markup: keyboard([[button('✅ Đã nhận', 'receive:' + request.id), button('❌ Chưa nhận', 'not_received:' + request.id)]]) };
  }
  match = /^(receive|not_received):([1-9]\d*)$/.exec(action || '');
  if (match) {
    if (member !== 'Phi') throw new UserError('Chỉ Phi có thể xác nhận khoản hoàn này.');
    const request = await first(db, 'SELECT * FROM reimbursement_requests WHERE id=?', positiveId(match[2]));
    if (!request || request.status !== 'sent') throw new UserError('Khoản này đã được xử lý.');
    if (request.sent_by === userId) throw new UserError('Người chuyển không thể tự xác nhận.');
    const row = await transaction(db, request.transaction_id);
    const received = match[1] === 'receive';
    if (received && row.reimbursed_vnd + request.amount_vnd > row.amount_vnd) throw new UserError('Số tiền hoàn vượt quá khoản còn nợ.');
    const statements = [sql(db, "UPDATE reimbursement_requests SET status=?,received_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sent'", received ? 'received' : 'cancelled', userId, request.id)];
    if (received) {
      statements.push(sql(db, 'UPDATE transactions SET reimbursed_vnd=reimbursed_vnd+?,updated_at=CURRENT_TIMESTAMP WHERE id=?', request.amount_vnd, row.id));
      statements.push(audit(db, row.id, 'reimburse', userId, row, { ...row, reimbursed_vnd: row.reimbursed_vnd + request.amount_vnd }));
    }
    statements.push(queue(db, HOLDER, received ? 'received_reimbursement' : 'not_received_reimbursement', row.id));
    await commit(db, updateId, statements);
    return { reply: received ? 'Đã xác nhận nhận ' + money(request.amount_vnd) + '. Khoản cần hoàn đã được cập nhật.' : 'Đã báo An là bạn chưa nhận được tiền. Khoản cần hoàn vẫn giữ nguyên.', markup: back(), committed: true };
  }
  match = /^audit:([1-9]\d*)$/.exec(action || '');
  if (match) {
    const txId = positiveId(match[1]);
    const rows = await all(db, 'SELECT action,created_at FROM audit WHERE transaction_id=? ORDER BY id DESC LIMIT 10', txId);
    return { reply: rows.length ? 'Nhật ký #' + txId + ':\n' + rows.map(row => row.created_at + ' · ' + row.action).join('\n') : 'Chưa có nhật ký.', markup: keyboard([[button('‹ Giao dịch', 'tx:' + txId)]]) };
  }
  return { reply: 'Bấm ☰ Menu để dùng bot.', markup: MENU_BUTTON };
}
export { handle, entryFromReply };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/telegram') return new Response('Bot Quỹ Phòng');
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    if (!env.PHI_USERNAME || !env.AN_USERNAME) return new Response('Missing member configuration', { status: 503 });
    let update;
    try { update = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
    if (!Number.isSafeInteger(update.update_id)) return new Response('Bad request', { status: 400 });
    try {
      await flushOutbox(env);
      if (await first(env.DB, 'SELECT 1 FROM processed_updates WHERE update_id=?', update.update_id)) return new Response('OK');
      const callback = update.callback_query;
      if (!update.message && !callback) { await mark(env.DB, update.update_id); return new Response('OK'); }
      if (callback && (!callback.message?.chat || callback.message.chat.type !== 'private')) {
        await mark(env.DB, update.update_id);
        await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id });
        return new Response('OK');
      }
      const event = callback ? { chat: callback.message.chat, from: callback.from, action: callback.data } : update.message;
      let result;
      try { result = await handle(env.DB, env, event, update.update_id); }
      catch (error) {
        if (!(error instanceof UserError)) throw error;
        result = { reply: error.message, markup: back() };
      }
      if (!result.committed) await mark(env.DB, update.update_id);
      if (callback) await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id });
      if (result.reply) await send(env, event.chat.id, result.reply, result.markup);
      if (result.csv) await sendCsv(env, env.DB, event.chat.id);
      await flushOutbox(env);
      return new Response('OK');
    } catch (error) {
      console.error(error);
      return new Response('Internal error', { status: 500 });
    }
  }
};
