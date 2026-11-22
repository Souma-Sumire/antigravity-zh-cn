const path = require('path');
const { main } = require(path.join(__dirname, 'scripts', 'install_all.js'));

main().catch((err) => {
  console.error('Installation error:', err);
  process.exit(1);
});
