const { verify, generateSecret } = require('otplib');

async function test() {
  const secret = generateSecret();
  const token = '123456';

  // Test with window option
  try {
    const result = await verify({ token, secret, window: 1 });
    console.log('Result with window: 1 ->', result);
  } catch (e) {
    console.error('Error with window option:', e.message);
  }
}

test();
