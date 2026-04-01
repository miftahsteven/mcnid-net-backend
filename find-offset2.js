const { generate } = require('otplib');

async function testOffline2() {
  const secret = 'MNTEHCEQPEKJ6ZDROJ7MZJGJZWW2K5XX';
  const serverTime = new Date('2026-04-01T04:10:32.854Z').getTime();
  
  for(let offset = -10800; offset <= 10800; offset+=30) {
    const epoch = Math.floor(serverTime / 1000) + offset;
    const t = await generate({ secret, epoch });
    if(t === '960117') { // User's received code
      console.log(`Match found! Offset is exactly ${offset} seconds.`);
      return;
    }
  }
  console.log("No match found in +- 3 hours.");
}

testOffline2();
