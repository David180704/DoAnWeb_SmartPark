const BANK_INFO = {
    bankName: 'Sacombank',
    accountNumber: '0966440486',
    accountHolder: 'DO KIM THANH',
    binCode: '970403' // Sacombank's VietQR/Napas BIN — double-check against the real QR SePay generates
};

function buildQrUrl(ticketCode, amount) {
    const memoContent = `PARK${String(ticketCode).slice(-6).toUpperCase()}`;
    return `https://api.vietqr.io/image/${BANK_INFO.binCode}-${BANK_INFO.accountNumber}-compact.jpg?accountName=${encodeURIComponent(BANK_INFO.accountHolder)}&amount=${amount}&addInfo=${encodeURIComponent(memoContent)}`;
}

function buildMemoContent(ticketCode) {
    return `PARK${String(ticketCode).slice(-6).toUpperCase()}`;
}

// Banks/e-wallets often prepend/append extra text to the transfer content
// (branch codes, "chuyen tien", accents stripped, etc), and some routes
// (seen via MoMo -> bank) even insert a stray space in the middle of the
// memo itself (e.g. "PARKVFUYJ Y" instead of "PARKVFUYJY"). Strip all
// whitespace first, then search for the PARK<6 chars> tag anywhere in
// the remaining string rather than requiring an exact/contiguous match.
function extractMemoSuffix(content) {
    const normalized = String(content || '').toUpperCase().replace(/\s+/g, '');
    const match = /PARK([A-Z0-9]{6})/i.exec(normalized);
    return match ? match[1] : null;
}

module.exports = { BANK_INFO, buildQrUrl, buildMemoContent, extractMemoSuffix };
