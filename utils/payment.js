const BANK_INFO = {
    bankName: 'Vietcombank (VCB)',
    accountNumber: '1018827182738',
    accountHolder: 'CONG TY CO PHAN DO XE THONG MINH SMARTPARK VIETNAM',
    binCode: '970436'
};

function buildQrUrl(ticketCode, amount) {
    const memoContent = `PARK${String(ticketCode).slice(-6).toUpperCase()}`;
    return `https://api.vietqr.io/image/${BANK_INFO.binCode}-${BANK_INFO.accountNumber}-compact.jpg?accountName=${encodeURIComponent(BANK_INFO.accountHolder)}&amount=${amount}&addInfo=${encodeURIComponent(memoContent)}`;
}

function buildMemoContent(ticketCode) {
    return `PARK${String(ticketCode).slice(-6).toUpperCase()}`;
}

// Banks often prepend/append extra text to the transfer content the
// customer's app sends (branch codes, "chuyen tien", accents stripped,
// etc), so search for the PARK<6 chars> tag anywhere in the string
// rather than requiring an exact match.
function extractMemoSuffix(content) {
    const match = /PARK([A-Z0-9]{6})/i.exec(String(content || '').toUpperCase());
    return match ? match[1] : null;
}

module.exports = { BANK_INFO, buildQrUrl, buildMemoContent, extractMemoSuffix };
