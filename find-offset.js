const { generate } = require('otplib');

async function testOffline() {
  const secret = 'MNTEHCEQPEKJ6ZDROJ7MZJGJZWW2K5XX'; // From our earlier reset test or the current db value?
  
  // Wait, wait... did the user scan the same QR code as our earlier DB check?
  // Our DB check showed MNTEHCEQPEKJ6ZDROJ7MZJGJZWW2K5XX, which the user matched.
  
  const serverTime = new Date('2026-04-01T04:04:54.706Z').getTime();
  const tokenAtServerTime = await generate({ secret, epoch: Math.floor(serverTime / 1000) });
  
  console.log('Expected by Server:', tokenAtServerTime);

  // Let's try 2 hours ahead 
  // 13:04 WIB is 06:04 UTC
  // Sever log was 04:04 UTC. Difference is exactly 2 hours.
  const twoHoursAhead = serverTime + (2 * 60 * 60 * 1000); // Add 2 hours
  const tokenAtUserTime = await generate({ secret, epoch: Math.floor(twoHoursAhead / 1000) });
  
  console.log('Generated at User Time (+2 hrs):', tokenAtUserTime);

  // We loop to find the exact offset where token is '146368'
  let found = false;
  // Look 3 hours ahead and behind
  for(let offset = -10800; offset <= 10800; offset+=30) {
    const epoch = Math.floor(serverTime / 1000) + offset;
    const t = await generate({ secret, epoch });
    if(t === '146368') {
      console.log(`Match found! The user's phone is exactly ${offset} seconds off from the server.`);
      found = true;
      break;
    }
  }
}

testOffline();
