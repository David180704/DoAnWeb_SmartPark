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

module.exports = { BANK_INFO, buildQrUrl, buildMemoContent };
