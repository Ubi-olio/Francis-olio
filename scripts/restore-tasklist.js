// Keep the site's original interactive checklist without modifying upstream theme files.
hexo.extend.filter.register('after_render:html', function (html) {
  const root = hexo.config.root || '/';
  return html.replace('</body>', `<script src="${root}js/tasklist.js"></script>\n</body>`);
});
