const otplib = require('otplib');

console.log('otplib.verify === otplib.totp.verify ?', otplib.verify === otplib.totp.verify);
console.log('otplib.verify === otplib.hotp.verify ?', otplib.verify === otplib.hotp.verify);
