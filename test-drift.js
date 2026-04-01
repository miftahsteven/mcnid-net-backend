const { verify, generateSecret } = require('otplib');

function generateTOTP(secret, timestamp) {
    // We can use the functional API or just use the totp package directly if available
    const { totp } = require('otplib');
    // Wait, if totp is undefined, we can try to import it from @otplib/totp
    return totp.generate(secret, { timestamp });
}

async function testDrift() {
    try {
        const { totp } = require('otplib');
        const secret = generateSecret();
        
        const now = Date.now();
        const tokenNow = totp.generate(secret);
        
        const past = now - 45000; // 45s ago
        const tokenPast = totp.generate(secret, { timestamp: past });
        
        console.log('Token Now:', tokenNow);
        console.log('Token Past (45s ago):', tokenPast);

        const resNo = await verify({ token: tokenPast, secret });
        console.log('No window ->', resNo.valid);

        const resWin = await verify({ token: tokenPast, secret, window: 2 });
        console.log('Window: 2 ->', resWin.valid);
    } catch (e) {
        console.error(e);
    }
}

testDrift();
