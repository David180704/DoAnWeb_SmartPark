const { verifyUserToken } = require('../utils/jwt');

function getTokenFromHeader(req) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme === 'Bearer' && token) return token;
    return null;
}

function requireAuth(req, res, next) {
    const token = getTokenFromHeader(req);
    if (!token) {
        return res.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục.' });
    }
    try {
        const payload = verifyUserToken(token);
        req.userId = payload.sub;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
    }
}

function optionalAuth(req, res, next) {
    const token = getTokenFromHeader(req);
    if (token) {
        try {
            const payload = verifyUserToken(token);
            req.userId = payload.sub;
        } catch (err) {
            // ignore invalid token, treat as anonymous
        }
    }
    next();
}

module.exports = { requireAuth, optionalAuth };
