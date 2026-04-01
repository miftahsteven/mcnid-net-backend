const { totp } = require('otplib');

const secret = 'QPMB4LENSZIACOEO5MM4WQTRJX4W5MI6';
const token = totp.generate(secret);
console.log('Current TOTP for secret:', token);
console.log('Server UTC time:', new Date().toISOString());
