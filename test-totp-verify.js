const { totp } = require('otplib');

const secret = totp.generateSecret();
const token = '123456';

const result = totp.verify({ token, secret, window: 1 });
console.log('totp.verify result:', result);
console.log('Type of totp.verify result:', typeof result);
