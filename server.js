const http = require('http');
const { handler, info } = require('./lib/router');

const PORT = process.env.PORT || 4545;

http.createServer(handler).listen(PORT, () => {
  console.log(`Live scores site running at http://localhost:${PORT}  (admin: /admin)`);
  console.log(`Football data: ${info.football}. Database: ${info.db}.`);
});
