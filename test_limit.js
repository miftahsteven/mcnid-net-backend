const axios = require('axios');

async function test() {
  const userId = "dummy_limit_user_" + Date.now();
  for (let i = 1; i <= 6; i++) {
    try {
      const res = await axios.post('https://api.mcnid.net/api/admin/ki-ai/chat', {
        message: "apa hukum puasa ramadhan?",
        session_id: "sess_" + userId,
        user_id: userId,
        agent: "general"
      }, {
        responseType: 'stream'
      });
      
      let data = '';
      res.data.on('data', chunk => { data += chunk.toString(); });
      await new Promise(resolve => res.data.on('end', resolve));
      console.log(`Request ${i}: STATUS ${res.status}, DATA LEN: ${data.length}`);
    } catch (err) {
      console.log(`Request ${i}: ERROR STATUS ${err.response?.status}`);
    }
  }
}
test();
