const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const TOKEN_TTL = '7d';

function signUserToken(user) {
    const id = user.id || user._id;
    return jwt.sign({ sub: String(id), phone: user.phone, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyUserToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

module.exports = { signUserToken, verifyUserToken };
