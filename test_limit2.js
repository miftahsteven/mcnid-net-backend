const axios = require('axios');

async function test() {
  const userId = "dummy_limit_" + Date.now();
  for (let i = 1; i <= 6; i++) {
    try {
      const res = await axios.post('https://api.mcnid.net/api/admin/ki-ai/chat', {
        message: "apa hukum puasa ramadhan?",
        session_id: "sess_" + userId,
        user_id: userId,
        agent: "general"
      }, {
        headers: { 'User-Agent': 'curl/8.7.1' }
      });
      console.log(`Request ${i}: STATUS ${res.status}`);
    } catch (err) {
      console.log(`Request ${i}: ERROR STATUS ${err.response?.status}, DATA: ${JSON.stringify(err.response?.data)}`);
    }
  }
}
test();
