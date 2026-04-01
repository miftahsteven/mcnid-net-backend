const { verify, generateSecret } = require('otplib');

async function test() {
  const secret = generateSecret();
  const token = '123456';

  const result = await verify({ token, secret });
  console.log('Resolved result of await verify({ token, secret }):', result);
  console.log('Type of resolved result:', typeof result);
}

test();
