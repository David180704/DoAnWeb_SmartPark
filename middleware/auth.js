const { verifyUserToken } = require('../utils/jwt');

const STAFF_ROLES = ['STAFF', 'ADMIN'];

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
        req.userRole = payload.role;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
    }
}

function requireStaff(req, res, next) {
    requireAuth(req, res, () => {
        if (!STAFF_ROLES.includes(req.userRole)) {
            return res.status(403).json({ message: 'Chỉ nhân viên mới có thể thực hiện thao tác này.' });
        }
        next();
    });
}

function optionalAuth(req, res, next) {
    const token = getTokenFromHeader(req);
    if (token) {
        try {
            const payload = verifyUserToken(token);
            req.userId = payload.sub;
            req.userRole = payload.role;
        } catch (err) {
            // ignore invalid token, treat as anonymous
        }
    }
    next();
}

module.exports = { requireAuth, requireStaff, optionalAuth };
