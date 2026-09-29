const MEMBERS = ['Phi', 'An'];
const HELP = `Sổ quỹ phòng Phi & An

/quy — số dư hiện tại
/thu [Phi|An] SỐ_TIỀN nội dung — ghi tiền góp, chờ xác nhận
/xacnhan ID — xác nhận đã nhận tiền
/chi SỐ_TIỀN nội dung — chi từ quỹ
/ung SỐ_TIỀN nội dung — ứng tiền cá nhân; khoản chi vẫn trừ quỹ
/hoan ID SỐ_TIỀN — đánh dấu đã hoàn ứng, không trừ lần hai
/conung — xem khoản cần hoàn
/sua ID tien|ngay|noi_dung|loai|nguoi|ung giá_trị
/xoa ID — hủy giao dịch, giữ nhật ký
/nhatky ID — lịch sử sửa giao dịch
/lichsu [số_dòng] — giao dịch gần đây
/baocao [YYYY-MM] — tổng hợp theo tháng
/xuat — tải CSV để sao lưu
/moi — lấy mã mời trong chat riêng
/thamgia MÃ — tham gia trong chat riêng
/nhom — chọn nhóm chung
/menu — mở các nút bấm

Số tiền: 50000, 50k, 1.000.000 hoặc 1,5tr.`;

export function money(n) { return `${Number(n).toLocaleString('vi-VN')}đ`; }
export function amount(raw) {
  let s = raw.trim().toLowerCase().replace(/\s/g, '');
  let multiplier = 1;
  if (s.endsWith('tr')) { multiplier = 1000000; s = s.slice(0, -2); }
  else if (s.endsWith('k')) { multiplier = 1000; s = s.slice(0, -1); }
  if (multiplier === 1) {
    if (!/^\d{1,3}([.,]\d{3})+$/.test(s) && !/^\d+$/.test(s)) throw Error('Số tiền không hợp lệ. Ví dụ: 50000, 50k, 1.000.000.');
    s = s.replace(/[.,]/g, '');
  } else s = s.replace(',', '.');
  const n = Number(s) * multiplier;
  if (!Number.isSafeInteger(n) || n <= 0 || n > 10000000000) throw Error('Số tiền phải là số đồng nguyên, lớn hơn 0 và không quá 10 tỷ.');
  return n;
}
function vnToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function id(raw) { if (!/^\d+$/.test(raw || '') || Number(raw) < 1) throw Error('ID giao dịch phải là số dương.'); return Number(raw); }
function sql(db, query, ...args) { return db.prepare(query).bind(...args); }
async function first(db, query, ...args) { return sql(db, query, ...args).first(); }
async function all(db, query, ...args) { return (await sql(db, query, ...args).all()).results; }
function rowText(r) {
  let kind = r.kind === 'contribution' ? `Thu ${r.member}` : 'Chi';
  if (r.paid_by) kind += ` (${r.paid_by} ứng)`;
  if (r.status === 'pending') kind += ' [chờ xác nhận]';
  return `#${r.id} · ${r.occurred_on || 'chưa rõ ngày'} · ${kind} ${money(r.amount_vnd)} · ${r.description}`;
}
const button = (label, data) => ({ text: label, callback_data: data });
const keyboard = rows => ({ inline_keyboard: rows });
const menu = () => keyboard([
  [button('💰 Xem quỹ', 'q'), button('📋 Giao dịch', 'l')],
  [button('➕ Ghi thu', 'new:thu'), button('➖ Ghi chi', 'new:chi')],
  [button('💳 Ứng tiền', 'new:ung'), button('🔄 Cần hoàn', 'u')],
  [button('📊 Báo cáo tháng', 'b')]
]);
const back = () => keyboard([[button('‹ Menu', 'm')]]);
function transactionButtons(r) {
  const rows = [];
  if (r.status === 'pending') rows.push([button('✅ Xác nhận đã nhận tiền', `confirm:${r.id}`)]);
  if (r.paid_by && r.reimbursed_vnd < r.amount_vnd) rows.push([button('↩️ Ghi hoàn ứng', `reimburse:${r.id}`)]);
  rows.push([button('✏️ Sửa', `edit:${r.id}`), button('🗑 Hủy', `delete:${r.id}`)]);
  rows.push([button('‹ Giao dịch', 'l'), button('☰ Menu', 'm')]);
  return keyboard(rows);
}
const EDIT_FIELDS = { tien: 'Số tiền', ngay: 'Ngày', noi_dung: 'Nội dung', loai: 'Loại chi', nguoi: 'Người góp', ung: 'Người ứng' };
export function promptAction(msg) {
  const prompt = msg.reply_to_message;
  if (!prompt?.from?.is_bot || !msg.text || msg.text.startsWith('/')) return null;
  const t = prompt.text || '';
  let m = /^Ghi thu cho (Phi|An)\n/.exec(t);
  if (m) return `/thu ${m[1]} ${msg.text}`;
  if (t.startsWith('Ghi chi từ quỹ\n')) return `/chi ${msg.text}`;
  if (t.startsWith('Ứng tiền cá nhân\n')) return `/ung ${msg.text}`;
  m = /^Hoàn ứng #(\d+)\n/.exec(t);
  if (m) return `/hoan ${m[1]} ${msg.text}`;
  m = /^Sửa #(\d+) · (Số tiền|Ngày|Nội dung|Loại chi|Người góp|Người ứng)\n/.exec(t);
  if (m) return `/sua ${m[1]} ${Object.keys(EDIT_FIELDS).find(k => EDIT_FIELDS[k] === m[2])} ${msg.text}`;
  return null;
}
export function callbackCommand(data) {
  const fixed = { m: '/menu', q: '/quy', l: '/lichsu', u: '/conung', b: '/baocao', 'new:thu': '/chonnguoi', 'new:chi': '/nhap chi', 'new:ung': '/nhap ung' };
  if (fixed[data]) return fixed[data];
  const newIncome = /^new:thu:(Phi|An)$/.exec(data || '');
  if (newIncome) return `/nhapthu ${newIncome[1]}`;
  const match = /^(tx|confirm|reimburse|edit|delete|delete_yes|ask):([1-9]\d*)(?::(tien|ngay|noi_dung|loai|nguoi|ung))?$/.exec(data || '');
  if (!match) return '/menu';
  const [, action, txId, field] = match;
  if (action === 'ask' && field) return `/nhapsua ${txId} ${field}`;
  return ({ tx: '/giaodich', confirm: '/xacnhan', reimburse: '/nhaphoan', edit: '/chonsua', delete: '/chonxoa', delete_yes: '/xoa' })[action] + ` ${txId}`;
}
async function telegram(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body), headers: body instanceof FormData ? {} : { 'content-type': 'application/json' } });
  const json = await r.json();
  if (!json.ok) throw Error(`Telegram ${method}: ${json.description || r.status}`);
  return json.result;
}
async function send(env, chatId, text, markup) { return telegram(env, 'sendMessage', { chat_id: chatId, text: text.slice(0, 4000), ...(markup ? { reply_markup: markup } : {}) }); }
function audit(db, txId, action, actor, before, after) { return sql(db, 'INSERT INTO audit(transaction_id,action,actor_id,before_json,after_json) VALUES(?,?,?,?,?)', txId, action, actor, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null); }
async function commit(db, updateId, statements) {
  await db.batch([sql(db, 'INSERT INTO processed_updates(update_id) VALUES(?)', updateId), ...statements]);
}
async function mark(db, updateId) { await sql(db, 'INSERT OR IGNORE INTO processed_updates(update_id) VALUES(?)', updateId).run(); }
async function transaction(db, txId) {
  const r = await first(db, 'SELECT * FROM transactions WHERE id=? AND deleted_at IS NULL', txId);
  if (!r) throw Error('Không tìm thấy giao dịch này.');
  return r;
}
async function summary(db) {
  const s = await first(db, `SELECT COALESCE(SUM(CASE WHEN kind='contribution' THEN amount_vnd ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN kind='expense' THEN amount_vnd ELSE 0 END),0) expense, COALESCE(SUM(CASE WHEN kind='expense' AND paid_by IS NOT NULL THEN amount_vnd-reimbursed_vnd ELSE 0 END),0) due FROM transactions WHERE status='confirmed' AND deleted_at IS NULL`);
  const members = await all(db, `SELECT member,SUM(amount_vnd) total FROM transactions WHERE kind='contribution' AND status='confirmed' AND deleted_at IS NULL GROUP BY member`);
  return { ...s, balance: s.income - s.expense, byMember: Object.fromEntries(members.map(r => [r.member, r.total])) };
}
function csvCell(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }
async function sendCsv(env, db, chatId) {
  const rows = await all(db, 'SELECT * FROM transactions ORDER BY id');
  const cols = ['id','occurred_on','kind','amount_vnd','member','description','category','paid_by','reimbursed_vnd','status','note','deleted_at','source_sheet','source_row'];
  const headers = ['ID','Ngày','Loại','Số tiền VND','Thành viên góp','Nội dung','Nhóm chi','Người ứng','Đã hoàn VND','Trạng thái','Ghi chú','Đã hủy','Nguồn','Dòng nguồn'];
  const body = '\ufeff' + [headers.join(','), ...rows.map(r => cols.map(k => csvCell(k === 'kind' ? (r.kind === 'contribution' ? 'Thu' : 'Chi') : r[k])).join(','))].join('\r\n');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([body], { type: 'text/csv;charset=utf-8' }), 'quy_phong.csv');
  await telegram(env, 'sendDocument', form);
}
function date(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0,10) !== raw) throw Error('Ngày cần theo dạng YYYY-MM-DD.');
  return raw;
}
export async function handle(db, msg, updateId) {
  const text = (msg.text === '☰ Menu' ? '/menu' : promptAction(msg) || msg.text || '').trim();
  if (!text.startsWith('/')) return { reply: null };
  const [raw, ...words] = text.split(/\s+/);
  const cmd = raw.split('@')[0].toLowerCase();
  const chatId = msg.chat.id, userId = msg.from?.id;
  if (!userId) return { reply: null };
  const privateChat = msg.chat.type === 'private';
  let member = (await first(db, 'SELECT member FROM users WHERE telegram_id=?', userId))?.member;
  if (cmd === '/start') {
    if (!privateChat) return { reply: 'Hãy nhắn riêng bot để đăng ký, sau đó dùng /nhom tại nhóm chung.' };
    if (member) return { reply: `Chào ${member}!\n\nBấm nút Menu để dùng bot, hoặc gõ /help để xem các lệnh.`, markup: { keyboard: [[{ text: '☰ Menu' }]], resize_keyboard: true, is_persistent: true } };
    const count = await first(db, 'SELECT COUNT(*) n FROM users');
    if (count.n) throw Error('Bot chỉ dành cho hai thành viên của phòng. Hãy xin mã mời từ người đã tham gia.');
    await commit(db, updateId, [sql(db, "INSERT INTO users(telegram_id,member) VALUES(?,'Phi')", userId)]);
    return { reply: `Đã đăng ký bạn là Phi. Quỹ hiện có ${money((await summary(db)).balance)}.\n\nBấm nút Menu để dùng bot, hoặc gõ /help để xem các lệnh.`, markup: { keyboard: [[{ text: '☰ Menu' }]], resize_keyboard: true, is_persistent: true }, committed: true };
  }
  if (cmd === '/thamgia') {
    if (!privateChat) return { reply: 'Hãy gửi mã mời trong chat riêng với bot.' };
    if (words.length !== 1) return { reply: 'Cách dùng: /thamgia MÃ' };
    if (member) return { reply: `Bạn đã đăng ký là ${member}.` };
    const count = await first(db, 'SELECT COUNT(*) n FROM users');
    const invite = await first(db, "SELECT value FROM settings WHERE key='invite_code'");
    if (count.n !== 1 || !invite || invite.value !== words[0].toUpperCase()) throw Error('Mã mời không đúng hoặc phòng chưa sẵn sàng.');
    await commit(db, updateId, [sql(db, "INSERT INTO users(telegram_id,member) VALUES(?,'An')", userId), sql(db, "DELETE FROM settings WHERE key='invite_code'")]);
    return { reply: 'Đã đăng ký bạn là An. Bấm nút Menu để dùng bot.', markup: { keyboard: [[{ text: '☰ Menu' }]], resize_keyboard: true, is_persistent: true }, committed: true };
  }
  if (!member) return { reply: privateChat ? 'Bot chỉ dành cho Phi và An. Hãy nhắn riêng /start hoặc /thamgia MÃ.' : null };
  if (!privateChat) {
    const bound = await first(db, "SELECT value FROM settings WHERE key='group_chat_id'");
    if (cmd === '/nhom' && !bound) {
      await commit(db, updateId, [sql(db, "INSERT INTO settings(key,value) VALUES('group_chat_id',?)", String(chatId))]);
      return { reply: 'Đã chọn nhóm này để cùng ghi quỹ phòng.', committed: true };
    }
    if (bound?.value !== String(chatId)) return { reply: null };
  } else if (cmd === '/nhom') return { reply: 'Hãy gõ /nhom trong nhóm Telegram có hai bạn và bot.' };
  if (['/help','/trogiup'].includes(cmd)) return { reply: HELP };
  if (cmd === '/menu') return { reply: 'Bạn muốn làm gì với quỹ phòng?', markup: menu() };
  if (cmd === '/chonnguoi') return { reply: 'Khoản thu này do ai góp?', markup: keyboard([[button('Phi', 'new:thu:Phi'), button('An', 'new:thu:An')], [button('‹ Menu', 'm')]]) };
  if (cmd === '/nhap') {
    const kind = words[0];
    if (!['chi', 'ung'].includes(kind)) throw Error('Cách dùng: /nhap chi|ung');
    return { reply: kind === 'chi' ? 'Ghi chi từ quỹ\nNhập số tiền và nội dung, ví dụ: 50k mua nước.' : 'Ứng tiền cá nhân\nNhập số tiền và nội dung, ví dụ: 50k mua nước.', markup: { force_reply: true, input_field_placeholder: '50k mua nước' } };
  }
  if (cmd === '/nhapthu') {
    if (!MEMBERS.includes(words[0])) throw Error('Người góp chỉ có thể là Phi hoặc An.');
    return { reply: `Ghi thu cho ${words[0]}\nNhập số tiền và nội dung, ví dụ: 500k góp quỹ.`, markup: { force_reply: true, input_field_placeholder: '500k góp quỹ' } };
  }
  if (cmd === '/giaodich' || cmd === '/chonsua' || cmd === '/chonxoa' || cmd === '/nhaphoan' || cmd === '/nhapsua') {
    const r = await transaction(db, id(words[0]));
    if (cmd === '/giaodich') return { reply: rowText(r), markup: transactionButtons(r) };
    if (cmd === '/chonsua') {
      const fields = r.kind === 'contribution' ? ['tien','ngay','noi_dung','nguoi'] : ['tien','ngay','noi_dung','loai','ung'];
      return { reply: `Bạn muốn sửa gì ở giao dịch #${r.id}?\n${rowText(r)}`, markup: keyboard([...fields.map(f => [button(EDIT_FIELDS[f], `ask:${r.id}:${f}`)]), [button('‹ Giao dịch', `tx:${r.id}`)]]) };
    }
    if (cmd === '/chonxoa') return { reply: `Hủy giao dịch #${r.id}?\n${rowText(r)}`, markup: keyboard([[button('🗑 Xác nhận hủy', `delete_yes:${r.id}`)], [button('Giữ giao dịch', `tx:${r.id}`)]]) };
    if (cmd === '/nhaphoan') {
      if (r.kind !== 'expense' || !r.paid_by || r.reimbursed_vnd >= r.amount_vnd) throw Error('Giao dịch này không có khoản ứng cần hoàn.');
      return { reply: `Hoàn ứng #${r.id}\nCòn cần hoàn ${money(r.amount_vnd - r.reimbursed_vnd)} cho ${r.paid_by}. Nhập số tiền đã hoàn, ví dụ: 50k.`, markup: { force_reply: true, input_field_placeholder: 'Số tiền đã hoàn' } };
    }
    const field = words[1];
    if (!EDIT_FIELDS[field] || (r.kind === 'contribution' && ['loai','ung'].includes(field)) || (r.kind === 'expense' && field === 'nguoi')) throw Error('Có thể sửa: tien, ngay, noi_dung, loai, nguoi, ung.');
    const hints = { tien: '50k', ngay: '2026-09-29', noi_dung: 'Nội dung mới', loai: 'Tiền phòng hoặc Sinh hoạt', nguoi: 'Phi hoặc An', ung: 'Phi, An hoặc quy' };
    return { reply: `Sửa #${r.id} · ${EDIT_FIELDS[field]}\nNhập giá trị mới, ví dụ: ${hints[field]}.`, markup: { force_reply: true, input_field_placeholder: hints[field] } };
  }
  if (cmd === '/moi') {
    if (!privateChat) return { reply: 'Hãy nhắn riêng bot để lấy mã mời.' };
    if ((await first(db, 'SELECT COUNT(*) n FROM users')).n >= 2) throw Error('Hai thành viên đã tham gia đủ.');
    let code = (await first(db, "SELECT value FROM settings WHERE key='invite_code'"))?.value;
    let created = false;
    if (!code) {
      code = [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
      await commit(db, updateId, [sql(db, "INSERT INTO settings(key,value) VALUES('invite_code',?)", code)]);
      created = true;
    }
    return { reply: `Mã mời cho người còn lại: ${code}\nNgười ấy nhắn riêng bot: /thamgia ${code}`, committed: created };
  }
  if (cmd === '/quy') {
    const s = await summary(db);
    return { reply: `Quỹ còn: ${money(s.balance)}\nĐã góp: ${MEMBERS.map(m => `${m} ${money(s.byMember[m] || 0)}`).join(', ')}\nTổng chi: ${money(s.expense)}\nChưa hoàn ứng: ${money(s.due)}`, markup: back() };
  }
  if (['/thu','/chi','/ung'].includes(cmd)) {
    let payer = member;
    if (cmd === '/thu' && MEMBERS.includes(words[0])) payer = words.shift();
    if (words.length < 2) throw Error(`Cách dùng: ${cmd} ${cmd === '/thu' ? '[Phi|An] ' : ''}SỐ_TIỀN nội dung`);
    const value = amount(words.shift()), description = words.join(' ').trim();
    if (!description) throw Error('Hãy thêm nội dung giao dịch.');
    const kind = cmd === '/thu' ? 'contribution' : 'expense';
    const paidBy = cmd === '/ung' ? member : null;
    const category = kind === 'expense' ? (/tiền phòng|tiền trọ/i.test(description) ? 'Tiền phòng' : 'Sinh hoạt') : null;
    await commit(db, updateId, [sql(db, `INSERT INTO transactions(occurred_on,kind,amount_vnd,description,member,category,paid_by,status,created_by,source_update_id) VALUES(?,?,?,?,?,?,?,?,?,?)`, vnToday(), kind, value, description, kind === 'contribution' ? payer : null, category, paidBy, kind === 'contribution' ? 'pending' : 'confirmed', userId, updateId), sql(db, `INSERT INTO audit(transaction_id,action,actor_id,after_json) SELECT id,'create',?,json_object('amount_vnd',amount_vnd,'occurred_on',occurred_on,'description',description,'member',member,'category',category,'paid_by',paid_by,'reimbursed_vnd',reimbursed_vnd,'status',status,'deleted_at',deleted_at) FROM transactions WHERE source_update_id=?`, userId, updateId)]);
    const r = await first(db, 'SELECT * FROM transactions WHERE source_update_id=?', updateId);
    return { reply: rowText(r) + (kind === 'contribution' ? `\nChờ xác nhận khi đã nhận tiền.` : `\nĐã trừ toàn bộ khoản chi vào quỹ.${paidBy ? `\nQuỹ cần hoàn cho ${paidBy}: ${money(value)}` : ''}`), markup: transactionButtons(r), committed: true };
  }
  if (cmd === '/xacnhan') {
    if (words.length !== 1) throw Error('Cách dùng: /xacnhan ID');
    const before = await transaction(db, id(words[0]));
    if (before.status === 'confirmed') throw Error('Giao dịch đã được xác nhận.');
    const after = { ...before, status: 'confirmed', confirmed_by: userId };
    await commit(db, updateId, [sql(db, "UPDATE transactions SET status='confirmed',confirmed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'", userId, before.id), audit(db, before.id, 'confirm', userId, before, after)]);
    return { reply: `Đã xác nhận: ${rowText(after)}`, markup: transactionButtons(after), committed: true };
  }
  if (cmd === '/hoan') {
    if (words.length !== 2) throw Error('Cách dùng: /hoan ID SỐ_TIỀN');
    const before = await transaction(db, id(words[0])), value = amount(words[1]);
    if (before.kind !== 'expense' || !before.paid_by || before.status !== 'confirmed') throw Error('Giao dịch này không có khoản ứng cần hoàn.');
    const remaining = before.amount_vnd - before.reimbursed_vnd;
    if (value > remaining) throw Error(`Số tiền hoàn không quá ${money(remaining)}.`);
    const after = { ...before, reimbursed_vnd: before.reimbursed_vnd + value };
    await commit(db, updateId, [sql(db, 'UPDATE transactions SET reimbursed_vnd=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND reimbursed_vnd=?', after.reimbursed_vnd, before.id, before.reimbursed_vnd), audit(db, before.id, 'reimburse', userId, before, after)]);
    return { reply: `Đã ghi hoàn ứng cho ${before.paid_by}. Còn cần hoàn: ${money(before.amount_vnd - after.reimbursed_vnd)}. Số dư quỹ không đổi vì khoản chi đã được trừ khi ghi.`, markup: transactionButtons(after), committed: true };
  }
  if (cmd === '/conung') {
    const rows = await all(db, `SELECT * FROM transactions WHERE kind='expense' AND status='confirmed' AND paid_by IS NOT NULL AND reimbursed_vnd<amount_vnd AND deleted_at IS NULL ORDER BY id DESC LIMIT 20`);
    return { reply: rows.length ? `Khoản cần hoàn:\n${rows.map(r => `${rowText(r)} · còn ${money(r.amount_vnd-r.reimbursed_vnd)}`).join('\n')}` : 'Không có khoản ứng nào đang chờ hoàn.', markup: keyboard([...rows.slice(0, 10).map(r => [button(`#${r.id} · hoàn ${money(r.amount_vnd-r.reimbursed_vnd)}`, `tx:${r.id}`)]), [button('‹ Menu', 'm')]]) };
  }
  if (cmd === '/sua') {
    if (words.length < 3) throw Error('Cách dùng: /sua ID tien|ngay|noi_dung|loai|nguoi|ung giá_trị');
    const before = await transaction(db, id(words.shift())), field = words.shift(), value = words.join(' ').trim();
    const columns = { tien: 'amount_vnd', ngay: 'occurred_on', noi_dung: 'description', loai: 'category', nguoi: 'member', ung: 'paid_by' };
    const column = columns[field];
    if (!column) throw Error('Có thể sửa: tien, ngay, noi_dung, loai, nguoi, ung.');
    let parsed;
    if (field === 'tien') { parsed = amount(value); if (parsed < before.reimbursed_vnd) throw Error('Số tiền mới nhỏ hơn khoản đã hoàn ứng.'); }
    else if (field === 'ngay') parsed = date(value);
    else if (field === 'noi_dung') { if (!value) throw Error('Nội dung không được để trống.'); parsed = value; }
    else if (field === 'loai') { if (before.kind !== 'expense' || !value) throw Error('Chỉ khoản chi mới có loại chi và không được để trống.'); parsed = value; }
    else if (field === 'nguoi') { if (before.kind !== 'contribution' || !MEMBERS.includes(value)) throw Error('Người góp chỉ có thể là Phi hoặc An.'); parsed = value; }
    else { if (before.kind !== 'expense') throw Error('Chỉ khoản chi mới có người ứng.'); parsed = value.toLowerCase() === 'quy' ? null : value; if (parsed !== null && !MEMBERS.includes(parsed)) throw Error("Người ứng chỉ có thể là Phi hoặc An; dùng 'quy' nếu chi từ quỹ."); if (parsed === null && before.reimbursed_vnd) throw Error('Khoản đã hoàn ứng, không thể đổi sang chi từ quỹ.'); }
    const after = { ...before, [column]: parsed };
    await commit(db, updateId, [sql(db, `UPDATE transactions SET ${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, parsed, before.id), audit(db, before.id, `edit:${field}`, userId, before, after)]);
    return { reply: `Đã sửa: ${rowText(after)}`, markup: transactionButtons(after), committed: true };
  }
  if (cmd === '/xoa') {
    if (words.length !== 1) throw Error('Cách dùng: /xoa ID');
    const before = await transaction(db, id(words[0])), after = { ...before, deleted_at: new Date().toISOString() };
    await commit(db, updateId, [sql(db, 'UPDATE transactions SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?', before.id), audit(db, before.id, 'delete', userId, before, after)]);
    return { reply: `Đã hủy giao dịch #${before.id}. Nhật ký sửa vẫn được giữ.`, markup: back(), committed: true };
  }
  if (cmd === '/nhatky') {
    if (words.length !== 1) throw Error('Cách dùng: /nhatky ID');
    const entries = await all(db, 'SELECT * FROM audit WHERE transaction_id=? ORDER BY id DESC LIMIT 10', id(words[0]));
    const keys = ['amount_vnd','occurred_on','description','member','category','paid_by','reimbursed_vnd','status','deleted_at'];
    return { reply: entries.length ? `Nhật ký #${words[0]}:\n${entries.map(e => { const b = JSON.parse(e.before_json || '{}'), a = JSON.parse(e.after_json || '{}'); const changes = keys.filter(k => b[k] !== a[k]).map(k => `${k}: ${b[k] ?? ''} → ${a[k] ?? ''}`).join(', '); return `${e.created_at} · ${e.action} · ${changes || 'đã tạo'}`; }).join('\n')}` : 'Chưa có lịch sử sửa cho giao dịch này.' };
  }
  if (cmd === '/lichsu') {
    const limit = words.length ? Math.min(id(words[0]), 30) : 10;
    const rows = await all(db, 'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ?', limit);
    return { reply: `Giao dịch gần đây:\n${rows.map(rowText).join('\n')}`, markup: keyboard([...rows.map(r => [button(`#${r.id} · ${r.kind === 'contribution' ? 'Thu' : 'Chi'} ${money(r.amount_vnd)}`, `tx:${r.id}`)]), [button('‹ Menu', 'm')]]) };
  }
  if (cmd === '/baocao') {
    const month = words[0] || vnToday().slice(0,7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Tháng cần theo dạng YYYY-MM, ví dụ 2026-09.');
    const rows = await all(db, `SELECT kind,category,amount_vnd FROM transactions WHERE status='confirmed' AND deleted_at IS NULL AND occurred_on LIKE ?`, `${month}-%`);
    const income = rows.filter(r => r.kind === 'contribution').reduce((a,r) => a+r.amount_vnd,0);
    const expense = rows.filter(r => r.kind === 'expense').reduce((a,r) => a+r.amount_vnd,0);
    const rent = rows.filter(r => r.kind === 'expense' && r.category === 'Tiền phòng').reduce((a,r) => a+r.amount_vnd,0);
    return { reply: `Tháng ${month}\nThu quỹ: ${money(income)}\nChi: ${money(expense)}\nTrong đó tiền phòng: ${money(rent)}\nMỗi người chịu: ${money(Math.floor(expense/2))}${expense % 2 ? ' (lẻ 1đ, cần đối chiếu khi chia)' : ''}`, markup: back() };
  }
  if (cmd === '/xuat') return { reply: 'Đang gửi bản sao giao dịch CSV.', csv: true };
  if (cmd === '/nhom') return { reply: 'Nhóm này đã được chọn cho quỹ phòng.' };
  return { reply: 'Lệnh chưa có. Gõ /help để xem các lệnh.' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/telegram') return new Response('Bot Quỹ Phòng', { status: 200 });
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    let update;
    try { update = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
    if (!Number.isSafeInteger(update.update_id)) return new Response('Bad request', { status: 400 });
    if (await first(env.DB, 'SELECT 1 FROM processed_updates WHERE update_id=?', update.update_id)) return new Response('OK');
    const callback = update.callback_query;
    if (!update.message && !callback) { await mark(env.DB, update.update_id); return new Response('OK'); }
    if (callback && !callback.message?.chat) { await mark(env.DB, update.update_id); await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Nút này không còn dùng được.' }); return new Response('OK'); }
    const msg = callback ? { chat: callback.message.chat, from: callback.from, text: callbackCommand(callback.data) } : update.message;
    let result;
    try { result = await handle(env.DB, msg, update.update_id); }
    catch (err) {
      if (!(err instanceof Error) || !/^(Cách dùng|Không tìm thấy|Đã|Giao dịch|Số tiền|Ngày cần|Tháng cần|Người|Chỉ|Nội dung|Loại chi|Khoản|Mã mời|Bot chỉ|Hai thành viên|Có thể sửa|Hãy)/.test(err.message)) { console.error(err); return new Response('Internal error', { status: 500 }); }
      result = { reply: err.message };
    }
    if (!result.committed) await mark(env.DB, update.update_id);
    if (callback) await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id });
    if (result.reply) await send(env, msg.chat.id, result.reply, result.markup);
    if (result.csv) await sendCsv(env, env.DB, msg.chat.id);
    return new Response('OK');
  }
};
