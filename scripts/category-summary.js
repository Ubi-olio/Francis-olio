const fs = require('fs');
const path = require('path');
hexo.extend.filter.register('before_generate', function () {
  hexo.theme.setView('category-summary.ejs', fs.readFileSync(
    path.join(hexo.base_dir, 'site-layouts/category-summary.ejs'), 'utf8'));
});
